'use strict';
// 桌宠联动：电子脑（沙箱）。
// ① 用 Cindy 快问快答给桌宠页面/桌面版生成回复  ② 把播报转给桌面版  ③ 响应 Agent 工具
// ④ 旁听 Cindy 的工作状态（只含边界与 token 用量，不含对话/命令/文件内容），让桌宠跟着干活
// ⑤ 统计用量并按自设预算估算剩余  ⑥ 概览用户亲手选择的项目文件夹  ⑦ 查看项目任务状态
const bc = new BroadcastChannel('desk-pet');
const inflight = new Set();
const done = new Map();            // reqId -> 结果（重发时直接回放，页面按 reqId 重发直到收到回执）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOODS = ['talk', 'happy', 'shy', 'comfort', 'cheer'];
const OUTFITS = ['default', 'hoodie', 'gothic', 'pajama'];
const ACTIONS = ['sit', 'stretch', 'hug', 'lie', 'cheer', 'drink', 'music', 'video'];

function remember(reqId, result) {
  done.set(reqId, result);
  if (done.size > 60) done.delete(done.keys().next().value);
}

// ================= Cindy 快问快答 =================
async function askCindy({ system, messages }) {
  const lines = (messages || []).slice(-16).map((m) => (m.role === 'user' ? '用户：' : '桌宠：') + String(m.content || '')).join('\n');
  const prompt = String(system || '').slice(0, 6000) +
    '\n\n【对话记录】\n' + lines.slice(-12000) +
    '\n\n请以桌宠身份回复用户最后一句话，严格遵守上面的规则（含开头的 [mood:xxx] 标签）。只输出回复本身。';
  const r = await cindy.send({ type: 'cindy-request', kind: 'oneshot_text', prompt, maxTokens: 300 });
  if (r && r.ok) return { ok: true, text: String(r.text || '').trim() };
  const code = r && r.errorCode;
  return { ok: false, error: code === 'NO_CANDIDATE'
    ? '你的 Cindy 还没有可用的“快速通道”模型，请先在 Cindy 设置里配置。'
    : ((r && r.message) || '调用 Cindy 模型失败') };
}

// ================= 桌面版联动 =================
async function desktop(path, body) {
  const r = await cindy.node.request({ method: 'desk/post', params: { path, body: body || {} }, timeoutMs: 8000 });
  if (!r.ok) return { ok: false, error: r.message || '桌面版联动失败' };
  return r.result;
}
async function stateSet(state) {
  const r = await cindy.node.request({ method: 'state/set', params: { state }, timeoutMs: 8000 });
  return r.ok ? r.result : { ok: false, error: r.message };
}
async function status() {
  const r = await cindy.node.request({ method: 'desk/status', params: {}, timeoutMs: 6000 });
  return r.ok ? r.result : { ok: false, error: r.message };
}

// ================= 账本：用量 / 预算 / 项目 =================
let ledger = { v: 1, days: {}, budget: { daily: 0, monthly: 0 }, project: null };
let ledgerReady = false, saveTimer = 0;
const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
async function loadLedger() {
  try {
    const r = await cindy.fs({ op: 'read', root: 'data', path: 'ledger.json' });
    if (r && r.ok && r.content) { const j = JSON.parse(r.content); ledger = { ...ledger, ...j, budget: { ...ledger.budget, ...(j.budget || {}) } }; }
  } catch {}
  ledgerReady = true;
}
function saveLedger() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(ledger.days).sort(); while (keys.length > 62) delete ledger.days[keys.shift()];   // 只保留约两个月
    cindy.fs({ op: 'write', root: 'data', path: 'ledger.json', content: JSON.stringify(ledger) }).catch(() => {});
  }, 4000);
}
const loading = loadLedger();

