'use strict';
const $ = (s) => document.querySelector(s);
const sprite = $('#sprite'), bubble = $('#bubble'), chat = $('#chat'), logEl = $('#log'), fx = $('#fx');
const WIN_W = 440, WIN_H = 800, BASE_H = 360;

let cfg = null;
const sets = {};      // 服装 -> { 姿势名 -> { url, w, h, mask, bbox:{t,b,h} } }
let imgs = {};        // 当前服装的素材
let outfit = 'default';
const POSE_FILES = ['idle', 'happy', 'talk', 'comfort', 'sleep', 'shy'];
const WORK_FILES = ['work_type', 'work_read', 'work_think', 'work_wait', 'work_error', 'work_sleep'];
const ACTION_FILES = ['sit', 'stretch', 'hug', 'lie', 'cheer', 'drink'];
const WALK_FILES = ['walk1', 'walk2', 'walk3', 'walk4'];
const PEEK_FILES = ['peek_b_idle', 'peek_b_sleep', 'peek_b_happy', 'peek_s_idle', 'peek_s_sleep', 'peek_s_happy', 'peek_t_idle', 'peek_t_sleep', 'peek_t_happy'];
const PEEK_K = 0.92;     // 趴边图相对站立图的大小系数
const OUTFIT_NAMES = { default: '默认针织衫', hoodie: '猫耳帽卫衣', gothic: '哥特洛丽塔', pajama: '星星睡衣' };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => performance.now();

// ---------- 台词 ----------
const LINES = {
  poke: ['……干嘛。', '戳我做什么？', '嗯？有事吗。', '别戳啦，会痒。', '黑猫说：喵。', '我在呢。'],
  rua: ['唔……再摸一下也不是不行。', '头发要乱啦……不过，舒服。', '咕……才没有很开心。', '嘿嘿……(小声)', '好舒服……继续也可以。', '被你摸摸，感觉今天没那么累了。'],
  drag: ['呀！放我下来……', '要被抓走了吗？', '轻一点啦！', '高处好可怕……'],
  wake: ['唔……我没睡着。', '啊，你回来了。', '嗯？天亮了吗……'],
  fall: ['落地。', '稳稳站住。', '呼，吓我一跳。'],
  chatOpen: ['想聊点什么？', '我在听。', '说吧，我不会笑你的。'],
  noKey: ['（我现在还不会说很多话——右键「设置」填上 AI 接口，就能真正聊天了。）'],
  tired: ['听起来你累了……先坐下来，喝口水吧。', '辛苦了。今天已经很努力啦。', '累了就休息一下，世界不会因此停转的。'],
  sad: ['过来，我陪着你。想说就说，不想说我就安静待着。', '难过的时候，不用硬撑。我在这儿。', '抱一下。……黑猫也给你蹭蹭。'],
  praise: ['你已经做得很好了，真的。', '我一直都看着呢，你很棒。', '偷偷告诉你，我为你骄傲。'],
  sleepy: ['这么晚了……早点睡吧，我也困了。', '熬夜不好哦，明天的你会感谢现在睡觉的你。'],
  fallback: ['嗯，我听着呢。', '这样啊……然后呢？', '我在这里陪你。', '嗯嗯，继续说吧。']
};
const CARE = {
  water: ['该喝口水啦。', '你已经坐很久了，喝点水吧。'],
  stretch: ['站起来动一动吧，肩膀会谢谢你。', '看看远处，让眼睛休息一下～'],
  night: ['已经很晚了，该睡了哦。', '别熬太晚，我会担心的。'],
  meal: ['有没有好好吃饭？', '饿了就去吃东西，别硬撑。']
};
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '这么晚还没睡……我陪你一会儿，但别太晚。';
  if (h < 11) return '早上好。今天也一起加油吧。';
  if (h < 14) return '中午啦，记得吃饭。';
  if (h < 18) return '下午好，要不要喝点水？';
  if (h < 23) return '晚上好，今天辛苦了。';
  return '夜深了，快去休息吧。';
}

// ---------- 素材 ----------
async function loadImage(o, name, store) {
  const bytes = window.pet.asset(o + '/' + name + '.png');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const mask = new Uint8Array(c.width * c.height);
  let top = c.height, bot = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 40) { mask[y * c.width + x] = 1; if (y < top) top = y; if (y > bot) bot = y; }
  }
  store[name] = { url, w: c.width, h: c.height, mask, bbox: { t: top, b: bot, h: bot - top + 1 } };
}
async function loadOutfit(o) {
  if (sets[o]) return sets[o];
  const store = {};
  const names = [...POSE_FILES, ...WALK_FILES, ...ACTION_FILES, ...WORK_FILES, 'held1', 'held2'];
  await Promise.all(names.map(n => loadImage(o, n, store)));
  await Promise.all(PEEK_FILES.map(async n => { try { await loadImage(o, n, store); } catch { await loadImage('default', n, store); } }));
  sets[o] = store; return store;
}
async function setOutfit(o, announce) {
  if (!OUTFIT_NAMES[o]) o = 'default';
  imgs = await loadOutfit(o); outfit = o; render();
  if (announce) { setPose(imgs.cheer ? 'cheer' : 'talk', 2500); hearts(2); say('换好啦：' + OUTFIT_NAMES[o] + '。怎么样？', 5000); }
}

