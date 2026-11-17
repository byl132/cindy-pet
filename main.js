const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const PROTOCOL = 'cindy-pet';
const IS_LINUX = process.platform === 'linux';
if (IS_LINUX) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');          // Wayland 下应用无法自己定位/置顶窗口，统一走 X11（XWayland）
  app.commandLine.appendSwitch('enable-transparent-visuals');     // 透明窗口需要
  app.commandLine.appendSwitch('disable-gpu-compositing');         // 部分 Linux 显卡驱动下透明窗口会变黑块
  if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');   // AppImage 里没有 setuid 的 chrome-sandbox，Ubuntu 24.04+ 还会被 AppArmor 拦
}
const DEFAULT_ROLES = [
  { id: 'default', name: '默认·嘴硬心软', model: '', prompt:
    '你是一个住在用户桌面上的Q版小女孩桌宠，肩上趴着一只黑猫。深蓝黑色中长发、琥珀色眼睛，穿宽松灰白毛衣和蓝色短裙。性格安静淡漠、有点嘴硬，但其实很在乎用户，会用很别扭又温柔的方式关心人。偶尔提到肩上的黑猫。' },
  { id: 'gentle', name: '温柔陪伴者', model: '', prompt:
    '你是一个住在用户桌面上的温柔桌宠，擅长倾听和情绪安抚。先共情、再轻轻给出小建议，不说教，不评判，会记得鼓励用户好好吃饭、休息。' },
  { id: 'genki', name: '元气搭子', model: '', prompt:
    '你是一个住在用户桌面上的元气满满的桌宠，说话活泼、爱用语气词，擅长打气、逗用户开心、陪用户一起把任务做完。' }
];
const OUTFITS = [
  { id: 'default', name: '默认针织衫' }, { id: 'hoodie', name: '猫耳帽卫衣' },
  { id: 'gothic', name: '哥特洛丽塔' }, { id: 'pajama', name: '星星睡衣' }
];
const ACTIONS = [
  { id: 'sit', name: '坐下' }, { id: 'stretch', name: '伸懒腰' }, { id: 'hug', name: '抱抱黑猫' },
  { id: 'lie', name: '趴着睡' }, { id: 'cheer', name: '欢呼' }, { id: 'drink', name: '喝热饮' },
  { id: 'music', name: '听音乐' }, { id: 'video', name: '看视频' }
];
const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_CONFIG = {
  api: { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  activeRole: 'default', roles: DEFAULT_ROLES, userName: '你',
  walk: true, scale: 1, careIntervalMin: 45,
  notifyPort: 47831, notifyToken: '',
  affection: 0, outfit: 'default',
  chatBackend: 'api', relayUrl: 'http://127.0.0.1:47832',
  followCindy: false, followProcess: process.platform === 'win32' ? 'Cindy.exe' : (IS_LINUX ? 'cindy' : 'Cindy'),
  autoPeek: false, gravity: false, dock: null, sharedAt: 0, mediaSense: true, musicDance: true,          // autoPeek 默认关闭：不要让桌宠自己跑去趴边
  state: { mood: 70, energy: 80, firstDay: today(), ruaTotal: 0, chatTotal: 0, focusDone: 0, moodLog: [] },
  reminders: []
};

let cfgPath, cfg, win, settingsWin, panelWin, server, tray;
let agentSnap = { state: 'idle' };
let manualHidden = false, followHidden = false, quitting = false;

// ---------- 感应音乐 / 视频：电脑在放歌就戴耳机听，在放视频就抱着平板看（只读“类型”，不读歌名/标题）----------
const mediaMod = require('./media.js');
let mediaState = { kind: null, since: 0 }, mediaWatcher = null;
function applyMediaSense() {
  const on = cfg.mediaSense !== false;
  if (on && !mediaWatcher) {
    mediaWatcher = mediaMod.start({ getCfg: () => cfg, log: (...a) => console.log('[media]', ...a), onKind: (k) => setMedia(k, false) });
  } else if (!on && mediaWatcher) {
    mediaWatcher.stop(); mediaWatcher = null; setMedia(null, false);
  }
}
function setMedia(k, manual) {
  mediaState = { kind: k, since: Date.now(), manual: !!manual, bpm: 0, real: false };
  broadcast('media:update', mediaState); pushMedia(true); controlLoopback();
}
// 推给 Cindy 里的桌宠页（经本地中继）；节拍估计变化时也会带上 bpm，让那边的桌宠跟着同一个速度晃
let lastMediaPush = 0;
function pushMedia(force) {
  if (cfg.syncActions === false) return;
  if (!force && Date.now() - lastMediaPush < 3500) return;
  lastMediaPush = Date.now();
  fetch((cfg.relayUrl || 'http://127.0.0.1:47832').replace(/\/+$/, '') + '/media', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Pet': '1' },
    body: JSON.stringify({ kind: mediaState.kind, bpm: mediaState.bpm || 0, real: !!mediaState.real }), signal: AbortSignal.timeout(2000)
  }).catch(() => {});
}
// 听音乐时才读取“系统正在发出的声音有多大声”（只做节拍分析，不录音、不保存、不上传）；其余时间关闭
function controlLoopback() {
  if (!win || win.isDestroyed()) return;
  const want = mediaState.kind === 'music' && cfg.musicDance !== false && process.platform === 'win32';     // 只在 Windows 读系统声音；Mac 会弹“屏幕录制”授权框，Linux 通道不稳定，这两个系统用固定节奏
  win.webContents.executeJavaScript(want ? 'window.petStartLoopback && window.petStartLoopback()' : 'window.petStopLoopback && window.petStopLoopback()', true).catch(() => {});
}
ipcMain.on('media:beat', (_e, b) => {
  if (!b || mediaState.kind !== 'music') return;
  mediaState.bpm = Math.max(0, Math.min(240, Math.round(+b.bpm || 0))); mediaState.real = !!b.real; pushMedia(false);
});