function addUsage(d) {
  const u = d.usage || {}; const k = dayKey(); const day = ledger.days[k] || (ledger.days[k] = { in: 0, out: 0, cacheR: 0, cacheC: 0, turns: 0, ms: 0, models: {} });
  const inT = +u.inputTokens || 0, outT = +u.outputTokens || 0;
  day.in += inT; day.out += outT; day.cacheR += +u.cacheReadTokens || 0; day.cacheC += +u.cacheCreationTokens || 0;
  day.turns += 1; day.ms += +d.durationMs || 0;
  const m = d.model || d.agent || '未知'; day.models[m] = (day.models[m] || 0) + inT + outT;
  saveLedger();
}
const tot = (x) => (x ? (x.in || 0) + (x.out || 0) : 0);
function usageSummary() {
  const today = ledger.days[dayKey()] || { in: 0, out: 0, cacheR: 0, cacheC: 0, turns: 0, ms: 0, models: {} };
  const prefix = dayKey().slice(0, 7); const month = { in: 0, out: 0, turns: 0 };
  for (const [k, v] of Object.entries(ledger.days)) if (k.startsWith(prefix)) { month.in += v.in; month.out += v.out; month.turns += v.turns; }
  const week = []; for (let i = 6; i >= 0; i--) { const k = dayKey(Date.now() - i * 86400000); week.push({ day: k.slice(5), total: tot(ledger.days[k]) }); }
  const rem = (used, limit) => limit > 0 ? { used, limit, left: Math.max(0, limit - used), pct: Math.max(0, Math.min(100, Math.round((limit - used) / limit * 100))) } : null;
  return {
    today: { ...today, total: tot(today) }, month: { ...month, total: month.in + month.out }, week,
    budget: ledger.budget,
    remaining: { daily: rem(tot(today), ledger.budget.daily), monthly: rem(month.in + month.out, ledger.budget.monthly) },
    topModels: Object.entries(today.models).sort((a, b) => b[1] - a[1]).slice(0, 3)
  };
}
function projectSummary() { return ledger.project ? { name: ledger.project.name, scannedAt: ledger.project.scannedAt, scan: ledger.project.scan } : null; }

// ================= 旁听 Cindy 的工作状态 =================
const A = { turns: new Map(), thinking: new Set(), approvals: new Set(), inputs: new Set(), state: 'idle', since: Date.now(), last: null, workdir: null, sessionId: null };
let doneTimer = 0;
function computeState() {
  if (A.approvals.size) return 'waiting-approval';
  if (A.inputs.size) return 'waiting-input';
  if (A.turns.size) return A.thinking.size ? 'thinking' : 'working';
  if (A.last && Date.now() - A.last.at < 6500) return /error|fail/i.test(A.last.reason || '') ? 'error' : (A.last.reason === 'interrupted' ? 'idle' : 'done');
  return 'idle';
}
function snapshot() {
  const t = [...A.turns.values()][0] || A.last || {};
  return { state: A.state, since: A.since, agent: t.agent || null, model: t.model || null, turns: A.turns.size,
    approvals: A.approvals.size, inputs: A.inputs.size, project: A.workdir ? A.workdir.split(/[\\/]/).filter(Boolean).pop() : null };
}
function publish(force) {
  const next = computeState();
  const changed = next !== A.state;
  if (changed) { A.state = next; A.since = Date.now(); }
  if (changed || force) {
    bc.postMessage({ type: 'agent', agent: snapshot(), usage: usageSummary() });
    cindy.node.request({ method: 'desk/agent', params: { payload: { source: 'cindy', ...snapshot(), usage: usageSummary(), project: projectSummary(), at: Date.now() } }, timeoutMs: 4000 }).catch(() => {});
  }
  clearTimeout(doneTimer);
  if (A.state === 'done' || A.state === 'error') doneTimer = setTimeout(() => publish(false), 6600);
}
function resetAgent() { A.turns.clear(); A.thinking.clear(); A.approvals.clear(); A.inputs.clear(); A.last = null; }
function onEvent(msg) {
  if (msg.dropped) resetAgent();            // 事件被丢过：以此后到达的为准
  const d = msg.data || {};
  switch (msg.name) {
    case 'did-turn-start': A.turns.set(d.sessionId, { agent: d.agent, model: d.model, at: Date.now() }); break;
    case 'did-turn-end': { const t = A.turns.get(d.sessionId); A.turns.delete(d.sessionId); A.thinking.clear();
      A.last = { reason: d.endReason, at: Date.now(), agent: (t && t.agent) || d.agent, model: (t && t.model) || d.model };
      if (d.usage) addUsage(d); else addUsage({ ...d, usage: {} }); break; }
    case 'did-thinking-start': A.thinking.add(d.blockId); break;
    case 'did-thinking-end': A.thinking.delete(d.blockId); break;
    case 'did-approval-start': A.approvals.add(d.requestId); break;
    case 'did-approval-end': A.approvals.delete(d.requestId); break;
    case 'did-user-input-start': A.inputs.add(d.requestId); break;
    case 'did-user-input-end': A.inputs.delete(d.requestId); break;
    case 'did-session-switched': A.workdir = d.workdir || null; A.sessionId = d.sessionId || null; break;
    default: return;
  }
  publish(msg.name === 'did-turn-end');
}