// ---------- 状态 ----------
let pose = 'idle';           // 当前显示的姿势名（POSE_FILES 之一）或 'walk'
let walkFrame = 0, facing = 1; // 1=向右
let busyUntil = 0;           // 临时姿势持续到
let tempPose = null;
let lastInteract = now();
let sleeping = false;
let chatOpen = false;
let dragging = false;
let walking = null;          // { targetX }
let winX = 0, winY = 0, work = { x: 0, y: 0, width: 1920, height: 1080 };
let nextDecision = now() + 5000;
let lastCare = now();
const history = [];

let freeX = null, freeY = null;                      // 趴边之前的位置
let dock = null, dockUntil = 0, dockAuto = false;   // dock: null | 'bottom' | 'left' | 'right'
function peekVariant() {
  if (pose === 'sleep' || pose === 'lie' || pose === 'work_sleep') return 'sleep';
  if (['happy', 'talk', 'cheer', 'shy', 'work_wait'].includes(pose)) return 'happy';
  return 'idle';
}
function curImg() {
  if (dock) return imgs[(dock === 'bottom' ? 'peek_b_' : dock === 'top' ? 'peek_t_' : 'peek_s_') + peekVariant()];
  if (pose === 'walk') return imgs[WALK_FILES[walkFrame % 4]];
  return imgs[pose] || imgs.idle;
}
let dragDir = 1;           // 拖动时的水平方向：1 向右，-1 向左（被拎起的姿势按方向镜像）
const isHeld = () => pose === 'held1' || pose === 'held2';
const isFlipped = () => (dock ? dock === 'right' : isHeld() ? dragDir < 0 : pose === 'walk' && facing < 0);
function render() {
  const im = curImg(); if (!im) return;
  // 行走图单独按自身身高归一；其余姿势统一按 idle 的身高归一，保持各动作相对大小
  const ref = pose === 'walk' && !dock ? im.bbox.h : imgs.idle.bbox.h;
  const s = (BASE_H * (cfg?.scale || 1)) / ref * (dock ? PEEK_K : 1);
  sprite.src = im.url;
  sprite.style.width = im.w * s + 'px'; sprite.style.height = im.h * s + 'px';
  sprite.classList.toggle('flip', !dock && ((pose === 'walk' && facing < 0) || (isHeld() && dragDir < 0)));
  sprite.classList.toggle('bob', !dock && pose === 'walk');
  sprite.classList.toggle('breath', !dock && pose === 'idle');
  sprite.classList.toggle('dock-b', dock === 'bottom');
  sprite.classList.toggle('dock-t', dock === 'top');
  sprite.classList.toggle('dock-l', dock === 'left');
  sprite.classList.toggle('dock-r', dock === 'right');
  placeBubble(); if (chatOpen) placeChat();
}
function setPose(p, ms = 0) {
  tempPose = ms ? p : null;
  busyUntil = ms ? now() + ms : 0;
  pose = p; render();
}
function spriteTop() { const r = sprite.getBoundingClientRect(); const im = curImg(); const s = r.height / im.h; return r.top + im.bbox.t * s; }
function placeBubble() {
  const top = spriteTop();
  if (dock === 'top') {                               // 趴在上边缘：气泡显示在下方，箭头朝上
    const r = sprite.getBoundingClientRect();
    bubble.classList.add('below'); bubble.style.bottom = 'auto'; bubble.style.top = (r.bottom + 16) + 'px'; bubble.style.left = '50%';
    return;
  }
  bubble.classList.remove('below'); bubble.style.top = '';
  bubble.style.bottom = (WIN_H - top + 14) + 'px';
  if (dock === 'left' || dock === 'right') {        // 贴边时气泡跟着露出来的身体走，别超出窗口
    const r = sprite.getBoundingClientRect(); const half = 150;
    bubble.style.left = Math.max(half, Math.min(WIN_W - half, r.left + r.width / 2)) + 'px';
  } else bubble.style.left = '50%';
}