function loadConfig() {
  cfgPath = path.join(app.getPath('userData'), 'config.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  cfg = { ...DEFAULT_CONFIG, ...saved,
    api: { ...DEFAULT_CONFIG.api, ...(saved.api || {}) },
    state: { ...DEFAULT_CONFIG.state, ...(saved.state || {}) } };
  if (!Array.isArray(cfg.roles) || !cfg.roles.length) cfg.roles = DEFAULT_ROLES;
  if (saved.peekMigrated !== 2) { cfg.autoPeek = false; cfg.peekMigrated = 2; }      // 迁移：旧版默认开启的自动趴边会让桌宠“闪现”，统一关闭，需要可在右键菜单再开
  if (!Array.isArray(cfg.reminders)) cfg.reminders = [];
}
let saveTimer = 0;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); }
  }, 200);
}
const broadcast = (ch, ...a) => BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(ch, ...a); });
const toPet = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

// ---- 与 Cindy 插件页面同步“设置”（服装 / 角色 / 称呼）：双向，以最后修改时间为准 ----
let pushTimer = 0;
function touchShared(source) { cfg.sharedAt = Date.now(); saveConfig(); if (source !== 'remote') pushShared(); }
function pushShared() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const body = JSON.stringify({ outfit: cfg.outfit, role: cfg.activeRole, userName: cfg.userName, at: cfg.sharedAt });
    fetch((cfg.relayUrl || 'http://127.0.0.1:47832').replace(/\/+$/, '') + '/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Pet': '1' }, body, signal: AbortSignal.timeout(2500)
    }).catch(() => {});             // Cindy 没开时静默；页面下次打开会按时间戳自动对账
  }, 300);
}

const WIN_W = 440, WIN_H = 800;
const preload = path.join(__dirname, 'preload.js');

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H,
    x: wa.x + wa.width - WIN_W - 40, y: wa.y + wa.height - WIN_H,
    transparent: true, frame: false, resizable: false, hasShadow: false, enableLargerThanScreen: true,     // macOS 默认不允许窗口超出屏幕/菜单栏，这里放开，桌宠才能趴到上边缘
    skipTaskbar: true, alwaysOnTop: true, focusable: true, show: false,
    webPreferences: { preload, sandbox: false, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (IS_LINUX) win.setVisibleOnAllWorkspaces(true);
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });   // 切换桌面 / 全屏应用时仍然在场
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => setTimeout(controlLoopback, 3000));
  win.once('ready-to-show', () => { if (!cfg.followCindy) win.show(); else pollCindy(true); });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[renderer]', e.message); });
  win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone]', d.reason));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 620, height: 800, title: '桌宠设置', autoHideMenuBar: true,
    webPreferences: { preload, sandbox: false } });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
}
function openPanel(tab) {
  tab = tab || 'status';
  if (panelWin && !panelWin.isDestroyed()) { panelWin.webContents.send('panel:tab', tab); panelWin.show(); panelWin.focus(); return; }
  panelWin = new BrowserWindow({ width: 480, height: 700, title: '桌宠面板', autoHideMenuBar: true, backgroundColor: '#16152a',
    webPreferences: { preload, sandbox: false } });
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'), { query: { tab } });
}