// ================= 项目文件夹概览 / 任务看板 =================
async function projectPick(callId) {
  await loading;
  let picked;
  try { picked = await cindy.pick({ mode: 'directory', title: '选择要让桌宠了解的项目文件夹（只读统计，不会上传）', ...(callId ? { callId } : {}) }); }
  catch (e) { return { ok: false, error: '无法打开选择框：' + String((e && e.message) || e) }; }
  if (!picked || !picked.ok) return { ok: false, cancelled: true, error: picked && picked.code === 'CANCELLED' ? '已取消' : ((picked && picked.message) || '没有选择文件夹') };
  if (!picked.path) return { ok: false, error: '宿主没有返回文件夹路径（需要较新的 Cindy）。' };
  ledger.project = { dir: picked.path, name: picked.name || picked.path.split(/[\\/]/).pop(), scan: null, scannedAt: 0 };
  saveLedger();
  return projectScan();
}
async function projectScan() {
  await loading;
  if (!ledger.project || !ledger.project.dir) return { ok: false, needPick: true, error: '还没有选择项目文件夹。' };
  const r = await cindy.node.request({ method: 'project/scan', params: { dir: ledger.project.dir }, timeoutMs: 15000 });
  if (!r.ok) return { ok: false, error: r.message || '扫描失败（文件夹可能已被移动）。' };
  ledger.project.scan = r.result; ledger.project.scannedAt = Date.now(); saveLedger();
  publish(true);
  return { ok: true, project: projectSummary() };
}
async function getTasks() {
  if (typeof (cindy.observe && cindy.observe.projectTasks) !== 'function') return { ok: true, supported: false, tasks: [] };
  const dir = A.workdir || (ledger.project && ledger.project.dir);
  if (!dir) return { ok: true, supported: true, needProject: true, tasks: [] };
  try {
    const r = await cindy.observe.projectTasks({ project: dir });
    if (r && r.ok === false) return { ok: false, supported: true, error: r.code || r.message || '读取失败', tasks: [] };
    return { ok: true, supported: true, tasks: ((r && r.tasks) || []).slice(0, 30) };
  } catch (e) { return { ok: false, supported: true, error: (e && (e.code || e.message)) || String(e), tasks: [] }; }
}
async function openTask(id) {
  try { const r = await cindy.observe.openTask({ taskId: id }); return { ok: !!(r && r.opened !== false) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
async function dashboard() {
  await loading;
  return { ok: true, agent: snapshot(), usage: usageSummary(), project: projectSummary() };
}

// ================= 页面请求 =================
bc.onmessage = async ({ data }) => {
  if (!data || !data.type) return;
  if (data.type === 'hello') { bc.postMessage({ type: 'ready' }); return; }
  const reqId = data.reqId;
  if (!reqId) return;
  if (done.has(reqId) && !data.fresh) { bc.postMessage({ type: 'result', reqId, ...done.get(reqId) }); return; }
  if (inflight.has(reqId)) return;
  inflight.add(reqId);
  let result;
  try {
    if (data.type === 'chat') result = await askCindy(data);
    else if (data.type === 'desktop') result = await desktop(String(data.path || ''), data.body);
    else if (data.type === 'status') result = await status();
    else if (data.type === 'state-set') result = await stateSet(data.state);
    else if (data.type === 'act-set') { const r = await cindy.node.request({ method: 'act/send', params: { act: data.act }, timeoutMs: 6000 }); result = r.ok ? r.result : { ok: false, error: r.message }; }
    else if (data.type === 'dashboard') result = await dashboard();
    else if (data.type === 'budget-set') {
      await loading; ledger.budget = { daily: Math.max(0, Math.floor(+data.daily || 0)), monthly: Math.max(0, Math.floor(+data.monthly || 0)) };
      saveLedger(); publish(true); result = await dashboard();
    }
    else if (data.type === 'project-pick') result = await projectPick();
    else if (data.type === 'project-scan') result = await projectScan();
    else if (data.type === 'tasks') result = await getTasks();
    else if (data.type === 'task-open') result = await openTask(String(data.id || ''));
    else result = { ok: false, error: 'unknown request' };
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) };
  } finally { inflight.delete(reqId); }
  if (!/^(dashboard|tasks)$/.test(data.type)) remember(reqId, result);
  bc.postMessage({ type: 'result', reqId, ...result });
};

// ================= 桌面版 → Cindy 模型 的中继 =================
let relayStarted = false;
async function relayLoop() {
  if (relayStarted) return; relayStarted = true;
  for (;;) {
    try {
      const r = await cindy.node.request({ method: 'relay/poll', params: {}, timeoutMs: 100000 });
      if (!r.ok) { await sleep(4000); continue; }
      const job = r.result;
      if (job && job.event === 'state') { bc.postMessage({ type: 'state', state: job.state }); continue; }   // 桌面版改了设置 -> 通知页面
      if (job && job.event === 'act') { bc.postMessage({ type: 'act', act: job.act }); continue; }
      if (job && job.event === 'media') { bc.postMessage({ type: 'media', media: job.media }); continue; }          // 桌面版在听歌/看视频 -> 页面里的桌宠也跟着          // 桌面版做了动作 -> 页面里的桌宠也做
      if (!job || !job.id) continue;
      const out = await askCindy(job).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
      await cindy.node.request({ method: 'relay/reply', params: { id: job.id, ...out }, timeoutMs: 10000 });
    } catch (e) { await sleep(4000); }
  }
}
relayLoop();

// ================= Agent 工具 / 事件入口 =================
function fail(msg, code, text) { cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, errorCode: code, message: text }); }
const ok = (msg, result) => cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result });