// ---------- 气泡 / 聊天 ----------
let bubbleTimer = 0;
function say(text, ms) {
  if (chatOpen) { addMsg('bot', text); return; }
  bubble.textContent = text; bubble.classList.remove('hidden'); placeBubble();
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms || Math.min(9000, 2800 + text.length * 120));
}
bubble.addEventListener('click', () => bubble.classList.add('hidden'));
function addMsg(who, text) {
  const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 60) logEl.firstChild.remove();
}
function activeRole() { return cfg.roles.find(r => r.id === cfg.activeRole) || cfg.roles[0]; }
// 聊天框：默认停在桌宠头顶上方（趴在上边缘时放在下方），不挡住桌宠；也可以按住标题栏拖动，双击标题栏复位
let chatManual = false, chatDrag = null;
function placeChat() {
  if (chatManual || !imgs.idle) return;
  const sIdle = (BASE_H * (cfg?.scale || 1)) / imgs.idle.bbox.h;                 // 用站立姿势估算头顶位置，避免聊天框随姿势跳动
  const headTop = dock === 'top' ? 0 : WIN_H - imgs.idle.h * sIdle + imgs.idle.bbox.t * sIdle;
  let h, top;
  if (dock === 'top') { const r = sprite.getBoundingClientRect(); top = r.bottom + 12; h = Math.max(130, Math.min(260, WIN_H - top - 10)); }
  else { h = Math.max(130, Math.min(260, headTop - 22)); top = Math.max(6, headTop - h - 10); }
  chat.style.top = top + 'px'; chat.style.height = h + 'px'; chat.style.left = '10px';
}
$('#chat-head').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  const r = chat.getBoundingClientRect(); chatDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; chatManual = true; e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!chatDrag) return;
  const w = chat.offsetWidth, h = chat.offsetHeight;
  chat.style.left = Math.max(0, Math.min(WIN_W - w, e.clientX - chatDrag.dx)) + 'px';
  chat.style.top = Math.max(0, Math.min(WIN_H - 40, e.clientY - chatDrag.dy)) + 'px';
});
window.addEventListener('mouseup', () => { chatDrag = null; });
$('#chat-head').addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; chatManual = false; placeChat(); });
function openChat() {
  chatOpen = true; walking = null; chat.classList.remove('hidden'); bubble.classList.add('hidden'); placeChat();
  $('#chat-role').textContent = '与「' + activeRole().name + '」聊天';
  window.pet.focus(); setTimeout(() => $('#chat-input').focus(), 50);
  if (!logEl.children.length) addMsg('bot', pick(LINES.chatOpen));
  setPose('talk', 2500);
}
function closeChat() { chatOpen = false; chat.classList.add('hidden'); }
$('#chat-close').onclick = closeChat;

const MOOD_POSE = { happy: 'talk', talk: 'talk', shy: 'shy', comfort: 'comfort', idle: 'idle', sleep: 'sleep' };
function reactMood(mood, ms = 4500) { if (ACTION_INFO[mood] && imgs[mood]) return doAction(mood, true); setPose(MOOD_POSE[mood] || 'talk', ms); }

function localReply(text) {
  if (/累|困|疲|熬|加班|忙/.test(text)) return { mood: 'comfort', text: pick(LINES.tired) };
  if (/难过|伤心|烦|焦虑|崩溃|哭|孤独|失眠|压力|不开心|委屈/.test(text)) return { mood: 'comfort', text: pick(LINES.sad) };
  if (/完成|做完|成功|搞定|通过|升职|开心|高兴/.test(text)) return { mood: 'happy', text: pick(LINES.praise) };
  if (/晚安|睡/.test(text)) return { mood: 'shy', text: pick(LINES.sleepy) };
  return { mood: 'talk', text: pick(LINES.fallback) };
}
function parseReply(t) {
  const m = /^\s*\[mood:(\w+)\]\s*/i.exec(t);
  return { mood: m ? m[1].toLowerCase() : 'talk', text: t.replace(/^\s*\[mood:\w+\]\s*/i, '').trim() };
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-input'); const text = input.value.trim(); if (!text) return;
  input.value = ''; lastInteract = now(); wake(true); bump(2, 0, { chatTotal: (cfg.state.chatTotal || 0) + 1 });
  addMsg('user', text); history.push({ role: 'user', content: text });
  const thinking = document.createElement('div'); thinking.className = 'msg sys'; thinking.textContent = '……'; logEl.appendChild(thinking); logEl.scrollTop = logEl.scrollHeight;
  setPose('talk', 20000);
  const r = await window.pet.chat(history.slice(-16));
  thinking.remove();
  let out;
  if (r.ok) out = parseReply(r.text);
  else if (r.error === 'no-key') { out = localReply(text); addMsg('sys', pick(LINES.noKey)); }
  else { addMsg('sys', '（接口出错：' + r.error + '）'); out = localReply(text); }
  history.push({ role: 'assistant', content: out.text });
  addMsg('bot', out.text); reactMood(out.mood);
  if (out.mood === 'happy' || out.mood === 'shy') window.pet.addAffection(1);
});

// ---------- 特效 ----------
function hearts(n = 1) {
  const r = sprite.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const h = document.createElement('div'); h.className = 'heart'; h.textContent = pick(['💗', '💖', '✨', '💕']);
    h.style.left = (r.left + r.width * rand(.25, .75)) + 'px'; h.style.top = (spriteTop() + 20) + 'px';
    fx.appendChild(h); setTimeout(() => h.remove(), 1500);
  }
}