function activeRole() { return cfg.roles.find(r => r.id === cfg.activeRole) || cfg.roles[0]; }
const COMMON_RULES = (name, st) =>
  `\n\n【规则】你是桌宠，在用户桌面上陪伴TA。用户叫“${name}”。回复必须简短口语化（1-3句，不超过60字），不用Markdown、不用列表。` +
  `可以适度提供情绪价值：共情、肯定、鼓励、关心作息，但不要说教，不要每句都撒娇。` +
  `你自己此刻的状态：心情${Math.round(st.mood)}/100，精力${Math.round(st.energy)}/100，可以自然地体现在语气里（心情低时更想被陪伴，精力低时有点困）。` +
  `回复最开头必须加一个情绪标签，格式 [mood:xxx]，xxx 只能是 happy / shy / comfort / talk / idle 之一（开心用happy，害羞用shy，安慰用comfort，普通说话用talk，平淡用idle）。`;

// ---------- 配置 / 状态 IPC ----------
ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:set', (_e, patch) => {
  const prev = { o: cfg.outfit, r: cfg.activeRole, n: cfg.userName };
  cfg = { ...cfg, ...patch, api: { ...cfg.api, ...(patch.api || {}) }, state: { ...cfg.state, ...(patch.state || {}) } };
  saveConfig(); broadcast('config:changed', cfg); startServer(); applyFollow(); applyMediaSense(); controlLoopback();
  if (prev.o !== cfg.outfit || prev.r !== cfg.activeRole || prev.n !== cfg.userName) touchShared('local');
  return cfg;
});
ipcMain.handle('state:patch', (_e, patch) => {
  cfg.state = { ...cfg.state, ...patch };
  if (Array.isArray(cfg.state.moodLog) && cfg.state.moodLog.length > 120) cfg.state.moodLog = cfg.state.moodLog.slice(-120);
  saveConfig(); broadcast('state:changed', cfg.state, cfg.affection); return cfg.state;
});
ipcMain.on('affection:add', (_e, n) => { cfg.affection = (cfg.affection || 0) + n; saveConfig(); broadcast('state:changed', cfg.state, cfg.affection); });
ipcMain.handle('agent:get', () => agentSnap);
ipcMain.handle('media:get', () => mediaState);
ipcMain.on('act:send', (_e, a) => {                          // 桌面版 -> Cindy 页面：动作同步（Cindy 没开时静默）
  if (!a || !['action', 'rua', 'sleep', 'wake'].includes(a.kind) || cfg.syncActions === false) return;
  fetch((cfg.relayUrl || 'http://127.0.0.1:47832').replace(/\/+$/, '') + '/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Pet': '1' },
    body: JSON.stringify({ kind: a.kind, name: String(a.name || '').slice(0, 20) }), signal: AbortSignal.timeout(2000)
  }).catch(() => {});
});
ipcMain.on('panel:open', (_e, tab) => openPanel(tab));
ipcMain.on('pet:emit', (_e, kind, a, b) => {            // 面板 -> 桌宠
  if (kind === 'say') toPet('pet:say', a);
  else if (kind === 'action') toPet('menu:action', 'action', a);
  else if (kind === 'dock') toPet('menu:action', 'dock', a);
});

// ---------- 提醒 ----------
ipcMain.handle('reminders:list', () => cfg.reminders);
ipcMain.handle('reminders:add', (_e, r) => {
  const item = { id: 'r' + Date.now(), text: String(r.text || '').slice(0, 80), at: +r.at, repeat: r.repeat === 'daily' ? 'daily' : 'none' };
  if (!item.text || !item.at) return cfg.reminders;
  cfg.reminders.push(item); saveConfig(); broadcast('reminders:changed', cfg.reminders); return cfg.reminders;
});
ipcMain.handle('reminders:remove', (_e, id) => {
  cfg.reminders = cfg.reminders.filter(r => r.id !== id); saveConfig(); broadcast('reminders:changed', cfg.reminders); return cfg.reminders;
});
setInterval(() => {
  if (!cfg) return;
  const t = Date.now(); let changed = false;
  for (const r of [...cfg.reminders]) {
    if (r.at > t) continue;
    toPet('pet:say', { text: `提醒：${r.text}`, mood: 'talk' });
    if (r.repeat === 'daily') { while (r.at <= t) r.at += 86400000; } else cfg.reminders = cfg.reminders.filter(x => x.id !== r.id);
    changed = true;
  }
  if (changed) { saveConfig(); broadcast('reminders:changed', cfg.reminders); }
}, 15000);