cindy.onHostMessage(async function (msg) {
  if (msg.type === 'event') { try { onEvent(msg); } catch (e) {} return; }
  if (msg.type !== 'tool-call') return;
  const a = msg.args || {};
  try {
    if (msg.tool === 'pet_say') {
      const text = String(a.text || '').trim().slice(0, 200);
      if (!text) return fail(msg, 'EMPTY_TEXT', '请提供桌宠要说的话（text）。');
      const mood = MOODS.includes(a.mood) ? a.mood : 'talk';
      const target = ['both', 'view', 'desktop'].includes(a.target) ? a.target : 'both';
      const res = { view: false, desktop: false };
      if (target !== 'desktop') { bc.postMessage({ type: 'say', text, mood }); res.view = true; }
      if (target !== 'view') { const d = await desktop('/say', { text, mood }); res.desktop = !!d.ok; if (!d.ok) res.desktopError = d.error; }
      return ok(msg, res);
    }
    if (msg.tool === 'pet_outfit') {
      if (!OUTFITS.includes(a.outfit)) return fail(msg, 'BAD_OUTFIT', 'outfit 必须是 default / hoodie / gothic / pajama 之一。');
      bc.postMessage({ type: 'outfit', outfit: a.outfit });
      const d = await desktop('/outfit', { id: a.outfit });
      return ok(msg, { view: true, desktop: !!d.ok });
    }
    if (msg.tool === 'pet_action') {
      if (!ACTIONS.includes(a.name)) return fail(msg, 'BAD_ACTION', 'name 必须是 sit / stretch / hug / lie / cheer / drink / music / video 之一。');
      const target = ['both', 'view', 'desktop'].includes(a.target) ? a.target : 'both';
      const res = { view: false, desktop: false };
      if (target !== 'desktop') { bc.postMessage({ type: 'say', text: '', mood: a.name }); res.view = true; }
      if (target !== 'view') { const d = await desktop('/action', { name: a.name }); res.desktop = !!d.ok; if (!d.ok) res.desktopError = d.error; }
      return ok(msg, res);
    }
    if (msg.tool === 'pet_dock') {
      const side = a.side || 'none';
      if (!['top', 'bottom', 'left', 'right', 'none'].includes(side)) return fail(msg, 'BAD_SIDE', 'side 必须是 top / bottom / left / right / none 之一。');
      const d = await desktop('/dock', { side });
      return ok(msg, { desktop: !!d.ok, desktopError: d.ok ? undefined : d.error });
    }
    if (msg.tool === 'pet_show') {
      const d = await desktop(a.visible === false ? '/hide' : '/show', {});
      return ok(msg, { desktop: !!d.ok, desktopError: d.ok ? undefined : d.error });
    }
    if (msg.tool === 'pet_status') return ok(msg, await status());
    if (msg.tool === 'pet_work_status') {
      const d = await dashboard(); const t = await getTasks();
      const u = d.usage;
      return ok(msg, { state: d.agent.state, agent: d.agent, today: { tokens: u.today.total, in: u.today.in, out: u.today.out, turns: u.today.turns },
        month: { tokens: u.month.total }, remaining: u.remaining, project: d.project && { name: d.project.name, summary: d.project.scan },
        tasks: t.supported ? t.tasks : 'unsupported', note: '剩余用量是按你在桌宠里设置的预算估算的，Cindy 不向插件开放真实剩余额度。' });
    }
    if (msg.tool === 'pet_set_budget') {                     // 设置每日/每月 token 预算，并用账本原始数据独立验算剩余
      await loading;
      const parse = (v, cur) => { if (v === undefined || v === null) return cur; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error('预算必须是 ≥0 的数字（0 表示清除）'); return Math.floor(n); };
      let daily, monthly;
      try { daily = parse(a.daily, ledger.budget.daily); monthly = parse(a.monthly, ledger.budget.monthly); } catch (e) { return fail(msg, 'BAD_BUDGET', e.message); }
      ledger.budget = { daily, monthly }; saveLedger(); publish(true);
      const u = usageSummary();
      const k = dayKey(), prefix = k.slice(0, 7);                    // 独立从账本原始记录重新求和，对照汇总值
      let rawToday = 0, rawMonth = 0;
      for (const [d, v] of Object.entries(ledger.days)) { const t = (v.in || 0) + (v.out || 0); if (d === k) rawToday += t; if (d.startsWith(prefix)) rawMonth += t; }
      const check = (name, rawUsed, limit, rem, summaryUsed) => {
        if (!limit) return { name, budget: 0, note: '未设置预算' };
        const left = Math.max(0, limit - rawUsed), pct = Math.max(0, Math.min(100, Math.round(left / limit * 100)));
        return { name, budget: limit, used: rawUsed, expectedLeft: left, expectedPct: pct, reportedLeft: rem && rem.left, reportedPct: rem && rem.pct,
          usedMatches: rawUsed === summaryUsed, match: !!rem && rem.left === left && rem.pct === pct && rawUsed === summaryUsed };
      };
      const checks = [check('daily', rawToday, daily, u.remaining.daily, u.today.total), check('monthly', rawMonth, monthly, u.remaining.monthly, u.month.total)];
      const dp = u.remaining.daily ? u.remaining.daily.pct : null;
      return ok(msg, { budget: ledger.budget, checks, allMatch: checks.every((c) => c.note || c.match),
        petReaction: dp === null ? '未设置每日预算，不会有预算提醒' : dp <= 0 ? '页面里的桌宠会趴桌睡着并说预算用完了' : dp <= 10 ? '页面里的桌宠会趴桌睡着并提醒预算快用完了' : '剩余充足，桌宠无特别反应',
        note: '用量按 Cindy 每轮结束时上报的输入+输出 token 累计；本轮尚未结束的用量要等结束后才计入。' });
    }
    if (msg.tool === 'pet_project_scan') {
      await loading;
      const r = ledger.project ? await projectScan() : await projectPick(msg.callId);
      return r.ok ? ok(msg, r.project) : fail(msg, r.cancelled ? 'CANCELLED' : 'SCAN_FAILED', r.error || '扫描失败');
    }
  } catch (e) {
    fail(msg, 'PET_ERROR', '桌宠操作失败：' + String((e && e.message) || e));
  }
});
