'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let cfg = null, selMood = 0;
const EMOJI = { 5: '😄', 4: '🙂', 3: '😐', 2: '😟', 1: '😭' };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dayKey = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ---------- 标签页 ----------
function showTab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === t));
  if (t === 'mood') drawMood(); if (t === 'remind') renderReminders();
}
$$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
window.pet.on('panel:tab', showTab);

// ---------- 状态 ----------
const moodWord = (v) => v >= 85 ? '兴高采烈' : v >= 65 ? '心情不错' : v >= 45 ? '平平静静' : v >= 28 ? '有点低落' : '想被陪伴';
function level(aff) { const lv = Math.floor(Math.sqrt(aff / 5)) + 1; const cur = (lv - 1) ** 2 * 5, next = lv ** 2 * 5; return { lv, pct: Math.min(100, (aff - cur) / (next - cur) * 100), next }; }
function streak(log) {
  const days = new Set(log.map(l => l.date)); let n = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderStatus() {
  if (!cfg) return; const st = cfg.state; const a = cfg.affection || 0; const L = level(a);
  $('#moodV').textContent = Math.round(st.mood) + ' · ' + moodWord(st.mood); $('#moodBar').style.width = st.mood + '%';
  $('#energyV').textContent = Math.round(st.energy); $('#energyBar').style.width = st.energy + '%';
  $('#affV').textContent = a + ' / ' + L.next; $('#affBar').style.width = L.pct + '%'; $('#lv').textContent = 'Lv.' + L.lv;
  const days = Math.max(1, Math.round((Date.now() - new Date(st.firstDay).getTime()) / 86400000) + 1);
  $('#days').textContent = `已经陪伴你 ${days} 天`; $('#moodText').textContent = `现在：${moodWord(st.mood)}${st.energy < 25 ? '，有点困' : ''}`;
  $('#sRua').textContent = st.ruaTotal || 0; $('#sChat').textContent = st.chatTotal || 0; $('#sFocus').textContent = st.focusDone || 0;
  $('#sStreak').textContent = streak(st.moodLog || []);
}
$$('[data-do]').forEach(b => b.onclick = () => {
  const k = b.dataset.do;
  if (k === 'drink' || k === 'cheer') window.pet.emit('action', k);
  else if (k === 'praise') window.pet.emit('say', { text: pick(['你今天已经很棒了。', '偷偷告诉你，我为你骄傲。', '能把事情一件件做完的你，很厉害。']), mood: 'happy' });
  else if (k === 'peek') window.pet.emit('dock', pick(['left', 'right', 'bottom', 'top']));
  window.pet.addAffection(k === 'praise' ? 1 : 0);
});

// ---------- 心情打卡 ----------
$$('#emojis button').forEach(b => b.onclick = () => { selMood = +b.dataset.v; $$('#emojis button').forEach(x => x.classList.toggle('on', x === b)); });
$('#saveMood').onclick = async () => {
  if (!selMood) { $('#moodMsg').textContent = '先选一个表情～'; return; }
  const log = [...(cfg.state.moodLog || [])]; const t = new Date();
  log.push({ date: dayKey(t), time: t.toTimeString().slice(0, 5), v: selMood, note: $('#note').value.trim() });
  cfg.state = await window.pet.patchState({ moodLog: log });
  const reply = { 5: ['太好了！看到你开心我也开心。', '今天是好日子，对吧？'], 4: ['不错呀，继续保持。'], 3: ['平平淡淡也挺好的。我陪着你。'],
    2: ['辛苦了。过来，我陪你一会儿。', '低落的时候，不用硬撑。'], 1: ['抱一下。想说就说，不想说我就安静陪着你。', '我在这里，哪儿也不去。'] }[selMood];
  window.pet.emit('say', { text: pick(reply), mood: selMood >= 4 ? 'happy' : selMood === 3 ? 'talk' : 'comfort' });
  if (selMood <= 2) window.pet.emit('action', 'hug');
  window.pet.addAffection(1);
  $('#moodMsg').textContent = '已记录 ✓'; $('#note').value = ''; selMood = 0; $$('#emojis button').forEach(x => x.classList.remove('on'));
  drawMood(); renderStatus(); setTimeout(() => $('#moodMsg').textContent = '', 2000);
};
function drawMood() {
  if (!cfg) return; const log = cfg.state.moodLog || [];
  const c = $('#chart'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dayKey(d)); }
  const avg = days.map(k => { const xs = log.filter(l => l.date === k).map(l => l.v); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; });
  const L = 28, R = 10, T = 12, B = 22, W = c.width - L - R, H = c.height - T - B;
  g.strokeStyle = '#33325a'; g.fillStyle = '#9a9ac0'; g.font = '11px sans-serif';
  for (let v = 1; v <= 5; v++) { const y = T + H - (v - 1) / 4 * H; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke(); g.fillText(EMOJI[v], 4, y + 4); }
  const px = (i) => L + i / 13 * W, py = (v) => T + H - (v - 1) / 4 * H;
  g.strokeStyle = '#5b6cff'; g.lineWidth = 2; g.beginPath(); let started = false;
  avg.forEach((v, i) => { if (v == null) { started = false; return; } if (!started) { g.moveTo(px(i), py(v)); started = true; } else g.lineTo(px(i), py(v)); });
  g.stroke();
  avg.forEach((v, i) => { if (v == null) return; g.fillStyle = '#ff9ecb'; g.beginPath(); g.arc(px(i), py(v), 4, 0, 7); g.fill(); });
  g.fillStyle = '#9a9ac0'; [0, 6, 13].forEach(i => g.fillText(days[i].slice(5), px(i) - 12, c.height - 6));
  $('#moodList').innerHTML = '';
  log.slice(-6).reverse().forEach(l => { const d = document.createElement('div'); d.innerHTML = `<span>${EMOJI[l.v]} ${l.date.slice(5)} ${l.time}</span><span></span>`; d.lastChild.textContent = l.note || ''; $('#moodList').appendChild(d); });
}

