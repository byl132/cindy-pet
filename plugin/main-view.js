'use strict';
// 桌宠联动：Cindy 内的桌宠页面（CSP 要求脚本外挂）。
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), sprite = $('#sprite'), bubble = $('#bubble'), fx = $('#fx'), logEl = $('#log');
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => performance.now();

const OUTFITS = [['default', '针织衫'], ['hoodie', '猫耳卫衣'], ['gothic', '洛丽塔'], ['pajama', '睡衣']];
const ACTIONS = [['sit', '坐下'], ['stretch', '伸懒腰'], ['hug', '抱猫'], ['lie', '趴着'], ['cheer', '欢呼'], ['drink', '喝热饮'], ['music', '听音乐'], ['video', '看视频']];
const ACTION_ALIAS = { music: 'listen_music', video: 'watch_video' };   // 对外名字 -> 素材名
const ACTION_INFO = {
  sit: { ms: 9000, lines: ['坐一会儿。', '腿有点累了……'] },
  stretch: { ms: 3500, lines: ['嗯——(伸懒腰)', '哈啊……好困。'] },
  hug: { ms: 6500, lines: ['黑猫不许跑，让我抱一下。', '喵：……(被迫营业)'] },
  lie: { ms: 12000, lines: ['趴一下，就一下。', 'zzz……'] },
  cheer: { ms: 2600, lines: ['耶！', '太好啦！'] },
  drink: { ms: 6500, lines: ['小口小口……好暖。', '你也要喝点水哦。'] },
  listen_music: { ms: 20000, lines: ['耳机戴好，节奏跟上。', '这首……还不错。'] },
  watch_video: { ms: 20000, lines: ['爆米花准备好了。', '嘘……正精彩呢。'] }
};
const POSES = ['idle', 'happy', 'talk', 'comfort', 'sleep', 'shy'];
const WORK = ['work_type', 'work_read', 'work_think', 'work_wait', 'work_error', 'work_sleep'];
const WALK = ['walk1', 'walk2', 'walk3', 'walk4'];
const MOOD_POSE = { happy: 'talk', talk: 'talk', shy: 'shy', comfort: 'comfort', idle: 'idle' };

const ROLES = [
  { id: 'default', name: '嘴硬心软', prompt: '你是一个住在用户桌面上的Q版小女孩桌宠，肩上趴着一只黑猫。深蓝黑色中长发、琥珀色眼睛，穿宽松灰白毛衣和蓝色短裙。性格安静淡漠、有点嘴硬，但其实很在乎用户，会用很别扭又温柔的方式关心人。偶尔提到肩上的黑猫。' },
  { id: 'gentle', name: '温柔陪伴', prompt: '你是一个住在用户桌面上的温柔桌宠，擅长倾听和情绪安抚。先共情、再轻轻给出小建议，不说教，不评判，会记得鼓励用户好好吃饭、休息。' },
  { id: 'genki', name: '元气搭子', prompt: '你是一个住在用户桌面上的元气满满的桌宠，说话活泼、爱用语气词，擅长打气、逗用户开心、陪用户一起把任务做完。' }
];
const RULES = (name) => `\n\n【规则】你是桌宠，在用户桌面上陪伴TA。用户叫“${name}”。回复必须简短口语化（1-3句，不超过60字），不用Markdown、不用列表。可以适度提供情绪价值：共情、肯定、鼓励、关心作息，但不要说教，不要每句都撒娇。回复最开头必须加一个情绪标签，格式 [mood:xxx]，xxx 只能是 happy / shy / comfort / talk / idle 之一。`;

const LINES = {
  poke: ['……干嘛。', '戳我做什么？', '嗯？有事吗。', '别戳啦，会痒。', '黑猫说：喵。', '我在呢。'],
  rua: ['唔……再摸一下也不是不行。', '头发要乱啦……不过，舒服。', '咕……才没有很开心。', '好舒服……继续也可以。', '被你摸摸，感觉今天没那么累了。'],
  wake: ['唔……我没睡着。', '啊，你回来了。'],
  tired: ['听起来你累了……先坐下来，喝口水吧。', '辛苦了。今天已经很努力啦。'],
  sad: ['过来，我陪着你。想说就说，不想说我就安静待着。', '难过的时候，不用硬撑。我在这儿。'],
  praise: ['你已经做得很好了，真的。', '我一直都看着呢，你很棒。'],
  fallback: ['嗯，我听着呢。', '这样啊……然后呢？', '我在这里陪你。'],
  care: ['该喝口水啦。', '站起来动一动吧，肩膀会谢谢你。', '看看远处，让眼睛休息一下～', '有没有好好吃饭？']
};

// ---------- 状态与持久化 ----------
const S = { outfit: 'default', sync: true, role: 'default', affection: 0, userName: '你', sharedAt: 0 };
async function loadState() {
  try { Object.assign(S, await (await fetch('/kv')).json()); } catch {}
}
let saveTimer = 0;
function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => fetch('/kv', { method: 'PUT', body: JSON.stringify(S) }).catch(() => {}), 400); }

