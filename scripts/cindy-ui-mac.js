// 桌宠 ⇄ Cindy 界面桥（macOS，实验功能，未经真机验证）。用 osascript -l JavaScript 运行。
// 用法：dump | press <序号> <预期名称> | focus
// 需要在 系统设置 → 隐私与安全性 → 辅助功能 里允许“Cindy 桌宠”。输出一行 JSON。
ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function cindyApp() {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (let i = 0; i < apps.count; i++) {
    const a = apps.objectAtIndex(i);
    if (ObjC.unwrap(a.localizedName) === 'Cindy') return a;
  }
  return null;
}
function attr(el, name) {
  const ref = Ref();
  const err = $.AXUIElementCopyAttributeValue(el, $(name), ref);
  return err === 0 ? ref[0] : null;
}
function str(v) { if (v === null || v === undefined) return ''; try { const s = ObjC.unwrap(v); return typeof s === 'string' ? s : ''; } catch (e) { return ''; } }
function nameOf(el, role) {
  if (role === 'AXStaticText') return str(attr(el, 'AXValue')) || str(attr(el, 'AXTitle')) || str(attr(el, 'AXDescription'));
  return str(attr(el, 'AXTitle')) || str(attr(el, 'AXDescription')) || str(attr(el, 'AXValue'));
}
function dump() {
  const app = cindyApp(); if (!app) return null;
  const root = $.AXUIElementCreateApplication(app.processIdentifier);
  try { $.AXUIElementSetAttributeValue(root, $('AXManualAccessibility'), $.kCFBooleanTrue); } catch (e) {}   // 让 Electron 暴露界面树
  try { $.AXUIElementSetAttributeValue(root, $('AXEnhancedUserInterface'), $.kCFBooleanTrue); } catch (e) {}
  const nodes = [], refs = [];
  function walk(el, d) {
    if (nodes.length >= 6000 || d > 60) return;
    const kids = attr(el, 'AXChildren'); if (!kids) return;
    for (let i = 0; i < kids.count && nodes.length < 6000; i++) {
      const c = kids.objectAtIndex(i);
      const role = str(attr(c, 'AXRole'));
      const t = role === 'AXButton' ? 'Button' : (role === 'AXStaticText' ? 'Text' : 'Other');
      const n = nameOf(c, role).replace(/[\r\n]+/g, ' ');
      nodes.push({ d, t, n }); refs.push(c);
      walk(c, d + 1);
    }
  }
  const wins = attr(root, 'AXWindows');
  if (wins) for (let i = 0; i < wins.count; i++) walk(wins.objectAtIndex(i), 0);
  return { nodes, refs, app };
}
function run(argv) {
  const cmd = argv[0];
  try {
    if (cmd === 'focus') { const a = cindyApp(); if (a) a.activateWithOptions(3); return JSON.stringify({ ok: !!a }); }
    const r = dump();
    if (!r) return JSON.stringify({ ok: true, cindy: false, nodes: [] });
    if (cmd === 'dump') return JSON.stringify({ ok: true, cindy: true, nodes: r.nodes });
    if (cmd === 'press') {
      const idx = parseInt(argv[1], 10), want = argv[2] || '';
      if (!(idx >= 0 && idx < r.nodes.length) || r.nodes[idx].n !== want) return JSON.stringify({ ok: false, error: 'changed' });
      const err = $.AXUIElementPerformAction(r.refs[idx], $('AXPress'));
      return JSON.stringify({ ok: err === 0, error: err === 0 ? undefined : 'noinvoke' });
    }
    return JSON.stringify({ ok: false, error: 'unknown' });
  } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
}