// ---------- 专注 ----------
let focusMin = 25, breakMin = 5, phase = 'idle', endAt = 0, leftMs = 25 * 60000, timer = 0;
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function setPhase(p) {
  phase = p; $('#phase').textContent = { idle: '准备开始', focus: '专注中…', break: '休息一下', paused: '已暂停' }[p];
}
$$('#presets button').forEach(b => b.onclick = () => {
  if (phase === 'focus' || phase === 'break') return;
  $$('#presets button').forEach(x => x.classList.toggle('on', x === b)); focusMin = +b.dataset.m; breakMin = +b.dataset.b;
  leftMs = focusMin * 60000; setPhase('idle'); $('#clock').textContent = fmt(leftMs);
});
function tick() {
  leftMs = endAt - Date.now(); $('#clock').textContent = fmt(leftMs);
  if (leftMs > 0) return;
  clearInterval(timer);
  if (phase === 'focus') {
    cfg.state = { ...cfg.state, focusDone: (cfg.state.focusDone || 0) + 1 }; window.pet.patchState({ focusDone: cfg.state.focusDone });
    window.pet.emit('say', { text: `专注 ${focusMin} 分钟完成！休息 ${breakMin} 分钟吧，喝口水。`, mood: 'happy' }); window.pet.emit('action', 'cheer'); window.pet.addAffection(1);
    setPhase('break'); leftMs = breakMin * 60000; endAt = Date.now() + leftMs; timer = setInterval(tick, 500);
  } else {
    window.pet.emit('say', { text: '休息结束，要不要再来一轮？', mood: 'talk' });
    setPhase('idle'); leftMs = focusMin * 60000; $('#clock').textContent = fmt(leftMs);
  }
}
$('#fStart').onclick = () => {
  if (phase === 'focus' || phase === 'break') return;
  if (phase === 'idle') window.pet.emit('say', { text: `开始专注 ${focusMin} 分钟，我在旁边陪你。`, mood: 'talk' });
  setPhase('focus'); endAt = Date.now() + leftMs; clearInterval(timer); timer = setInterval(tick, 500);
};
$('#fPause').onclick = () => { if (phase !== 'focus') return; clearInterval(timer); leftMs = endAt - Date.now(); setPhase('paused'); };
$('#fReset').onclick = () => { clearInterval(timer); leftMs = focusMin * 60000; setPhase('idle'); $('#clock').textContent = fmt(leftMs); };