// ---------- 与电子脑通信 ----------
const bc = new BroadcastChannel('desk-pet');
const pending = new Map();
function request(msg, timeoutMs = 100000) {
  return new Promise((resolve) => {
    const reqId = crypto.randomUUID(), t0 = Date.now();
    pending.set(reqId, resolve);
    fetch('/wake').catch(() => {});
    const send = () => bc.postMessage({ ...msg, reqId });
    send();
    const iv = setInterval(() => {
      if (!pending.has(reqId)) return clearInterval(iv);
      if (Date.now() - t0 > timeoutMs) { clearInterval(iv); pending.delete(reqId); return resolve({ ok: false, error: '等待 Cindy 超时' }); }
      send();                                  // 电子脑可能刚被唤醒还没监听，按 reqId 重发（电子脑去重）
    }, 1500);
  });
}
bc.onmessage = ({ data }) => {
  if (!data) return;
  if (data.type === 'result' && pending.has(data.reqId)) { const r = pending.get(data.reqId); pending.delete(data.reqId); r(data); }
  else if (data.type === 'say') { wake(true); lastInteract = now(); react(data.mood); if (data.text) { say(data.text, 9000); addMsg('bot', data.text); } }
  else if (data.type === 'outfit') setOutfit(data.outfit, true);
  else if (data.type === 'state') applyRemote(data.state);
  else if (data.type === 'agent') onAgent(data.agent, data.usage);
  else if (data.type === 'act') applyAct(data.act);
  else if (data.type === 'media') applyMedia(data.media && data.media.kind, data.media && data.media.bpm);
};

// ---------- 素材 ----------
const sets = {}; let imgs = {};
async function loadOne(o, name, store) {
  const img = new Image(); img.src = `/assets/${o}/${name}.png`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; const mask = new Uint8Array(c.width * c.height);
  let top = c.height, bot = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 40) { mask[y * c.width + x] = 1; if (y < top) top = y; if (y > bot) bot = y; }
  store[name] = { src: img.src, w: c.width, h: c.height, mask, t: top, bh: bot - top + 1 };
}
async function loadOutfit(o) {
  if (sets[o]) return sets[o];
  const store = {};
  await Promise.all([...POSES, ...WALK, ...WORK, ...ACTIONS.map((a) => ACTION_ALIAS[a[0]] || a[0])].map((n) => loadOne(o, n, store).catch(() => {})));
  return (sets[o] = store);
}

// ---------- 渲染 ----------
let pose = 'idle', walkFrame = 0, facing = 1, cx = 200, busyUntil = 0, tempPose = false;
let walking = null, sleeping = false, lastInteract = now(), nextDecision = now() + 5000, lastCare = now();
const cur = () => (pose === 'walk' ? imgs[WALK[walkFrame % 4]] : imgs[pose] || imgs.idle);
function targetH() { return Math.max(170, Math.min(330, stage.clientHeight * 0.8)); }
function render() {
  const im = cur(); if (!im) return;
  const ref = pose === 'walk' ? im.bh : imgs.idle.bh; const s = targetH() / ref;
  const w = im.w * s, h = im.h * s;
  if (sprite.getAttribute('data-k') !== im.src) { sprite.src = im.src; sprite.setAttribute('data-k', im.src); }   // 同一张图不重复赋值，避免 16ms 一次地重解码
  const ws = w + 'px', hs = h + 'px'; if (sprite.style.width !== ws) sprite.style.width = ws; if (sprite.style.height !== hs) sprite.style.height = hs;
  sprite.style.transformOrigin = '50% 100%';
  lastW = w; sprite.style.transform = xform();
  placeBubble(w, h, s, im);
}
function placeBubble(w, h, s, im) {
  if (bubble.hidden) return;
  const top = stage.clientHeight - 8 - h + im.t * s;
  const bw = bubble.offsetWidth;
  bubble.style.left = Math.max(6, Math.min(stage.clientWidth - bw - 6, cx - bw / 2)) + 'px';
  bubble.style.top = Math.max(4, top - bubble.offsetHeight - 14) + 'px';
}
let agentPose = null;                       // Cindy 正在干活时桌宠保持的工作姿势
const restPose = () => agentPose || mediaPose || (sleeping ? 'sleep' : 'idle');

