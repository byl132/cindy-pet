'use strict';
// 从“界面节点列表”里认出 Cindy 的提问卡 / 命令确认卡（macOS、Linux 用；Windows 的同款逻辑在 scripts/cindy-ui.ps1 里）。
// nodes：先序遍历得到的 [{ d: 深度, t: 'Button' | 'Text' | 'Other', n: 名称 }]，只要保留有名字的节点和所有按钮即可。
function parseCards(nodes) {
  const items = [];
  const len = nodes.length;
  // ① 提问卡：以“收起问题卡片”按钮为锚
  for (let i = 0; i < len; i++) {
    const b = nodes[i];
    if (b.t !== 'Button' || b.n !== '收起问题卡片') continue;
    const header = i > 0 && nodes[i - 1].t === 'Text' ? nodes[i - 1].n : '';
    let q = ''; const opts = []; let j = i + 1;
    while (j < len && nodes[j].d >= b.d) {
      const x = nodes[j];
      if (x.d === b.d && x.t === 'Text' && !q) q = x.n;
      else if (x.d === b.d && x.t === 'Button') {
        if (/^(输入其他回答|开始语音输入|跳过)/.test(x.n)) { if (x.n.startsWith('跳过')) break; j++; continue; }
        const texts = []; let k = j + 1;
        while (k < len && nodes[k].d > b.d) { if (nodes[k].t === 'Text') texts.push(nodes[k].n); k++; }
        opts.push({ label: texts.length ? texts[0] : x.n, description: texts.length >= 3 ? texts[1] : '', idx: j });
        j = k; continue;
      }
      j++;
    }
    if (q && opts.length) items.push({ kind: 'question', header, question: q, options: opts, sig: 'q|' + q + '|' + opts.map((o) => o.label).join(',') });
  }
  // ② 命令 / 权限确认卡：以“拒绝”+“允许…”按钮为锚，向上找包含标题和内容的容器
  const parentOf = (i) => { for (let p = i - 1; p >= 0; p--) if (nodes[p].d < nodes[i].d) return p; return -1; };
  for (let i = 0; i < len; i++) {
    const d = nodes[i];
    if (d.t !== 'Button' || !/^拒绝/.test(d.n)) continue;
    let allow = -1;
    for (let k = i + 1; k < Math.min(len, i + 14); k++) if (nodes[k].t === 'Button' && /^允许/.test(nodes[k].n)) { allow = k; break; }
    if (allow < 0) continue;
    let p = parentOf(i), texts = [];
    for (let up = 0; up < 8 && p >= 0; up++) {
      texts = []; let prev = '';
      for (let k = p + 1; k < len && nodes[k].d > nodes[p].d; k++) {
        const s = nodes[k];
        if (s.t === 'Text' && s.n && s.n !== prev && !/^(拒绝|允许一次|允许|Esc|Enter)$/.test(s.n)) { texts.push(s.n); prev = s.n; }
      }
      if (texts.length >= 3) break;
      p = parentOf(p);
    }
    if (texts.length < 2) {                 // 兜底：找不到包含文字的父容器时，取按钮前面一段深度相近的文字
      texts = []; let prev = '';
      for (let k = Math.max(0, i - 40); k < i; k++) {
        const s = nodes[k];
        if (s.t === 'Text' && s.n && s.n !== prev && s.d >= d.d - 2 && !/^(拒绝|允许一次|允许|Esc|Enter)$/.test(s.n)) { texts.push(s.n); prev = s.n; }
      }
    }
    if (texts.length >= 2) {
      let allowIdx = allow;
      for (let k = i + 1; k < Math.min(len, i + 14); k++) if (nodes[k].t === 'Button' && /^允许一次/.test(nodes[k].n)) { allowIdx = k; break; }
      items.push({ kind: 'permission', title: texts[0], body: texts.slice(1).join('\n'), allowLabel: nodes[allowIdx].n, allowIdx, denyIdx: i, sig: 'p|' + texts.join('|') });
    }
  }
  return items;
}
module.exports = { parseCards };