// ---------- 提醒 ----------
$('#rMode').onchange = () => { const at = $('#rMode').value === 'at'; $('#rAt').style.display = at ? '' : 'none'; $('#rIn').style.display = at ? 'none' : ''; };
$('#rAdd').onclick = async () => {
  const text = $('#rText').value.trim(); if (!text) return;
  let at;
  if ($('#rMode').value === 'in') at = Date.now() + Math.max(1, +$('#rIn').value || 1) * 60000;
  else { const [h, m] = $('#rAt').value.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); at = d.getTime(); }
  await window.pet.reminders.add({ text, at, repeat: $('#rDaily').checked ? 'daily' : 'none' }); $('#rText').value = ''; renderReminders();
};
async function renderReminders() {
  const list = await window.pet.reminders.list(); const box = $('#rList'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="sub">还没有提醒</div>'; return; }
  list.sort((a, b) => a.at - b.at).forEach(r => {
    const d = document.createElement('div'); const t = new Date(r.at);
    const span = document.createElement('span'); span.textContent = `${t.toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}${r.repeat === 'daily' ? '（每天）' : ''}　${r.text}`;
    const del = document.createElement('button'); del.textContent = '删除'; del.onclick = async () => { await window.pet.reminders.remove(r.id); renderReminders(); };
    d.append(span, del); box.appendChild(d);
  });
}
window.pet.on('reminders:changed', renderReminders);

// ---------- 工作台 ----------
const STATE_TEXT = { idle: '空闲', working: '工作中', thinking: '思考中', 'waiting-approval': '等你确认', 'waiting-input': '等你回答', done: '刚做完', error: '出错了' };
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
function renderWork(a) {
  a = a || { state: 'idle' };
  $('#wState').textContent = (STATE_TEXT[a.state] || a.state) + (a.source && a.source !== 'cindy' ? '（' + a.source + '）' : '');
  $('#wDetail').textContent = [a.model, a.project, a.since ? '自 ' + new Date(a.since).toLocaleTimeString('zh-CN', { hour12: false }) : ''].filter(Boolean).join(' · ');
  const u = a.usage;
  $('#wToday').textContent = u ? fmtN(u.today.total) : '—'; $('#wMonth').textContent = u ? fmtN(u.month.total) : '—';
  const bar = (v, b, r) => { $(v).textContent = r ? `${r.pct}%（${fmtN(r.left)} / ${fmtN(r.limit)}）` : '未设置'; $(b).style.width = (r ? r.pct : 0) + '%'; };
  bar('#wDV', '#wDB', u && u.remaining.daily); bar('#wMV', '#wMB', u && u.remaining.monthly);
  $('#wNote').textContent = u ? '剩余按你设的预算估算（Cindy 不向插件开放真实剩余额度）。' : '尚未收到 Cindy 插件的用量数据：需要 Cindy 里装有“桌宠联动”插件。';
  const p = a.project, box = $('#wProject');
  if (p && p.scan) { const s = p.scan; box.textContent = `${p.name}：${s.files} 个文件，` + s.languages.slice(0, 3).map((l) => l.name + ' ' + l.pct + '%').join('、') + `；TODO ${s.todo}、FIXME ${s.fixme}` + (s.git && s.git.branch ? `；分支 ${s.git.branch}` : ''); }
}
window.pet.on('agent:update', renderWork);

// ---------- 启动 ----------
async function refresh() { cfg = await window.pet.getConfig(); renderStatus(); }
window.pet.on('state:changed', refresh);
(async function init() {
  await refresh();
  try { $('#avatar').src = URL.createObjectURL(new Blob([window.pet.asset((cfg.outfit || 'default') + '/idle.png')], { type: 'image/png' })); } catch {}
  $('#clock').textContent = fmt(leftMs);
  showTab(new URLSearchParams(location.search).get('tab') || 'status');
  setInterval(refresh, 10000);
  window.pet.getAgent().then(renderWork).catch(() => {});
})();