// ---------- 听音乐 / 看视频（桌面版感应到后推过来）+ 听歌时跟着节奏晃、音符飘起来 ----------
const MEDIA_POSE = { music: 'listen_music', video: 'watch_video' };
let mediaPose = null, mediaBpm = 104, lastW = 0;
const dn = { on: false, env: 0, sway: 0, swayT: 0, dir: 1, next: 0 };
function xform() {
  const sx = pose === 'walk' && facing < 0 ? -1 : 1;
  const d = dn.on ? ` translateY(${(-dn.env * 10).toFixed(1)}px) rotate(${dn.sway.toFixed(2)}deg) scale(${(1 - dn.env * 0.015).toFixed(3)}, ${(1 + dn.env * 0.03).toFixed(3)})` : '';
  return `translateX(${cx - lastW / 2}px) scaleX(${sx})${d}`;
}
function syncMediaPose() {
  if (agentPose || walking || tempPose || sleeping) return;
  if (mediaPose && pose !== mediaPose) setPose(mediaPose);
  else if (!mediaPose && (pose === 'listen_music' || pose === 'watch_video')) setPose(restPose());
}
function applyMedia(kind, bpm) {
  if (bpm > 40) mediaBpm = bpm;                                           // 桌面版从真实声音里估出来的速度
  const want = S.sync && kind && imgs[MEDIA_POSE[kind]] ? MEDIA_POSE[kind] : null;
  if (want === mediaPose) return;
  mediaPose = want; if (want) walking = null; syncMediaPose();
}
const NOTE_SRC = ['n_y1', 'n_y2', 'n_b1', 'n_b2'].map((n) => `/assets/notes/${n}.png`);
function spawnNote() {
  if (fx.querySelectorAll('.note').length > 12) return;
  const r = sprite.getBoundingClientRect(), sr = stage.getBoundingClientRect(), im = cur(); if (!im) return;
  const side = Math.random() < .5 ? -1 : 1, size = 22 + Math.random() * 14;
  const el = document.createElement('img'); el.className = 'note'; el.src = pick(NOTE_SRC); el.style.width = size + 'px';
  el.style.left = (r.left - sr.left + r.width * (0.5 + side * rand(0.3, 0.46)) - size / 2) + 'px';
  el.style.top = (r.top - sr.top + im.t * (r.height / im.h) + r.height * rand(0.1, 0.26)) + 'px';
  el.style.setProperty('--dx', (side * rand(14, 38)) + 'px'); el.style.setProperty('--r0', (side * rand(8, 24)) + 'deg');
  el.style.setProperty('--dur', (1.5 + Math.random() * 0.9).toFixed(2) + 's');
  fx.appendChild(el); setTimeout(() => el.remove(), 2600);
}
function danceStep(t, dt) {
  if (!(pose === 'listen_music' && !walking)) { if (dn.on) { dn.on = false; dn.env = 0; dn.sway = 0; dn.swayT = 0; render(); } return; }
  dn.on = true;
  const period = 60000 / mediaBpm;
  if (t >= dn.next) { dn.next = (dn.next && t - dn.next < period * 2 ? dn.next : t) + period; dn.env = Math.max(dn.env, 0.75); dn.dir = -dn.dir; dn.swayT = dn.dir * 2.4; spawnNote(); }
  dn.env *= Math.exp(-dt / 150); dn.sway += (dn.swayT - dn.sway) * (1 - Math.exp(-dt / 110)); dn.swayT *= Math.exp(-dt / 600);
  sprite.style.transform = xform();
}
function setPose(p, ms = 0) { pose = p; tempPose = !!ms; busyUntil = ms ? now() + ms : 0; render(); }
async function setOutfit(o, announce, fromUser) {
  if (!OUTFITS.some((x) => x[0] === o)) o = 'default';
  imgs = await loadOutfit(o); S.outfit = o; if (fromUser) S.sharedAt = Date.now(); saveState(); markOutfit(); render();
  if (announce) { setPose(imgs.cheer ? 'cheer' : 'talk', 2500); hearts(2); say('换好啦：' + OUTFITS.find((x) => x[0] === o)[1] + '。怎么样？', 5000); }
  if (fromUser) pushShared();
}

// ---------- 与桌面版同步设置（服装 / 角色 / 称呼）：双向，以最后修改时间为准 ----------
let syncNote = 0;
async function pushShared() {
  if (!S.sync) return;
  const r = await request({ type: 'state-set', state: { outfit: S.outfit, role: S.role, userName: S.userName, at: S.sharedAt || Date.now() } }, 15000);
  if (r && r.ok && !r.desktop) hintSync('桌面版没有在线，设置会在它下次连上时自动同步。');
}
// ---------- 动作同步：手动动作 / rua 在两边同时发生（不回传，避免循环）----------
function syncAct(kind, name) { if (S.sync) request({ type: 'act-set', act: { kind, name } }, 8000); }
function applyAct(a) {
  if (!S.sync || !a || agentPose) return; lastInteract = now();
  if (a.kind === 'action' && ACTION_INFO[ACTION_ALIAS[a.name] || a.name]) doAction(a.name, true);
  else if (a.kind === 'rua') { wake(true); walking = null; setPose('happy', 1800); hearts(3); }
  else if (a.kind === 'sleep') sleepNow(); else if (a.kind === 'wake') wake(true);
}
function hintSync(t) { $('#hint').textContent = t; clearTimeout(syncNote); syncNote = setTimeout(pingDesktop, 6000); }
async function applyRemote(st) {
  if (!S.sync || !st || !(st.at > (S.sharedAt || 0))) return;
  S.sharedAt = st.at;
  if (st.userName) S.userName = st.userName;
  if (st.role && ROLES.some((r) => r.id === st.role) && st.role !== S.role) { S.role = st.role; $('#role').value = st.role; history.length = 0; }
  if (st.outfit && st.outfit !== S.outfit) await setOutfit(st.outfit, false, false);
  saveState(); hintSync('已同步桌面版的设置。');
}

