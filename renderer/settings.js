const $ = (s) => document.querySelector(s);
let cfg, roles, cur;
function fillRole() {
  const r = roles.find(x => x.id === cur) || roles[0]; cur = r.id;
  $('#roleSel').innerHTML = roles.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${x.name}</option>`).join('');
  $('#roleName').value = r.name; $('#roleModel').value = r.model || ''; $('#rolePrompt').value = r.prompt || '';
}
function stash() {
  const r = roles.find(x => x.id === cur); if (!r) return;
  r.name = $('#roleName').value || r.name; r.model = $('#roleModel').value.trim(); r.prompt = $('#rolePrompt').value;
}
(async () => {
  cfg = await window.pet.getConfig(); roles = JSON.parse(JSON.stringify(cfg.roles)); cur = cfg.activeRole;
  $('#apiType').value = cfg.api.type || 'openai'; $('#baseUrl').value = cfg.api.baseUrl; $('#apiKey').value = cfg.api.apiKey; $('#model').value = cfg.api.model;
  $('#userName').value = cfg.userName; $('#care').value = cfg.careIntervalMin; $('#scale').value = cfg.scale;
  $('#walk').checked = !!cfg.walk; $('#port').value = cfg.notifyPort; $('#token').value = cfg.notifyToken;
  $('#autoUpdate').checked = cfg.autoUpdateCheck !== false;
  $('#backend').value = cfg.chatBackend || 'api'; $('#relayUrl').value = cfg.relayUrl || 'http://127.0.0.1:47832';
  fillRole();
})();
const PRESETS = {
  openai: ['openai', 'https://api.openai.com/v1', 'gpt-4o-mini'], deepseek: ['openai', 'https://api.deepseek.com/v1', 'deepseek-chat'],
  anthropic: ['anthropic', 'https://api.anthropic.com', 'claude-3-5-haiku-latest'], gemini: ['gemini', 'https://generativelanguage.googleapis.com', 'gemini-2.0-flash'],
  ollama: ['openai', 'http://localhost:11434/v1', 'qwen2.5'], lmstudio: ['openai', 'http://localhost:1234/v1', 'local-model']
};
$('#preset').onchange = (e) => { const p = PRESETS[e.target.value]; if (!p) return; $('#apiType').value = p[0]; $('#baseUrl').value = p[1]; $('#model').value = p[2]; };
$('#roleSel').onchange = (e) => { stash(); cur = e.target.value; fillRole(); };
$('#roleName').oninput = () => { stash(); const o = $('#roleSel').selectedOptions[0]; if (o) o.textContent = $('#roleName').value; };
$('#addRole').onclick = () => { stash(); const id = 'r' + Date.now(); roles.push({ id, name: '新角色', model: '', prompt: '你是一个住在用户桌面上的桌宠……' }); cur = id; fillRole(); };
$('#delRole').onclick = () => { if (roles.length <= 1) return; roles = roles.filter(x => x.id !== cur); cur = roles[0].id; fillRole(); };
$('#save').onclick = async () => {
  stash();
  await window.pet.setConfig({
    api: { type: $('#apiType').value, baseUrl: $('#baseUrl').value.trim(), apiKey: $('#apiKey').value.trim(), model: $('#model').value.trim() },
    chatBackend: $('#backend').value, relayUrl: $('#relayUrl').value.trim() || 'http://127.0.0.1:47832',
    roles, activeRole: cur, userName: $('#userName').value.trim() || '你',
    careIntervalMin: Math.max(5, +$('#care').value || 45),
    scale: Math.min(1.4, Math.max(0.5, +$('#scale').value || 1)),
    walk: $('#walk').checked, notifyPort: +$('#port').value || 47831, notifyToken: $('#token').value.trim(),
    autoUpdateCheck: $('#autoUpdate').checked
  });
  $('#msg').textContent = '已保存 ✓'; setTimeout(() => $('#msg').textContent = '', 2000);
};

// 立即检查更新：结果显示在按钮旁，有新版时同步弹桌宠播报 + 系统通知
$('#checkNow').onclick = async () => {
  $('#updMsg').textContent = '正在检查…';
  try {
    const r = await window.pet.updateCheck(true);
    if (r.error) $('#updMsg').textContent = '检查失败：' + r.error;
    else if (r.newer) $('#updMsg').textContent = `发现新版本 v${r.latest}！`;
    else $('#updMsg').textContent = `已是最新（v${r.current}）`;
  } catch (e) { $('#updMsg').textContent = '检查失败'; }
};
