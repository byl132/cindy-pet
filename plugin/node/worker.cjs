'use strict';
// 桌宠联动：Node 工作进程。① 监听 127.0.0.1:47832，把桌面版的聊天请求排队，等 main.js 取走并用 Cindy 模型回复
// ② 代为访问桌面版的本地接口 127.0.0.1:47831。stdout 只写 JSON-RPC 消息，日志写 stderr。
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

const RELAY_PORT = 47832, DESK_PORT = 47831;
const queue = [];                 // 待处理的聊天任务
const waiting = new Map();        // id -> { resolve, timer }
let poller = null;                // 当前挂着的 poll：{ resolve, timer }
let seq = 0;
let listenError = null;
let shared = { outfit: null, role: null, userName: null, at: 0 };   // 设置同步的最新状态（以 at 时间戳为准）

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function log(...a) { process.stderr.write(a.join(' ') + '\n'); }

function deliver() {
  if (poller && queue.length) {
    const p = poller; poller = null; clearTimeout(p.timer);
    p.resolve(queue.shift());
  }
}

// ---- 本地 HTTP：桌面版 → 中继 ----
const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/ping') return send(200, { ok: true, polling: !!poller });
  if (req.method !== 'POST' || (req.url !== '/chat' && req.url !== '/state' && req.url !== '/act' && req.url !== '/media' && req.url !== '/answer')) return send(404, { ok: false, error: 'not found' });
  // 自定义头会让浏览器页面的跨站请求触发预检而被拦下，避免网页偷偷消耗你的模型额度
  if (req.headers['x-desk-pet'] !== '1') return send(403, { ok: false, error: 'forbidden' });
  if (req.url === '/media') {                       // 桌面版 -> Cindy 页面：正在听歌 / 看视频（以及节拍速度）
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1024) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(b || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
      const kind = j.kind === 'music' || j.kind === 'video' ? j.kind : null;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].event === 'media') queue.splice(i, 1);     // 只保留最新的一条
      queue.push({ event: 'media', media: { kind, bpm: Math.max(0, Math.min(240, +j.bpm || 0)), real: !!j.real, at: Date.now() } }); deliver();
      send(200, { ok: true });
    });
    return;
  }
  if (req.url === '/answer') {                      // 桌面版 -> Cindy：在桌宠上回答了伙伴的提问 / 确认
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 8192) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(b || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
      if (!j.ref || !j.companionId) return send(400, { ok: false, error: 'ref/companionId required' });
      queue.push({ event: 'answer', answer: { ref: String(j.ref), companionId: String(j.companionId), open: !!j.open, answer: j.answer || null } }); deliver();
      send(200, { ok: true });
    });
    return;
  }
  if (req.url === '/act') {                         // 桌面版 -> Cindy 页面：动作同步（手动动作 / rua / 睡觉）
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 2048) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(b || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
      if (!['action', 'rua', 'sleep', 'wake'].includes(j.kind)) return send(400, { ok: false, error: 'bad kind' });
      const acts = queue.filter((x) => x.event === 'act'); if (acts.length > 30) queue.splice(queue.indexOf(acts[0]), 1);
      queue.push({ event: 'act', act: { kind: j.kind, name: String(j.name || '').slice(0, 20), at: Date.now() } }); deliver();
      send(200, { ok: true });
    });
    return;
  }
  if (req.url === '/state') {                       // 桌面版 -> Cindy 页面：设置同步
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(b || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
      const at = +j.at || Date.now();
      if (at < shared.at) return send(200, { ok: true, ignored: true });
      shared = { outfit: j.outfit || shared.outfit, role: j.role || shared.role, userName: j.userName || shared.userName, at };
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].event === 'state') queue.splice(i, 1);
      queue.push({ event: 'state', state: shared }); deliver();
      send(200, { ok: true });
    });
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
    if (!Array.isArray(j.messages) || !j.messages.length) return send(400, { ok: false, error: 'messages required' });
    if (!poller && !queue.length && Date.now() - lastPollAt > 130000) {
      return send(503, { ok: false, error: '没有在 Cindy 里打开“桌宠”页面，中继未运行。请先在 Cindy 左侧打开“桌宠”。' });
    }
    const id = String(++seq);
    const job = { id, system: String(j.system || '').slice(0, 8000), messages: j.messages.slice(-16).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '').slice(0, 2000) })) };
    const timer = setTimeout(() => { waiting.delete(id); send(504, { ok: false, error: 'Cindy 回复超时' }); }, 85000);
    waiting.set(id, { timer, send });
    queue.push(job); deliver();
  });
});
server.on('error', (e) => { listenError = e.code || String(e); log('relay listen error:', e.message); });
server.listen(RELAY_PORT, '127.0.0.1');