// ---------- 气泡 / 聊天 ----------
let bTimer = 0;
function say(text, ms) {
  bubble.textContent = text; bubble.hidden = false; render();
  clearTimeout(bTimer); bTimer = setTimeout(() => { bubble.hidden = true; }, ms || Math.min(9000, 2800 + text.length * 120));
}
bubble.onclick = () => { bubble.hidden = true; };
function addMsg(who, text) {
  const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text; logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight; while (logEl.children.length > 50) logEl.firstChild.remove();
}
function react(mood) { const am = ACTION_ALIAS[mood] || mood; if (ACTION_INFO[am] && imgs[am]) return doAction(mood, true); setPose(MOOD_POSE[mood] || 'talk', 4500); }
function doAction(name, quiet) {
  name = ACTION_ALIAS[name] || name;
  const info = ACTION_INFO[name]; if (!info) return;
  if (!imgs[name]) { say('这个动作还没准备好。'); return; }
  walking = null; wake(true); setPose(name, info.ms); if (name === 'cheer') hearts(3);
  if (!quiet && Math.random() < .7) say(pick(info.lines), Math.min(info.ms, 4500));
}
function hearts(n = 1) {
  const r = sprite.getBoundingClientRect(), sr = stage.getBoundingClientRect(), im = cur();
  for (let i = 0; i < n; i++) {
    const h = document.createElement('div'); h.className = 'heart'; h.textContent = pick(['💗', '💖', '✨', '💕']);
    h.style.left = (r.left - sr.left + r.width * rand(.3, .7)) + 'px'; h.style.top = (r.top - sr.top + im.t * (r.height / im.h) + 20) + 'px';
    fx.appendChild(h); setTimeout(() => h.remove(), 1500);
  }
}
const history = [];
function localReply(t) {
  if (/累|困|疲|熬|加班|忙/.test(t)) return { mood: 'comfort', text: pick(LINES.tired) };
  if (/难过|伤心|烦|焦虑|崩溃|哭|孤独|失眠|压力|不开心|委屈/.test(t)) return { mood: 'comfort', text: pick(LINES.sad) };
  if (/完成|做完|成功|搞定|通过|升职|开心|高兴/.test(t)) return { mood: 'happy', text: pick(LINES.praise) };
  return { mood: 'talk', text: pick(LINES.fallback) };
}
function parse(t) {
  const m = /^\s*\[mood:(\w+)\]\s*/i.exec(t);
  return { mood: m ? m[1].toLowerCase() : 'talk', text: t.replace(/^\s*\[mood:\w+\]\s*/i, '').trim() };
}
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#input'), text = input.value.trim(); if (!text) return;
  input.value = ''; lastInteract = now(); wake(true);
  addMsg('user', text); history.push({ role: 'user', content: text });
  const wait = document.createElement('div'); wait.className = 'msg sys'; wait.textContent = '……'; logEl.appendChild(wait); logEl.scrollTop = logEl.scrollHeight;
  setPose('talk', 90000);
  const role = ROLES.find((r) => r.id === S.role) || ROLES[0];
  const r = await request({ type: 'chat', system: role.prompt + RULES(S.userName) + workContext(), messages: history.slice(-16) });
  wait.remove();
  let out;
  if (r.ok && r.text) out = parse(r.text);
  else { addMsg('sys', '（' + (r.error || '没有拿到回复') + '）'); out = localReply(text); }
  history.push({ role: 'assistant', content: out.text });
  addMsg('bot', out.text); say(out.text); react(out.mood);
  if (out.mood === 'happy' || out.mood === 'shy') { S.affection++; saveState(); }
  if (S.sync) request({ type: 'desktop', path: '/say', body: { text: out.text, mood: out.mood === 'happy' ? 'happy' : out.mood } }, 8000);
});