// ---------- 命中检测 & 穿透 ----------
let ignoring = false;
function hitSprite(cx, cy) {
  const r = sprite.getBoundingClientRect(); const im = curImg();
  if (!im || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
  let lx = (cx - r.left) / r.width; const ly = (cy - r.top) / r.height;
  if (isFlipped()) lx = 1 - lx;
  const px = Math.min(im.w - 1, Math.floor(lx * im.w)), py = Math.min(im.h - 1, Math.floor(ly * im.h));
  if (!im.mask[py * im.w + px]) return null;
  const rel = (py - im.bbox.t) / im.bbox.h;
  return { head: rel < 0.4 };
}
function isUi(cx, cy) { const el = document.elementFromPoint(cx, cy); return !!(el && el.closest('.ui')); }
function updateIgnore(cx, cy) {
  const hit = dragging || !!chatDrag || !!hitSprite(cx, cy) || isUi(cx, cy);
  if (hit === ignoring) { ignoring = !hit; window.pet.ignore(ignoring); }
}

// ---------- 鼠标交互：rua / 戳 / 拖拽 ----------
let lastScreenY = 0;
let strokes = []; let ruaUntil = 0; let ruaTimer = 0; let ruaCount = 0;
let down = null; let lastMouse = null;
window.addEventListener('mousemove', (e) => {
  updateIgnore(e.clientX, e.clientY); lastScreenY = e.screenY;
  const hit = hitSprite(e.clientX, e.clientY);
  if (down) {
    const dx = e.screenX - down.sx, dy = e.screenY - down.sy;
    if (!down.moved && Math.hypot(dx, dy) > 6) { down.moved = true; dragging = true; walking = null; sleeping = false; if (dock) { dock = null; dockAuto = false; window.pet.setDock(null); } setPose(imgs.held1 ? 'held1' : 'shy', 60000); if (Math.random() < .5) say(pick(LINES.drag));
      const r0 = sprite.getBoundingClientRect(); window.pet.dragStart({ ox: WIN_W / 2, oy: r0.top + r0.height * 0.14 });   // 由主进程直接跟随光标，把桌宠“挂”在光标正下方
    }
    if (down.moved) {
      tiltTarget = Math.max(-12, Math.min(12, e.movementX * 1.1));
      if (Math.abs(e.movementX) > 1.5 && (e.movementX > 0 ? 1 : -1) !== dragDir) { dragDir = e.movementX > 0 ? 1 : -1; render(); }
    }
  } else if (hit && lastMouse) {
    // 在头部来回移动 = rua
    if (hit.head) {
      const d = Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
      const t = now(); strokes.push({ t, d }); strokes = strokes.filter(s => t - s.t < 1200);
      if (strokes.reduce((a, s) => a + s.d, 0) > 260) startRua();
    }
  }
  lastMouse = { x: e.clientX, y: e.clientY };
});
function startRua() {
  lastInteract = now(); wake(true);
  walking = null; ruaUntil = now() + 1600;
  if (pose !== 'happy') {
    setPose('happy', 60000); hearts(3);
    say(pick(LINES.rua)); ruaCount++; syncAct('rua'); bump(3, 0, { ruaTotal: (cfg.state.ruaTotal || 0) + 1 });
    if (ruaCount % 3 === 0) window.pet.addAffection(1);
    clearInterval(ruaTimer);
    ruaTimer = setInterval(() => {
      if (now() > ruaUntil) { clearInterval(ruaTimer); setPose(restPose()); nextDecision = now() + 4000; }
      else hearts(1);
    }, 450);
  }
}
window.addEventListener('mousedown', async (e) => {
  if (e.button === 2) { if (hitSprite(e.clientX, e.clientY)) window.pet.menu(); return; }
  if (e.button !== 0 || !hitSprite(e.clientX, e.clientY)) return;
  const info = await window.pet.info();
  winX = info.bounds.x; winY = info.bounds.y; work = info.work;
  down = { sx: e.screenX, sy: e.screenY, wx: winX, wy: winY, moved: false, head: hitSprite(e.clientX, e.clientY).head };
  if (glide) { glide = null; setPose('idle'); }            // 正在走路时被抓住：立刻停下
  lastInteract = now(); wake(true);
});
window.addEventListener('mouseup', async () => {
  if (!down) return;
  const d = down; down = null;
  if (d.moved) {
    try { const info = await window.pet.dragEnd(); winX = info.bounds.x; winY = info.bounds.y; work = info.work; } catch {}   // 停止跟随光标，取回最终位置（也可能拖到了另一块屏幕）
    dragging = false; setPose(cfg.gravity && imgs.held2 && winY < groundY() - 2 ? 'held2' : 'idle');
    const cxm = winX + WIN_W / 2;                       // 拖到屏幕左右边缘附近 = 趴上去
    if (lastScreenY < work.y + 90) dockTo('top', false);
    else if (cxm < work.x + 150) dockTo('left', false); else if (cxm > work.x + work.width - 150) dockTo('right', false); else if (cfg.gravity) startFall();
  }
  else if (!chatOpen) { setPose(d.head ? 'talk' : 'shy', 1800); say(pick(LINES.poke)); bump(0.5, 0); }
});
window.addEventListener('dblclick', (e) => { if (hitSprite(e.clientX, e.clientY)) openChat(); });
window.addEventListener('contextmenu', (e) => { e.preventDefault(); });

// ---------- 动作 ----------
const ACTION_INFO = {
  sit:     { ms: 9000, lines: ['坐一会儿。', '腿有点累了……'] },
  stretch: { ms: 3500, lines: ['嗯——(伸懒腰)', '哈啊……好困。'] },
  hug:     { ms: 6500, lines: ['黑猫不许跑，让我抱一下。', '喵：……(被迫营业)'] },
  lie:     { ms: 12000, lines: ['趴一下，就一下。', 'zzz……'] },
  cheer:   { ms: 2600, lines: ['耶！', '太好啦！'] },
  drink:   { ms: 6500, lines: ['小口小口……好暖。', '你也要喝点水哦。'] }
};
function doAction(name, quiet) {
  const info = ACTION_INFO[name]; if (!info || !imgs[name]) { if (!imgs[name]) say('这套衣服还没有这个动作，换回默认针织衫试试～'); return; }
  walking = null; wake(true);
  if (dock || glide) { if (!glide) undock(true, () => doAction(name, quiet)); return; }   // 趴着时先走回桌面再做动作，不再瞬移
  setPose(name, info.ms);
  if (name === 'cheer') { hearts(3); bump(1.5, 0); }
  if (name === 'drink') bump(1, 8);
  if (name === 'stretch') bump(0, 5);
  if (name === 'hug') bump(2, 0);
  if (!quiet && Math.random() < .7) say(pick(info.lines), Math.min(info.ms, 4500));
}

// ---------- 大小 ----------
async function setScale(v) {
  v = Math.max(0.5, Math.min(1.4, Math.round(v * 100) / 100));
  cfg = await window.pet.setConfig({ scale: v }); render();
}
window.addEventListener('wheel', (e) => {            // 在桌宠身上滚轮 = 调大小
  if (!hitSprite(e.clientX, e.clientY)) return;
  e.preventDefault(); setScale((cfg.scale || 1) + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

// ---------- 趴在屏幕边上 ----------
// 不再瞬移：走到边缘再趴下，回桌面时也是走回去。窗口平滑移动，期间用行走姿势。
let glide = null;
function glideTo(tx, ty, done) {
  const dist = Math.hypot(tx - winX, ty - winY);
  if (dist < 4) { winX = tx; winY = ty; window.pet.setPos(winX, winY); if (done) done(); return; }
  walking = null; facing = tx >= winX ? 1 : -1;
  glide = { sx: winX, sy: winY, tx, ty, t0: now(), ms: Math.max(450, Math.min(3200, dist / 0.45)), done };
  pose = 'walk'; render();
}
function stepGlide(t, dt) {
  const g = glide; if (!g) return;
  const p = Math.min(1, (t - g.t0) / g.ms), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  winX = g.sx + (g.tx - g.sx) * e; winY = g.sy + (g.ty - g.sy) * e; window.pet.setPos(winX, winY);
  walkAnimT += dt; if (walkAnimT > 150) { walkAnimT = 0; walkFrame++; }
  pose = 'walk'; render();
  if (p >= 1) { glide = null; if (g.done) g.done(); }
}
const EDGE_INSET = 30;       // 站立的小人走到边缘时，身体中心距边缘的距离
function edgeWinX(side) { return side === 'left' ? work.x + EDGE_INSET - WIN_W / 2 : work.x + work.width - EDGE_INSET - WIN_W / 2; }
function dockTo(side, auto) {
  if (!side) { return undock(false); }
  if (glide) return;                                            // 正在走路，忽略重复请求
  const startDock = dock;
  if (!dock) { freeX = winX; freeY = winY; if (side === 'left' || side === 'right') freeX = Math.round(work.x + work.width / 2 - WIN_W / 2); }
  walking = null; dock = null;                                  // 先站起来，走到位再趴下
  let tx, ty, endX, endY;
  if (side === 'bottom') { tx = endX = Math.max(work.x - 40, Math.min(work.x + work.width - WIN_W + 40, winX)); ty = endY = groundY(); }
  else if (side === 'top') { tx = endX = Math.max(work.x - 40, Math.min(work.x + work.width - WIN_W + 40, winX)); ty = work.y - 220; endY = work.y; }
  else {
    tx = edgeWinX(side); endX = side === 'left' ? work.x : work.x + work.width - WIN_W;
    ty = endY = Math.max(work.y, Math.min(groundY(), winY < groundY() - 30 ? winY : groundY() - Math.round(work.height * 0.22)));
  }
  setPose('idle');
  glideTo(tx, ty, () => {
    dock = side; dockAuto = !!auto; dockUntil = auto ? now() + rand(50000, 130000) : 0;
    winX = endX; winY = endY; window.pet.setPos(winX, winY); window.pet.setDock(auto ? null : side);
    setPose('idle'); say(pick(['我趴一会儿～', '这里视野不错。', '偷偷看着你。']), 3000);
  });
}
function undock(silent, then) {
  if (!dock || glide) { if (!dock && then) then(); return; }
  const side = dock; dock = null; dockAuto = false; window.pet.setDock(null);
  // 把窗口挪到“站立小人正好在边缘”的位置（视觉上人不动），再走回去
  if (side === 'left' || side === 'right') winX = edgeWinX(side); else if (side === 'top') winY = work.y - 220;
  window.pet.setPos(winX, winY);
  const tx = freeX != null ? freeX : Math.max(work.x, Math.min(work.x + work.width - WIN_W, winX)), ty = freeY != null ? freeY : groundY();
  setPose('idle');
  glideTo(tx, ty, () => { setPose('idle'); nextDecision = now() + 4000; if (!silent) say('我出来啦。', 2500); if (then) then(); });
}

// ---------- 心情 / 精力 ----------
const clamp = (v) => Math.max(0, Math.min(100, v));
let stDirty = false, lastStatePush = now(), lastLonely = now(), lastTired = now();
function bump(dm, de, extra) {
  const st = cfg.state; st.mood = clamp(st.mood + dm); st.energy = clamp(st.energy + de);
  if (extra) Object.assign(st, extra); stDirty = true;
}
function tickState(dtMin) {
  const st = cfg.state; const asleep = sleeping || pose === 'sleep' || (dock && peekVariant() === 'sleep');
  st.energy = clamp(st.energy + (asleep ? 2.2 : -0.22) * dtMin);
  const idleMin = (now() - lastInteract) / 60000;
  if (idleMin > 20) st.mood = clamp(st.mood - 0.22 * dtMin); else st.mood = clamp(st.mood + (60 - st.mood) * 0.012 * dtMin);
  stDirty = true;
  const t = now();
  if (st.mood < 28 && t - lastLonely > 25 * 60000 && !chatOpen && !sleeping) {
    lastLonely = t; setPose('comfort', 6000); say(pick(['有点寂寞……能陪我说说话吗？', '好久没人摸摸我了。', '你在忙吗？我不吵你，就待在这儿。']), 8000);
  }
  if (st.energy < 15 && t - lastTired > 20 * 60000 && !sleeping && !chatOpen) {
    lastTired = t; say(pick(['我有点困了……', '精力快见底了，想睡一会儿。']), 6000); if (!dock) sleepNow();
  }
  if (sleeping && st.energy > 85 && now() - lastInteract > 60000) wake(false);
}
setInterval(() => {
  if (!cfg) return; tickState(0.5);
  if (stDirty && now() - lastStatePush > 25000) {
    lastStatePush = now(); stDirty = false;
    window.pet.patchState({ mood: cfg.state.mood, energy: cfg.state.energy, ruaTotal: cfg.state.ruaTotal, chatTotal: cfg.state.chatTotal });
  }
}, 30000);

// ---------- 与 Cindy 页面同步动作（手动动作 / rua / 睡觉；远端触发的不再回传）----------
function syncAct(kind, name) { if (cfg && cfg.syncActions !== false) window.pet.sendAct({ kind, name }); }
window.pet.on('act:remote', (a) => {
  if (!a || agentPose || dock || glide) return; lastInteract = now();
  if (a.kind === 'action' && ACTION_INFO[a.name]) doAction(a.name, true);
  else if (a.kind === 'rua') { wake(true); walking = null; setPose('happy', 1800); hearts(3); }
  else if (a.kind === 'sleep') sleepNow(); else if (a.kind === 'wake') wake(true);
});

// ---------- 睡觉 ----------
let agentPose = null;                                  // Cindy / 其他 AI 正在干活时桌宠保持的工作姿势
const restPose = () => agentPose || (sleeping ? 'sleep' : 'idle');
function sleepNow() { sleeping = true; walking = null; setPose('sleep'); }
function wake(silent) { if (!sleeping) return; sleeping = false; setPose(restPose()); if (!silent) say(pick(LINES.wake)); }

// ---------- 跟着任务活动工作（来自 Cindy 插件或其他 AI 的 /agent 推送）----------
const STATE_TEXT = { idle: '空闲', working: '工作中', thinking: '思考中', 'waiting-approval': '等你确认', 'waiting-input': '等你回答', done: '刚做完', error: '出错了' };
let AG = { state: 'idle' }, lastAgSay = 0, workAlt = 0, lastBudgetWarn = '', agStale = 0;
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
function onAgent(a) {
  if (!a || !cfg) return;
  const prev = AG.state; AG = a; clearInterval(workAlt); clearTimeout(agStale);
  const say2 = (text, ms) => { if (now() - lastAgSay > 8000) { lastAgSay = now(); say(text, ms || 5000); } };
  const src = a.source && a.source !== 'cindy' ? a.source + '：' : '';
  if (['working', 'thinking', 'waiting-approval', 'waiting-input', 'error'].includes(a.state)) {
    agStale = setTimeout(() => onAgent({ state: 'idle', source: a.source }), 10 * 60 * 1000);     // 10 分钟没有新消息就当它结束了
    wake(true); walking = null; lastInteract = now();
    const map = { working: 'work_type', thinking: 'work_think', 'waiting-approval': 'work_wait', 'waiting-input': 'work_wait', error: 'work_error' };
    agentPose = imgs[map[a.state]] ? map[a.state] : null;
    if (agentPose && !dock) setPose(agentPose);
    if (a.state === 'working') workAlt = setInterval(() => { if (dock || !agentPose) return; if (agentPose === 'work_type' && imgs.work_read) { agentPose = 'work_read'; setPose(agentPose); } else if (agentPose === 'work_read') { agentPose = 'work_type'; setPose(agentPose); } }, 22000);
    if (prev !== a.state) {
      if (a.state === 'working' && (prev === 'idle' || prev === 'done')) say2(src + pick(['开工啦，我陪着你～', '它开始干活了，我也认真起来。']));
      else if (a.state === 'thinking') say2(src + '在想事情……', 2500);
      else if (a.state === 'waiting-approval') say2(src + '需要你确认一下哦～', 8000);
      else if (a.state === 'waiting-input') say2(src + '它在等你回答呢。', 8000);
      else if (a.state === 'error') say2(src + '出错了……别急，先看看日志。', 7000);
    }
  } else {
    agentPose = null;
    if (a.state === 'done' && prev !== 'done') { bump(2, 0); if (!dock) doAction('cheer', true); say2(src + '这一轮做完啦！' + (a.usage ? '今天累计 ' + fmtN(a.usage.today.total) + ' tokens。' : ''), 6000); }
    else if (prev !== a.state && !dock) setPose(sleeping ? 'sleep' : 'idle');
  }
  const r = a.usage && a.usage.remaining && a.usage.remaining.daily;
  if (r && r.pct <= 10) {
    const k = new Date().toDateString() + ':' + (r.pct <= 0 ? 0 : 10);
    if (k !== lastBudgetWarn) { lastBudgetWarn = k; if (!dock) setPose(imgs.work_sleep ? 'work_sleep' : 'comfort', 6000); say(r.pct <= 0 ? '今天的预算用完啦……累趴了。' : '今天的预算只剩一点点了，省着点用～', 8000); }
  }
}
window.pet.on('agent:update', onAgent);

// ---------- 重力落地 ----------
let fallV = 0;
function groundY() { return work.y + work.height - WIN_H; }
function startFall() { fallV = 0; }

// ---------- 主循环 ----------
let lastT = now(), walkAnimT = 0;
let tilt = 0, tiltTarget = 0, tiltOn = false;
function loop() {
  const t = now(), dt = Math.min(50, t - lastT); lastT = t;
  if (!cfg) return;
  // 被拎起：姿势保持稳定，只随鼠标移动方向轻微倾斜
  if (dragging) {
    tiltTarget *= 0.9; tilt += (tiltTarget - tilt) * 0.25; tiltOn = true;
    sprite.style.transformOrigin = '50% 6%'; sprite.style.transform = `translateX(-50%) rotate(${tilt.toFixed(2)}deg) scaleX(${dragDir < 0 ? -1 : 1})`;
  } else if (tiltOn) { tiltOn = false; tilt = 0; tiltTarget = 0; sprite.style.transform = ''; sprite.style.transformOrigin = ''; }
  // 临时姿势到期
  if (glide) { stepGlide(t, dt); return; }                // 正在走到边缘 / 走回桌面：平滑移动，期间不做其他安排
  if (tempPose && busyUntil && t > busyUntil && !dragging && now() > ruaUntil) { tempPose = null; busyUntil = 0; setPose(restPose()); }
  // 落地
  if (cfg.gravity && !dock && !dragging && !down && winY < groundY() - 0.5) {
    fallV += 0.0016 * dt; winY = Math.min(groundY(), winY + fallV * dt); window.pet.setPos(winX, winY);
    if (winY >= groundY()) { setPose('idle'); bump(-1, 0); if (Math.random() < .5) say(pick(LINES.fall)); }
  }
  // 行走
  if (walking && !dragging) {
    const speed = 0.12 * (cfg.scale || 1) * dt; const dx = walking.targetX - winX;
    facing = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) <= speed) { winX = walking.targetX; walking = null; setPose('idle'); nextDecision = t + rand(5000, 14000); }
    else { winX += Math.sign(dx) * speed; }
    window.pet.setPos(winX, winY);
    walkAnimT += dt; if (walkAnimT > 150) { walkAnimT = 0; walkFrame++; pose = 'walk'; render(); }
  }
  // 自主行为
  if (dock && dockAuto && t > dockUntil && !chatOpen && !down) undock(false);
  const free = !agentPose && !dock && !dragging && !down && !chatOpen && !walking && !tempPose && !sleeping && pose === 'idle';
  if (free && t > nextDecision) {
    const r = Math.random(); const st = cfg.state;
    if (cfg.autoPeek && r < .1) dockTo(pick(['bottom', 'left', 'right', 'top']), true);
    else if (st.mood < 30 && imgs.hug && r < .6) { doAction(pick(['hug', 'sit']), false); nextDecision = t + rand(12000, 22000); }
    else if (st.mood > 85 && imgs.cheer && r < .3) { doAction('cheer', false); nextDecision = t + rand(10000, 18000); }
    else if (cfg.walk && r < .55) startWalk();
    else if (imgs.sit && r < .75) { doAction(pick(['sit', 'stretch', 'hug', 'drink']), false); nextDecision = t + rand(10000, 20000); }
    else { setPose(Math.random() < .3 ? 'talk' : 'idle', 1800); nextDecision = t + rand(6000, 14000); }
  }
  // 久不互动 -> 睡觉
  if (!agentPose && !sleeping && !chatOpen && !walking && !dragging && t - lastInteract > (dock ? 2 : 5) * 60 * 1000) { sleepNow(); say('……zzz', 2500); }
  // 关怀
  if (t - lastCare > (cfg.careIntervalMin || 45) * 60 * 1000 && !chatOpen && !sleeping) { lastCare = t; careNow(); }
}
function startWalk() {
  const pad = (WIN_W - BASE_H * 0.55 * (cfg.scale || 1)) / 2;
  const minX = work.x - pad, maxX = work.x + work.width - WIN_W + pad;
  let tx = winX + rand(-700, 700); tx = Math.max(minX, Math.min(maxX, tx));
  if (Math.abs(tx - winX) < 120) tx = winX < (minX + maxX) / 2 ? Math.min(maxX, winX + 300) : Math.max(minX, winX - 300);
  walking = { targetX: tx }; pose = 'walk'; facing = tx >= winX ? 1 : -1; render();
}
function careNow() {
  const h = new Date().getHours();
  if (dock) { say(pick(['我在边上看着你呢。', '要不要喝点水？']), 6000); return; }
  const line = (h >= 23 || h < 5) ? pick(CARE.night) : pick([...CARE.water, ...CARE.stretch, ...(h >= 11 && h < 14 ? CARE.meal : [])]);
  if (imgs.drink && /水/.test(line)) doAction('drink', true); else setPose('talk', 5000);
  say(line, 8000);
}

// ---------- 事件来源：菜单 / 外部 ----------
window.pet.on('menu:action', async (a, v) => {
  if (a === 'chat') openChat();
  else if (a === 'sleep') { if (sleeping) { wake(); syncAct('wake'); } else { sleepNow(); syncAct('sleep'); } }
  else if (a === 'outfit') { await setOutfit(v, true); }
  else if (a === 'outfit_quiet') { await setOutfit(v, false); }
  else if (a === 'role_quiet') { cfg = await window.pet.getConfig(); history.length = 0; $('#chat-role').textContent = '与「' + activeRole().name + '」聊天'; }
  else if (a === 'action') { lastInteract = now(); doAction(v); syncAct('action', v); }
  else if (a === 'action_quiet') { lastInteract = now(); doAction(v); }
  else if (a === 'scale') { await setScale(v); }
  else if (a === 'dock') { lastInteract = now(); wake(true); dockTo(v, false); }
  else if (a === 'walk') { cfg.walk = v; if (!v) walking = null; }
  else if (a === 'role') { cfg = await window.pet.getConfig(); history.length = 0; logEl.innerHTML = ''; setPose('talk', 3000); say('我现在是「' + activeRole().name + '」啦。'); }
});
window.pet.on('pet:say', ({ text, mood }) => { wake(true); lastInteract = now(); reactMood(mood || 'talk', 6000); say(text, 9000); });
window.pet.on('config:changed', (c) => { const keep = cfg ? cfg.state : null; cfg = c; if (keep) cfg.state = { ...c.state, mood: keep.mood, energy: keep.energy }; render(); });
window.pet.on('state:changed', (st) => { if (!cfg) return; cfg.state = { ...st, mood: cfg.state.mood, energy: cfg.state.energy }; });

// ---------- 启动 ----------
(async function init() {
  cfg = await window.pet.getConfig();
  await setOutfit(cfg.outfit || 'default', false);
  const info = await window.pet.info(); winX = info.bounds.x; winY = info.bounds.y; work = info.work;
  window.pet.getAgent().then((a) => { if (a && a.state && a.state !== 'idle') onAgent(a); }).catch(() => {});
  window.pet.ignore(true); ignoring = true;
  if (cfg.dock) dockTo(cfg.dock, false);
  setTimeout(() => { setPose('talk', 4500); say(timeGreeting(), 6000); }, 600);
  setInterval(loop, 16);
})();