let lastPollAt = 0;

// ---- 访问桌面版本地接口 ----
function deskRequest(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: DESK_PORT, path, method, timeout: 5000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(buf); } catch {} resolve({ ok: res.statusCode === 200 && j.ok !== false, status: res.statusCode, ...j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '桌面版没有响应' }); });
    req.on('error', () => resolve({ ok: false, error: '没有检测到桌面版桌宠（请先启动桌面版，或在其设置里检查端口）' }));
    if (data) req.write(data); req.end();
  });
}

const ALLOWED_PATHS = new Set(['/say', '/event', '/action', '/outfit', '/show', '/hide', '/dock']);
const methods = {
  'desk/post': async (p) => {
    if (!ALLOWED_PATHS.has(p.path)) throw new Error('不允许的路径');
    return deskRequest('POST', p.path, p.body || {});
  },
  'project/scan': async (p) => {                       // 只读统计用户亲手选择的项目文件夹
    const dir = String(p.dir || '');
    if (!path.isAbsolute(dir)) throw new Error('需要绝对路径');
    return require('./scan.cjs').scan(dir);
  },
  'desk/agent': async (p) => deskRequest('POST', '/agent', p.payload || {}),   // 把 Cindy 的工作状态推给桌面版
  'desk/ask': async (p) => deskRequest('POST', '/ask', { items: Array.isArray(p.items) ? p.items : [] }),   // 伙伴的提问 / 确认 -> 桌面版气泡
  'act/send': async (p) => deskRequest('POST', '/act', p.act || {}),                // Cindy 页面 -> 桌面版
  'state/get': async () => shared,
  'state/set': async (p) => {                       // Cindy 页面 -> 桌面版
    const s = p.state || {}; const at = +s.at || Date.now();
    shared = { outfit: s.outfit || shared.outfit, role: s.role || shared.role, userName: s.userName || shared.userName, at };
    const d = await deskRequest('POST', '/state', shared);
    return { ok: true, desktop: !!d.ok, error: d.ok ? undefined : d.error };
  },
  'desk/install-state': async () => require('./installer.cjs').state(),     // 桌面版是否已安装 / 在线 / 安装进度
  'desk/install': async () => require('./installer.cjs').start(),            // 后台下载并安装桌面版（只下载作者的 GitHub Release）
  'desk/install-cancel': async () => require('./installer.cjs').cancel(),
  'desk/launch': async () => require('./installer.cjs').launch(),
  'desk/status': async () => {
    const d = await deskRequest('GET', '/ping');
    return { ok: true, desktopOnline: !!d.ok, desktopRole: d.role || null, desktop: d.ok ? { outfit: d.outfit, role: d.roleId, userName: d.userName, at: d.at || 0, media: d.media || null, bpm: d.mediaBpm || 0 } : null, relayPort: RELAY_PORT, relayListening: !listenError, relayError: listenError, polling: !!poller };
  },
  'relay/poll': () => new Promise((resolve) => {
    lastPollAt = Date.now();
    if (poller) { clearTimeout(poller.timer); poller.resolve({}); }
    if (queue.length) return resolve(queue.shift());
    const timer = setTimeout(() => { if (poller && poller.resolve === resolve) poller = null; resolve({}); lastPollAt = Date.now(); }, 90000);
    poller = { resolve, timer };
  }),
  'relay/reply': async (p) => {
    const w = waiting.get(String(p.id)); if (!w) return { ok: false, stale: true };
    waiting.delete(String(p.id)); clearTimeout(w.timer);
    if (p.ok) w.send(200, { ok: true, text: String(p.text || '') });
    else w.send(502, { ok: false, error: String(p.error || 'Cindy 模型调用失败') });
    return { ok: true };
  }
};

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const fn = methods[req.method];
  if (!fn) return write({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } });
  try { write({ jsonrpc: '2.0', id: req.id, result: await fn(req.params || {}) }); }
  catch (e) { write({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: String((e && e.message) || e) } }); }
});