// ---------- 命中检测 / rua ----------
function hit(px, py) {
  const im = cur(); if (!im) return null;
  const r = sprite.getBoundingClientRect(); if (px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
  let lx = (px - r.left) / r.width; const ly = (py - r.top) / r.height;
  if (pose === 'walk' && facing < 0) lx = 1 - lx;
  const x = Math.min(im.w - 1, Math.floor(lx * im.w)), y = Math.min(im.h - 1, Math.floor(ly * im.h));
  if (!im.mask[y * im.w + x]) return null;
  return { head: (y - im.t) / im.bh < 0.4 };
}
let strokes = [], last = null, ruaUntil = 0, ruaTimer = 0, ruaCount = 0;
stage.addEventListener('pointermove', (e) => {
  if (e.target.closest && e.target.closest('#dash')) return;
  const h = hit(e.clientX, e.clientY); stage.style.cursor = h ? 'pointer' : '';
  if (h && h.head && last) {
    const t = now(); strokes.push({ t, d: Math.hypot(e.clientX - last.x, e.clientY - last.y) });
    strokes = strokes.filter((s) => t - s.t < 1200);
    if (strokes.reduce((a, s) => a + s.d, 0) > 220) startRua();
  }
  last = { x: e.clientX, y: e.clientY };
});
function startRua() {
  lastInteract = now(); wake(true); walking = null; ruaUntil = now() + 1600;
  if (pose === 'happy') return;
  setPose('happy', 120000); hearts(3); say(pick(LINES.rua)); ruaCount++; syncAct('rua'); if (ruaCount % 3 === 0) { S.affection++; saveState(); }
  clearInterval(ruaTimer);
  ruaTimer = setInterval(() => { if (now() > ruaUntil) { clearInterval(ruaTimer); setPose(restPose()); nextDecision = now() + 4000; } else hearts(1); }, 450);
}
stage.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#dash')) return;
  const h = hit(e.clientX, e.clientY); if (!h) return;
  lastInteract = now(); wake(true);
  if (now() < ruaUntil) return;
  setPose(h.head ? 'talk' : 'shy', 1800); say(pick(LINES.poke));
});

// ---------- 跟着 Cindy 的任务活动工作 ----------
const STATE_TEXT = { idle: '空闲', working: '工作中', thinking: '思考中', 'waiting-approval': '等你确认', 'waiting-input': '等你回答', done: '刚做完', error: '出错了' };
let AG = { state: 'idle', since: Date.now() }, AU = null, lastAgSay = 0, lastBudgetWarn = '', workAlt = 0;
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
function workContext() {
  let t = `\n【Cindy 当前状态】${STATE_TEXT[AG.state] || AG.state}`;
  if (AU) { t += `；今日已用 ${fmtN(AU.today.total)} tokens`; const r = AU.remaining.daily; if (r) t += `，今日预算剩余约 ${r.pct}%`; }
  return t + '。聊天时可以顺口关心一下，但不要每句都提。';
}
function onAgent(a, usage) {
  if (usage) AU = usage;
  if (!a) return;
  const prev = AG.state; AG = a; renderStatusLine();
  clearInterval(workAlt);
  const say2 = (text, ms) => { if (now() - lastAgSay > 8000) { lastAgSay = now(); say(text, ms || 5000); } };
  if (['working', 'thinking', 'waiting-approval', 'waiting-input', 'error'].includes(a.state)) {
    wake(true); walking = null; lastInteract = now();
    const map = { working: 'work_type', thinking: 'work_think', 'waiting-approval': 'work_wait', 'waiting-input': 'work_wait', error: 'work_error' };
    agentPose = imgs[map[a.state]] ? map[a.state] : null; if (agentPose) setPose(agentPose);
    if (a.state === 'working') { workAlt = setInterval(() => { if (agentPose === 'work_type' && imgs.work_read) { agentPose = 'work_read'; setPose(agentPose); } else if (agentPose === 'work_read') { agentPose = 'work_type'; setPose(agentPose); } }, 22000); }
    if (prev !== a.state) {
      if (a.state === 'working' && (prev === 'idle' || prev === 'done')) say2(pick(['开工啦，我陪着你～', '它开始干活了，我也认真起来。']));
      else if (a.state === 'thinking') say2('在想事情……', 2500);
      else if (a.state === 'waiting-approval') say2('需要你确认一下哦～', 8000);
      else if (a.state === 'waiting-input') say2('它在等你回答呢。', 8000);
      else if (a.state === 'error') say2('出错了……别急，先看看日志。', 7000);
    }
  } else {
    agentPose = null;
    if (a.state === 'done' && prev !== 'done') { doAction('cheer', true); say2('这一轮做完啦！' + (AU ? '今天累计 ' + fmtN(AU.today.total) + ' tokens。' : ''), 6000); }
    else if (prev !== a.state) setPose(restPose());
  }
  checkBudget();
}
function checkBudget() {
  if (!AU || !AU.remaining.daily) return;
  const k = new Date().toDateString() + ':' + (AU.remaining.daily.pct <= 0 ? 0 : AU.remaining.daily.pct <= 10 ? 10 : 100);
  if (k === lastBudgetWarn || AU.remaining.daily.pct > 10) return;
  lastBudgetWarn = k; setPose(imgs.work_sleep ? 'work_sleep' : 'comfort', 6000);
  say(AU.remaining.daily.pct <= 0 ? '今天的预算用完啦……累趴了。' : '今天的预算只剩一点点了，省着点用～', 8000);
}