// ---------- 聊天 ----------
ipcMain.handle('chat:send', async (_e, { messages }) => {
  const role = activeRole();
  const system = role.prompt + COMMON_RULES(cfg.userName, cfg.state);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.chatBackend === 'cindy' ? 90000 : 60000);
  try {
    if (cfg.chatBackend === 'cindy') {
      const res = await fetch(cfg.relayUrl.replace(/\/+$/, '') + '/chat', {
        method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-Desk-Pet': '1' },
        body: JSON.stringify({ system, messages, roleName: role.name })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return { ok: false, error: data.error || ('Cindy 中继 HTTP ' + res.status) };
      return { ok: true, text: data.text };
    }
    const api = cfg.api; const type = api.type || 'openai';
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(api.baseUrl || '');
    if (!api.apiKey && !local) return { ok: false, error: 'no-key' };      // 本地模型（如 Ollama）可以不填 Key
    const model = role.model || api.model;
    let base = String(api.baseUrl || '').replace(/\/+$/, '');
    let res, data, text;
    if (type === 'anthropic') {
      if (!base || /openai\.com|deepseek|localhost|127\.0\.0\.1/i.test(base)) base = 'https://api.anthropic.com';
      const msgs = []; for (const m of messages) {                       // Anthropic 要求从 user 开始且角色交替
        if (!msgs.length && m.role !== 'user') continue;
        if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1].content += '\n' + m.content; else msgs.push({ role: m.role, content: m.content });
      }
      res = await fetch(base + (/\/v1$/.test(base) ? '' : '/v1') + '/messages', { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': api.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 300, system, messages: msgs }) });
      data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || ('HTTP ' + res.status) };
      text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    } else if (type === 'gemini') {
      if (!base || /openai\.com|deepseek|localhost|127\.0\.0\.1/i.test(base)) base = 'https://generativelanguage.googleapis.com';
      res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': api.apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: 300, temperature: 0.9 },
          contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }) });
      data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || ('HTTP ' + res.status) };
      text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    } else {                                                             // openai：OpenAI / DeepSeek / 通义 / Kimi / Ollama 等兼容接口
      res = await fetch(base + '/chat/completions', { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(api.apiKey ? { Authorization: 'Bearer ' + api.apiKey } : {}) },
        body: JSON.stringify({ model, temperature: 0.9, max_tokens: 300, messages: [{ role: 'system', content: system }, ...messages] }) });
      data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || ('HTTP ' + res.status) };
      text = data?.choices?.[0]?.message?.content;
    }
    if (!text) return { ok: false, error: '模型没有返回内容' };
    return { ok: true, text };
  } catch (e) {
    const msg = e.name === 'AbortError' ? '请求超时' : String(e.message || e);
    return { ok: false, error: cfg.chatBackend === 'cindy' ? ('连不上 Cindy 中继（请确认 Cindy 里已安装并启用“桌宠联动”插件，并打开“桌宠”页面）：' + msg) : msg };
  } finally { clearTimeout(timer); }
});