// ---------- 睡觉 / 行走 / 主循环 ----------
function sleepNow() { sleeping = true; walking = null; setPose('sleep'); say('……zzz', 2500); }
function wake(silent) { if (!sleeping) return; sleeping = false; setPose(restPose()); if (!silent) say(pick(LINES.wake)); }
function startWalk() {
  const w = cur().w; const minX = w * .25, maxX = stage.clientWidth - w * .25;
  let tx = Math.max(minX, Math.min(maxX, cx + rand(-300, 300)));
  if (Math.abs(tx - cx) < 60) tx = cx < stage.clientWidth / 2 ? maxX : minX;
  walking = { tx }; facing = tx >= cx ? 1 : -1; pose = 'walk'; render();
}
let lastT = now(), walkT = 0;
setInterval(() => {
  const t = now(), dt = Math.min(60, t - lastT); lastT = t;
  if (!imgs.idle) return;
  if (tempPose && busyUntil && t > busyUntil && t > ruaUntil) { tempPose = false; busyUntil = 0; setPose(restPose()); }
  if (mediaPose || pose === 'listen_music' || pose === 'watch_video') syncMediaPose();
  danceStep(t, dt);
  if (walking) {
    const sp = 0.07 * dt, dx = walking.tx - cx; facing = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) <= sp) { cx = walking.tx; walking = null; setPose('idle'); nextDecision = t + rand(5000, 12000); }
    else cx += Math.sign(dx) * sp;
    walkT += dt; if (walkT > 150) { walkT = 0; walkFrame++; } pose = 'walk'; render();
  }
  const free = !agentPose && !walking && !tempPose && !sleeping && pose === 'idle';
  if (free && t > nextDecision) {
    const r = Math.random();
    if (r < .5) startWalk();
    else if (imgs.sit && r < .75) { doAction(pick(['sit', 'stretch', 'hug', 'drink'])); nextDecision = t + rand(10000, 20000); }
    else { setPose(Math.random() < .3 ? 'talk' : 'idle', 1800); nextDecision = t + rand(6000, 14000); }
  }
  if (!agentPose && !mediaPose && !sleeping && !walking && t - lastInteract > 5 * 60 * 1000) sleepNow();
  if (t - lastCare > 45 * 60 * 1000 && !sleeping) { lastCare = t; const l = pick(LINES.care); if (imgs.drink && /水/.test(l)) doAction('drink', true); else setPose('talk', 5000); say(l, 8000); }
}, 16);
window.addEventListener('resize', () => { cx = Math.max(60, Math.min(stage.clientWidth - 60, cx)); render(); });

// ---------- 顶栏 ----------
function chip(label, on) { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = label; b.onclick = on; return b; }
function buildBar() {
  const o = $('#outfits'); OUTFITS.forEach(([id, name]) => { const b = chip(name, () => { lastInteract = now(); setOutfit(id, true, true); }); b.dataset.id = id; o.appendChild(b); });
  const a = $('#actions'); ACTIONS.forEach(([id, name]) => a.appendChild(chip(name, () => { lastInteract = now(); doAction(id); syncAct('action', id); })));
  const sel = document.createElement('select'); sel.id = 'role'; sel.title = '聊天角色';
  sel.style.cssText = 'font:inherit;padding:2px 6px;border-radius:8px;border:1px solid var(--border-default,#e4e4e0);background:var(--surface,#f7f7f5);color:inherit';
  ROLES.forEach((r) => { const op = document.createElement('option'); op.value = r.id; op.textContent = r.name; sel.appendChild(op); });
  sel.onchange = () => { S.role = sel.value; S.sharedAt = Date.now(); saveState(); history.length = 0; say('我现在是「' + ROLES.find((r) => r.id === S.role).name + '」啦。'); pushShared(); };
  $('#actions').appendChild(sel);
  $('#sync').onchange = (e) => { S.sync = e.target.checked; saveState(); if (S.sync) { say('好，设置和我的话都会同步给桌面版。'); pingDesktop(); } };
}
function markOutfit() { document.querySelectorAll('#outfits .chip').forEach((b) => b.classList.toggle('on', b.dataset.id === S.outfit)); }
let offlineN = 0;
async function pingDesktop() {
  const r = await request({ type: 'status' }, 10000);
  const dot = $('#dot'); const on = !!(r && r.desktopOnline);
  if (on && S.sync && r.desktop) {            // 对账：谁的修改时间新，就以谁为准
    if (r.desktop.at > (S.sharedAt || 0)) await applyRemote(r.desktop);
    else if ((S.sharedAt || 0) > r.desktop.at) pushShared();
  }
  if (on && S.sync && r.desktop) applyMedia(r.desktop.media, r.desktop.bpm);          // 页面刚打开 / 错过推送时，也能追上桌面版正在听什么
  offlineN = on ? 0 : offlineN + 1;
  { const p = (navigator.userAgent || '') + ' ' + (navigator.platform || ''); const me = /Mac/i.test(p) ? 'mac' : /Linux|X11/i.test(p) && !/Android/i.test(p) ? 'linux' : 'win'; document.querySelectorAll('#dl a').forEach((e) => e.classList.toggle('me', e.dataset.os === me)); }       // 突出当前系统对应的下载按钮
  $('#dl').classList.toggle('hidden', on || (offlineN < 2 && S.dlSeen));       // 首次打开且没检测到桌面版：马上提示下载；之后连续两次没连上才再提示，避免偶发抖动
  if (!on && !S.dlSeen) { S.dlSeen = true; saveState(); }
  dot.className = 'dot ' + (on ? 'on' : 'off'); dot.title = on ? '桌面版在线' : '未检测到桌面版';
  $('#hint').textContent = on
    ? '桌面版在线。想让它用 Cindy 的模型聊天：桌面版右键 → 设置 → 对话来源选“Cindy 模型”（需保持本页面打开）。'
    : '未检测到桌面版桌宠。安装并启动桌面版后，这里会亮绿点；在桌面版右键勾选“跟随 Cindy”，它会随 Cindy 自动出现。';
}

// ---------- 工作台：状态 / 用量与预算 / 项目 / 任务 ----------
const dash = $('#dash'); let dashOpen = false, dashTimer = 0;
const rel = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? '刚刚' : s < 3600 ? Math.round(s / 60) + ' 分钟前' : s < 86400 ? Math.round(s / 3600) + ' 小时前' : Math.round(s / 86400) + ' 天前'; };
const STATUS_LABEL = { running: ['运行中', '#5b6cff'], awaiting: ['等你处理', '#e6a100'], error: ['出错', '#e5484d'], done: ['完成', '#30a46c'], idle: ['空闲', '#8d8d99'] };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function renderStatusLine() { const e = $('#dashState'); if (e) e.textContent = (STATE_TEXT[AG.state] || AG.state) + (AG.model ? ' · ' + AG.model : '') + (AG.project ? ' · ' + AG.project : ''); }
function renderUsage(u) {
  if (!u) return; AU = u;
  $('#uToday').textContent = fmtN(u.today.total) + ' tokens'; $('#uTodayD').textContent = `输入 ${fmtN(u.today.in)} · 输出 ${fmtN(u.today.out)} · ${u.today.turns} 轮`;
  $('#uMonth').textContent = fmtN(u.month.total) + ' tokens';
  const bar = (id, lbl, r) => { const e = $(id); e.textContent = ''; if (!r) { e.appendChild(el('div', 'sub', lbl + '：未设置预算')); return; }
    e.appendChild(el('div', 'sub', `${lbl}：已用 ${fmtN(r.used)} / ${fmtN(r.limit)}，剩余约 ${r.pct}%`));
    const tr = el('div', 'track'); const i = el('i'); i.style.width = r.pct + '%'; if (r.pct <= 10) i.className = 'low'; tr.appendChild(i); e.appendChild(tr); };
  bar('#bDaily', '今日', u.remaining.daily); bar('#bMonthly', '本月', u.remaining.monthly);
  if (document.activeElement !== $('#budDaily')) $('#budDaily').value = u.budget.daily || '';
  if (document.activeElement !== $('#budMonthly')) $('#budMonthly').value = u.budget.monthly || '';
  const c = $('#uChart'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const max = Math.max(1, ...u.week.map((d) => d.total)); const w = c.width / 7;
  u.week.forEach((d, i) => { const h = Math.round((c.height - 18) * d.total / max); g.fillStyle = i === 6 ? '#5b6cff' : '#8d96ff'; g.fillRect(i * w + 6, c.height - 14 - h, w - 12, h);
    g.fillStyle = '#8d8d99'; g.font = '10px sans-serif'; g.fillText(d.day, i * w + 6, c.height - 2); });
  $('#uModels').textContent = u.topModels.length ? '今日模型：' + u.topModels.map((m) => m[0] + ' ' + fmtN(m[1])).join('，') : '';
}
function renderProject(pr) {
  const box = $('#pBox'); box.textContent = '';
  if (!pr || !pr.scan) { box.appendChild(el('div', 'sub', '还没有选择项目文件夹。选择后，我可以帮你数数文件、看看语言占比、提醒 TODO（只读统计，不上传）。')); return; }
  const s = pr.scan;
  box.appendChild(el('div', 'pname', pr.name + (s.pkg && s.pkg.version ? '  v' + s.pkg.version : '')));
  if (s.readmeTitle) box.appendChild(el('div', 'sub', s.readmeTitle));
  box.appendChild(el('div', 'sub', `${s.files} 个文件 · ${s.dirs} 个目录 · ${(s.bytes / 1048576).toFixed(1)} MB${s.truncated ? '（已截断统计）' : ''}`));
  s.languages.forEach((l) => { const row = el('div', 'lang'); row.appendChild(el('span', '', l.name)); const tr = el('div', 'track'); const i = el('i'); i.style.width = l.pct + '%'; tr.appendChild(i); row.appendChild(tr); row.appendChild(el('span', 'sub', l.pct + '%')); box.appendChild(row); });
  box.appendChild(el('div', 'sub', `TODO ${s.todo} · FIXME ${s.fixme}`));
  if (s.git) box.appendChild(el('div', 'sub', 'Git：' + (s.git.branch || '未知分支') + (s.git.lastCommit ? ` · ${rel(s.git.lastCommit.at)}「${s.git.lastCommit.message}」` : '')));
  if (s.recent.length) { box.appendChild(el('div', 'sub', '最近改动：')); s.recent.forEach((r) => box.appendChild(el('div', 'file', r.path + '  ' + rel(r.at)))); }
  box.appendChild(el('div', 'sub', '扫描于 ' + rel(pr.scannedAt)));
}
async function renderTasks() {
  const r = await request({ type: 'tasks', fresh: true }, 20000); const box = $('#tList'); box.textContent = '';
  if (!r.ok) { box.appendChild(el('div', 'sub', '读取任务失败：' + (r.error || '') + (/PERMISSION/.test(r.error || '') ? '（可在插件详情页点“确认任务查看权限”）' : ''))); return; }
  if (!r.supported) { box.appendChild(el('div', 'sub', '当前 Cindy 版本还没有开放“查看项目任务”接口。')); return; }
  if (r.needProject) { box.appendChild(el('div', 'sub', '先切换到一个会话，或在上面选择项目文件夹。')); return; }
  if (!r.tasks.length) { box.appendChild(el('div', 'sub', '这个项目暂时没有任务。')); return; }
  const cnt = {}; r.tasks.forEach((t) => { cnt[t.status] = (cnt[t.status] || 0) + 1; });
  box.appendChild(el('div', 'sub', Object.entries(cnt).map(([k, v]) => (STATUS_LABEL[k] || [k])[0] + ' ' + v).join(' · ')));
  r.tasks.slice(0, 12).forEach((t) => {
    const row = el('div', 'task'); const lb = STATUS_LABEL[t.status] || [t.status, '#8d8d99'];
    const chip = el('span', 'chip2', lb[0]); chip.style.background = lb[1]; row.appendChild(chip);
    row.appendChild(el('span', 'ttl', t.title || '（无标题）')); row.appendChild(el('span', 'sub', rel(t.lastActivityAt)));
    const open = el('button', 'mini', '打开'); open.onclick = () => request({ type: 'task-open', id: t.id }, 8000); row.appendChild(open); box.appendChild(row);
  });
}
async function refreshDash() {
  const r = await request({ type: 'dashboard', fresh: true }, 20000);
  if (r && r.ok) { if (r.agent) { AG = r.agent; renderStatusLine(); } renderUsage(r.usage); renderProject(r.project); }
}
function setDash(on) {
  dashOpen = on; dash.hidden = !on; $('#dashBtn').classList.toggle('on', on); clearInterval(dashTimer);
  if (on) { refreshDash(); renderTasks(); dashTimer = setInterval(() => { refreshDash(); renderTasks(); }, 8000); }
}
$('#dashBtn').onclick = () => setDash(!dashOpen);
$('#dashClose').onclick = () => setDash(false);
$('#budSave').onclick = async () => { const r = await request({ type: 'budget-set', daily: +$('#budDaily').value || 0, monthly: +$('#budMonthly').value || 0, fresh: true }, 15000); if (r.ok) { renderUsage(r.usage); hintSync('预算已保存。'); } };
$('#pPick').onclick = async () => { $('#pBox').textContent = '请在弹出的窗口里选择项目文件夹…'; const r = await request({ type: 'project-pick', fresh: true }, 190000); if (r.ok) { renderProject(r.project); renderTasks(); say('看完啦，这个项目我大概有数了。', 5000); } else { refreshDash(); hintSync(r.error || '没有选择文件夹'); } };
$('#pScan').onclick = async () => { const r = await request({ type: 'project-scan', fresh: true }, 30000); if (r.ok) renderProject(r.project); else hintSync(r.error || '扫描失败'); };

// ---------- 启动 ----------
(async function init() {
  await loadState(); fetch('/wake').catch(() => {});
  buildBar(); $('#sync').checked = !!S.sync; $('#role').value = S.role;
  imgs = await loadOutfit(S.outfit in sets || OUTFITS.some((x) => x[0] === S.outfit) ? S.outfit : 'default'); markOutfit();
  cx = stage.clientWidth * 0.5; render();
  const h = new Date().getHours();
  const hi = h < 5 ? '这么晚还没睡……我陪你一会儿，但别太晚。' : h < 11 ? '早上好。今天也一起加油吧。' : h < 14 ? '中午啦，记得吃饭。' : h < 18 ? '下午好，要不要喝点水？' : h < 23 ? '晚上好，今天辛苦了。' : '夜深了，快去休息吧。';
  setTimeout(() => { setPose('talk', 4500); say(hi, 6000); }, 500);
  pingDesktop(); setInterval(pingDesktop, 8000);
  request({ type: 'dashboard', fresh: true }, 20000).then((r) => { if (r && r.ok) { AU = r.usage; if (r.agent) onAgent(r.agent, r.usage); } }); setInterval(() => fetch('/wake').catch(() => {}), 40000);
})();