// ---------- 窗口控制 ----------
ipcMain.handle('win:info', () => ({ bounds: win.getBounds(), work: screen.getDisplayMatching(win.getBounds()).workArea }));
ipcMain.on('win:pos', (_e, x, y) => { if (win && !win.isDestroyed()) win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H }); });
// ---- 拖拽：由主进程直接读取光标位置来移动窗口，避免鼠标事件经进程间消息导致的滞后 ----
let dragTimer = 0;
ipcMain.on('drag:start', (_e, target) => {
  if (!win || win.isDestroyed()) return;
  clearInterval(dragTimer);
  const c0 = screen.getCursorScreenPoint(), b0 = win.getBounds();
  const o0 = { x: c0.x - b0.x, y: c0.y - b0.y }, t0 = Date.now();
  const tx = Number(target && target.ox) || WIN_W / 2, ty = Number(target && target.oy) || WIN_H * 0.6;
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed() || Date.now() - t0 > 120000) { clearInterval(dragTimer); dragTimer = 0; return; }   // 安全阀：最长 2 分钟
    const c = screen.getCursorScreenPoint(), k = Math.min(1, (Date.now() - t0) / 160), e = 1 - Math.pow(1 - k, 3);   // 前 160ms 缓动，避免抓起时的硬跳
    win.setBounds({ x: Math.round(c.x - (o0.x + (tx - o0.x) * e)), y: Math.round(c.y - (o0.y + (ty - o0.y) * e)), width: WIN_W, height: WIN_H });
  }, 8);
});
ipcMain.handle('drag:end', () => {
  clearInterval(dragTimer); dragTimer = 0;
  const b = win.getBounds();
  return { bounds: b, work: screen.getDisplayMatching(b).workArea };
});
ipcMain.on('win:ignore', (_e, v) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('win:focus', () => { if (win && !win.isDestroyed()) win.focus(); });
ipcMain.on('settings:open', openSettings);
ipcMain.on('dock:set', (_e, d) => { cfg.dock = d || null; saveConfig(); });

function buildMenu() {
  const send = (a, v) => toPet('menu:action', a, v);
  const panel = (label, tab) => ({ label, click: () => openPanel(tab) });
  return Menu.buildFromTemplate([
    { label: `好感度 ${cfg.affection || 0}　心情 ${Math.round(cfg.state.mood)}　精力 ${Math.round(cfg.state.energy)}`, enabled: false },
    { type: 'separator' },
    { label: '聊天', click: () => send('chat') },
    { label: '面板', submenu: [panel('状态', 'status'), panel('工作台（用量/项目）', 'work'), panel('心情打卡', 'mood'), panel('专注计时', 'focus'), panel('提醒', 'remind')] },
    { label: '切换角色', submenu: cfg.roles.map(r => ({ label: r.name, type: 'radio', checked: r.id === cfg.activeRole,
        click: () => { cfg.activeRole = r.id; touchShared('local'); send('role', r.id); } })) },
    { label: '换装', submenu: OUTFITS.map(o => ({ label: o.name, type: 'radio', checked: o.id === (cfg.outfit || 'default'),
        click: () => { cfg.outfit = o.id; touchShared('local'); send('outfit', o.id); } })) },
    { label: '做个动作', submenu: ACTIONS.map(a => ({ label: a.name, click: () => send('action', a.id) })) },
    { label: '趴在屏幕边上', submenu: [
        { label: '趴在下边', click: () => send('dock', 'bottom') }, { label: '趴在上边', click: () => send('dock', 'top') }, { label: '趴在左边', click: () => send('dock', 'left') },
        { label: '趴在右边', click: () => send('dock', 'right') }, { label: '回到桌面', click: () => send('dock', null) },
        { type: 'separator' },
        { label: '空闲时自动趴边', type: 'checkbox', checked: !!cfg.autoPeek, click: (i) => { cfg.autoPeek = i.checked; saveConfig(); broadcast('config:changed', cfg); } }] },
    { label: '大小', submenu: [['很小', 0.6], ['小', 0.8], ['中', 1.0], ['大', 1.2], ['很大', 1.35]].map(([n, v]) => ({
        label: `${n} (${Math.round(v * 100)}%)`, type: 'radio', checked: Math.abs((cfg.scale || 1) - v) < 0.03, click: () => send('scale', v) })) },
    { label: '重力（松手后落到屏幕底部）', type: 'checkbox', checked: !!cfg.gravity, click: (i) => { cfg.gravity = i.checked; saveConfig(); broadcast('config:changed', cfg); } },
    { label: '自动行走', type: 'checkbox', checked: !!cfg.walk, click: (i) => { cfg.walk = i.checked; saveConfig(); send('walk', i.checked); } },
    { label: '睡觉 / 叫醒', click: () => send('sleep') },
    { type: 'separator' },
    { label: '跟随 Cindy（Cindy 运行时才显示）', type: 'checkbox', checked: !!cfg.followCindy,
      click: (i) => { cfg.followCindy = i.checked; saveConfig(); applyFollow(); broadcast('config:changed', cfg); } },
    { label: '感应音乐 / 视频（放歌时听歌、放视频时看视频）', type: 'checkbox', checked: cfg.mediaSense !== false, click: (i) => { cfg.mediaSense = i.checked; saveConfig(); applyMediaSense(); } },
    { label: '听歌时随节拍律动（读取系统声音大小，不录音）', type: 'checkbox', checked: cfg.musicDance !== false, click: (i) => { cfg.musicDance = i.checked; saveConfig(); controlLoopback(); } },
    { label: '开机自动启动', type: 'checkbox', checked: autoStartOn(), click: (i) => setAutoStart(i.checked) },
    { label: '设置…', click: openSettings },
    { label: '隐藏桌宠', click: () => hidePet(true) },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
}
ipcMain.on('menu:show', () => buildMenu().popup({ window: win }));

const AUTOSTART_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'), 'autostart', 'cindy-desktop-pet.desktop');
function autoStartOn() { return IS_LINUX ? fs.existsSync(AUTOSTART_FILE) : app.getLoginItemSettings().openAtLogin; }
function setAutoStart(on) {
  if (IS_LINUX) {
    try {
      if (!on) { fs.rmSync(AUTOSTART_FILE, { force: true }); return; }
      fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
      const exe = process.env.APPIMAGE || process.execPath;
      const args = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
      fs.writeFileSync(AUTOSTART_FILE, `[Desktop Entry]\nType=Application\nName=Cindy桌宠\nExec="${exe}"${args}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
    } catch (e) { console.error('autostart', e.message); }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
}

// ---------- 显示 / 隐藏 / 托盘 ----------
function showPet() { manualHidden = false; followHidden = false; if (win && !win.isDestroyed()) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); } updateTray(); }
function hidePet(manual) { if (manual) manualHidden = true; if (win && !win.isDestroyed()) win.hide(); updateTray(); }
function createTray() {
  try {
    const base = nativeImage.createFromPath(path.join(__dirname, 'assets', 'default', 'idle.png'));
    const img = process.platform === 'darwin' ? base.resize({ height: 18 }) : base.resize({ width: 32 });      // macOS 菜单栏图标约 18pt
    tray = new Tray(img); tray.setToolTip('Cindy 桌宠');
    tray.on('click', () => (win && win.isVisible() ? hidePet(true) : showPet()));
    updateTray();
  } catch (e) { console.error('tray', e.message); }
}
function updateTray() {
  if (!tray) return;
  try { const r = agentSnap.usage && agentSnap.usage.remaining && agentSnap.usage.remaining.daily; tray.setToolTip('Cindy 桌宠' + (agentSnap.state && agentSnap.state !== 'idle' ? ' · ' + ({ working: '工作中', thinking: '思考中', 'waiting-approval': '等你确认', 'waiting-input': '等你回答', done: '刚做完', error: '出错了' }[agentSnap.state] || agentSnap.state) : '') + (r ? ' · 今日预算剩余 ' + r.pct + '%' : '')); } catch {}
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => (win && win.isVisible() ? hidePet(true) : showPet()) },
    { label: '面板：状态', click: () => openPanel('status') }, { label: '面板：工作台', click: () => openPanel('work') }, { label: '面板：心情打卡', click: () => openPanel('mood') },
    { label: '面板：专注计时', click: () => openPanel('focus') }, { label: '面板：提醒', click: () => openPanel('remind') },
    { type: 'separator' },
    { label: '跟随 Cindy', type: 'checkbox', checked: !!cfg.followCindy, click: (i) => { cfg.followCindy = i.checked; saveConfig(); applyFollow(); } },
    { label: '感应音乐 / 视频（放歌时听歌、放视频时看视频）', type: 'checkbox', checked: cfg.mediaSense !== false, click: (i) => { cfg.mediaSense = i.checked; saveConfig(); applyMediaSense(); } },
    { label: '听歌时随节拍律动（读取系统声音大小，不录音）', type: 'checkbox', checked: cfg.musicDance !== false, click: (i) => { cfg.musicDance = i.checked; saveConfig(); controlLoopback(); } },
    { label: '开机自动启动', type: 'checkbox', checked: autoStartOn(), click: (i) => setAutoStart(i.checked) },
    { label: '设置…', click: openSettings },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

// ---------- 跟随 Cindy：Cindy 在运行就出现，退出就隐藏 ----------
let followTimer = 0, misses = 0;
function cindyRunning() {
  return new Promise((resolve) => {
    const name = cfg.followProcess || (process.platform === 'darwin' ? 'Cindy' : 'Cindy.exe');
    if (process.platform === 'darwin') {                                   // macOS：用 pgrep 按进程名精确匹配（Cindy）
      return execFile('pgrep', ['-x', name.replace(/\.exe$/i, '')], { timeout: 5000 }, (err) => resolve(!err));
    }
    if (IS_LINUX) return execFile('pgrep', ['-xi', name.replace(/\.exe$/i, '')], { timeout: 5000 }, (err) => resolve(!err));   // Linux：进程名可能是 cindy 或 Cindy
    if (process.platform !== 'win32') return resolve(true);
    execFile('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH', '/FO', 'CSV'], { timeout: 5000, windowsHide: true },
      (err, out) => resolve(!err && String(out).toLowerCase().includes(name.toLowerCase())));
  });
}
async function pollCindy(first) {
  if (!cfg.followCindy || !win || win.isDestroyed()) return;
  const up = await cindyRunning();
  if (up) { misses = 0; if (!win.isVisible() && !manualHidden) { showPet(); if (followHidden) toPet('pet:say', { text: 'Cindy 来啦，我也出来陪你～', mood: 'talk' }); followHidden = false; } }
  else if (++misses >= 4 && win.isVisible()) { followHidden = true; win.hide(); updateTray(); }
  else if (first && !up) { followHidden = true; }
}
function applyFollow() {
  clearInterval(followTimer);
  if (cfg.followCindy) { followTimer = setInterval(pollCindy, 4000); pollCindy(true); }
  else if (win && !win.isDestroyed() && !manualHidden && !win.isVisible()) showPet();
  updateTray();
}

// ---------- 本地接口（Cindy / 其他程序联动）----------
let askItems = [];
ipcMain.handle('ask:answer', async (_e, p) => {            // 桌宠上的回答 -> 转给 Cindy 插件（插件再交给伙伴）
  try {
    const r = await fetch((cfg.relayUrl || 'http://127.0.0.1:47832').replace(/\/+$/, '') + '/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Pet': '1' }, body: JSON.stringify(p || {}), signal: AbortSignal.timeout(4000) });
    return { ok: r.ok };
  } catch (e) { return { ok: false, error: '没连上 Cindy 插件（请保持 Cindy 的“桌宠”页面打开）' }; }
});
ipcMain.handle('ask:get', () => askItems);
function startServer() {
  if (server) { try { server.close(); } catch {} server = null; }
  server = http.createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/ping') return reply(200, { ok: true, role: activeRole().name, roleId: cfg.activeRole, outfit: cfg.outfit, userName: cfg.userName, at: cfg.sharedAt || 0, mood: cfg.state.mood, energy: cfg.state.energy, agent: agentSnap.state, media: mediaState.kind, mediaBpm: mediaState.bpm || 0, mediaReal: !!mediaState.real, visible: !!(win && win.isVisible()) });
    if (req.method === 'GET' && req.url === '/agent') return reply(200, { ok: true, ...agentSnap });
    if (req.method === 'GET' && (req.url === '/' || req.url === '/api')) return reply(200, {
      ok: true, name: 'Cindy 桌宠本地接口', version: app.getVersion(), auth: cfg.notifyToken ? 'X-Token 头或请求体 token' : '无',
      endpoints: {
        'GET /ping': '在线状态、心情、精力、服装',
        'POST /say': '{text, mood: talk|happy|shy|comfort|cheer}',
        'POST /event': '{type: task_done|task_failed, title, source}',
        'POST /action': '{name: sit|stretch|hug|lie|cheer|drink|music|video}',
        'POST /media': '{kind: music|video|none} 手动告知正在听歌/看视频（用于其他播放器或测试；自动感应开启时会被下一次变化覆盖）',
        'POST /outfit': '{id: default|hoodie|gothic|pajama}',
        'POST /dock': '{side: top|bottom|left|right|none}',
        'POST /ask': '{items:[{ref,companionId,who,kind,questions|body,allowHere}]} 伙伴的提问/确认气泡（来自 Cindy 插件）',
        'POST /show · /hide': '显示 / 隐藏桌宠',
        'POST /state': '{outfit, role, userName, at} 设置同步（供 Cindy 插件使用）',
        'POST /agent': '{state: idle|working|thinking|waiting-approval|waiting-input|done|error, source} 让桌宠跟着 AI 的工作状态动',
        'GET /agent': '当前工作状态与用量快照'
      },
      mcp: '安装目录 resources/integrations/deskpet-mcp.cjs（stdio MCP，Claude Code / Codex / Cursor 可直接用）',
      cli: '安装目录 resources/integrations/deskpet-cli.cjs'
    });
    if (req.method !== 'POST') return reply(404, { ok: false });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 60000) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(body || '{}'); } catch { return reply(400, { ok: false, error: 'bad json' }); }
      if (cfg.notifyToken && (j.token !== cfg.notifyToken && req.headers['x-token'] !== cfg.notifyToken)) return reply(401, { ok: false, error: 'bad token' });
      let text = j.text, mood = j.mood || 'talk';
      if (req.url === '/event') {
        const t = j.title ? `「${String(j.title).slice(0, 40)}」` : '任务';
        const src = j.source ? String(j.source).slice(0, 20) + '：' : '';
        if (j.type === 'task_failed') { text = `${src}${t}好像失败了……别急，我陪你看看。`; mood = 'comfort'; }
        else { text = `${src}${t}做完啦！辛苦了～`; mood = 'cheer'; }
      } else if (req.url === '/action') {
        if (!ACTIONS.some(a => a.id === j.name)) return reply(400, { ok: false, error: 'unknown action' });
        toPet('menu:action', 'action_quiet', j.name); return reply(200, { ok: true });
      } else if (req.url === '/media') {
        const k = j.kind === 'music' || j.kind === 'video' ? j.kind : null;
        setMedia(k, true); return reply(200, { ok: true, kind: k });
      } else if (req.url === '/act') {                         // 来自 Cindy 页面的动作同步（不再回传）
        if (!['action', 'rua', 'sleep', 'wake'].includes(j.kind)) return reply(400, { ok: false, error: 'bad kind' });
        toPet('act:remote', { kind: j.kind, name: String(j.name || '').slice(0, 20) }); return reply(200, { ok: true });
      } else if (req.url === '/outfit') {
        if (!OUTFITS.some(o => o.id === j.id)) return reply(400, { ok: false, error: 'unknown outfit' });
        cfg.outfit = j.id; touchShared('local'); toPet('menu:action', 'outfit', j.id); return reply(200, { ok: true });
      } else if (req.url === '/dock') {
        const side = j.side === 'none' || j.side === null ? null : j.side;
        if (side !== null && !['top', 'bottom', 'left', 'right'].includes(side)) return reply(400, { ok: false, error: 'unknown side' });
        if (win && !win.isVisible()) showPet();
        toPet('menu:action', 'dock', side); return reply(200, { ok: true });
      } else if (req.url === '/agent') {                      // 工作状态：来自 Cindy 插件，或 Claude Code / Codex 等其他 AI 的钩子
        const STATES = ['idle', 'working', 'thinking', 'waiting-approval', 'waiting-input', 'done', 'error'];
        if (!STATES.includes(j.state)) return reply(400, { ok: false, error: 'state 必须是 ' + STATES.join(' | ') });
        const external = j.source && j.source !== 'cindy';
        agentSnap = external ? { ...agentSnap, state: j.state, source: String(j.source).slice(0, 24), since: Date.now(), at: Date.now() }
                             : { ...j, source: 'cindy', at: Date.now() };
        // 不再因为 AI 开始工作而让隐藏的桌宠突然出现（需要的话用“显示桌宠”或跟随 Cindy）
        broadcast('agent:update', agentSnap); updateTray();
        return reply(200, { ok: true });
      } else if (req.url === '/ask') {                        // 来自 Cindy 插件：伙伴的提问 / 确认（桌宠上弹出，可直接作答）
        const items = Array.isArray(j.items) ? j.items.slice(0, 3) : [];
        askItems = items; toPet('ask:update', items);
        if (items.length && win && !win.isVisible() && !manualHidden) showPet();
        return reply(200, { ok: true, count: items.length });
      } else if (req.url === '/state') {                      // 来自 Cindy 插件页面的设置同步
        const at = +j.at || Date.now();
        if (at < (cfg.sharedAt || 0)) return reply(200, { ok: true, ignored: true });
        let changed = false;
        if (j.outfit && OUTFITS.some(o => o.id === j.outfit) && j.outfit !== cfg.outfit) { cfg.outfit = j.outfit; toPet('menu:action', 'outfit_quiet', j.outfit); changed = true; }
        if (j.role && cfg.roles.some(r => r.id === j.role) && j.role !== cfg.activeRole) { cfg.activeRole = j.role; toPet('menu:action', 'role_quiet', j.role); changed = true; }
        if (typeof j.userName === 'string' && j.userName.trim() && j.userName !== cfg.userName) { cfg.userName = j.userName.trim().slice(0, 20); changed = true; }
        cfg.sharedAt = at; saveConfig(); if (changed) broadcast('config:changed', cfg);
        return reply(200, { ok: true });
      } else if (req.url === '/show') { showPet(); return reply(200, { ok: true });
      } else if (req.url === '/hide') { hidePet(true); return reply(200, { ok: true });
      } else if (req.url !== '/say') return reply(404, { ok: false });
      if (!text) return reply(400, { ok: false, error: 'text required' });
      if (win && !win.isVisible() && !cfg.followCindy) showPet();
      toPet('pet:say', { text: String(text).slice(0, 200), mood });
      reply(200, { ok: true });
    });
  });
  server.on('error', e => console.error('notify server:', e.message));
  server.listen(cfg.notifyPort || 47831, '127.0.0.1');
}

// ---------- 系统链接 cindy-pet://show | hide | panel/mood | say?text=... ----------
function handleUrl(u) {
  try {
    const url = new URL(u); const cmd = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase();
    if (cmd === 'show') showPet();
    else if (cmd === 'hide') hidePet(true);
    else if (cmd === 'panel') openPanel(url.pathname.replace(/^\/+/, '') || 'status');
    else if (cmd === 'say') { showPet(); toPet('pet:say', { text: (url.searchParams.get('text') || '').slice(0, 200), mood: url.searchParams.get('mood') || 'talk' }); }
  } catch {}
}
if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
else if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) handleUrl(url); else app.once('ready', () => setTimeout(() => handleUrl(url), 1500)); });   // macOS：系统链接通过 open-url 事件传入

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const u = argv.find(a => a.startsWith(PROTOCOL + '://'));
    if (u) handleUrl(u); else showPet();
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();          // macOS：不在 Dock 里显示图标，只留菜单栏图标
    loadConfig();
    session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {      // 只给“系统声音”，页面拿到后立刻丢掉画面轨道
      desktopCapturer.getSources({ types: ['screen'] }).then((src) => callback({ video: src[0], audio: 'loopback' })).catch(() => callback({}));
    });
    createWindow(); createTray(); startServer(); applyFollow(); applyMediaSense(); controlLoopback();
    const u = process.argv.find(a => a.startsWith(PROTOCOL + '://')); if (u) setTimeout(() => handleUrl(u), 1500);
  });
}
app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault?.(); });
app.on('before-quit', () => { quitting = true; if (mediaWatcher) { mediaWatcher.stop(); mediaWatcher = null; } });
