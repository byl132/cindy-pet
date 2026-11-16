'use strict';
// 项目文件夹概览（只读、只做统计）：文件数、语言占比、TODO/FIXME、最近改动、Git 分支与最近提交、README 标题、package.json 脚本。
// 不上传、不保存文件内容；README 只取第一行标题，提交信息只取一行摘要。
const fs = require('node:fs');
const path = require('node:path');

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.nuxt', 'vendor', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'coverage', '.cache', 'obj', 'Library', 'Temp', 'Logs', 'release', 'raw', '.gradle', '.dart_tool', 'Pods']);
const LANG = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.lua': 'Lua', '.cs': 'C#', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.c': 'C', '.cpp': 'C++', '.cc': 'C++',
  '.h': 'C/C++', '.hpp': 'C++', '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS', '.vue': 'Vue', '.svelte': 'Svelte', '.sh': 'Shell', '.ps1': 'PowerShell',
  '.gd': 'GDScript', '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP', '.json': 'JSON', '.md': 'Markdown', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML' };
const CODE = new Set(Object.keys(LANG).filter((e) => !['.json', '.md', '.yml', '.yaml', '.toml'].includes(e)));
const TEXTY = new Set(Object.keys(LANG));

function readLine(file, max = 300) { try { return fs.readFileSync(file, 'utf8').slice(0, max); } catch { return ''; } }

function gitInfo(dir) {
  const g = path.join(dir, '.git');
  let st; try { st = fs.statSync(g); } catch { return null; }
  if (!st.isDirectory()) return { branch: null, note: 'worktree/submodule' };
  const head = readLine(path.join(g, 'HEAD'), 200).trim();
  const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  const info = { branch: m ? m[1] : (head ? head.slice(0, 8) + '（分离 HEAD）' : null), lastCommit: null };
  try {
    const log = fs.readFileSync(path.join(g, 'logs', 'HEAD'), 'utf8').trim().split('\n').pop() || '';
    const mm = /^\S+ \S+ .*? (\d{9,11}) [+-]\d{4}\t(.*)$/.exec(log);   // 不读取作者邮箱
    if (mm) info.lastCommit = { at: +mm[1] * 1000, message: mm[2].replace(/^commit( \(.*?\))?:\s*/, '').slice(0, 80) };
  } catch {}
  return info;
}

function scan(dir, opts = {}) {
  const maxFiles = opts.maxFiles || 20000, maxDepth = 8, budgetMs = opts.budgetMs || 5000, t0 = Date.now();
  const st = fs.statSync(dir); if (!st.isDirectory()) throw new Error('不是文件夹');
  const lang = new Map(); let files = 0, dirs = 0, bytes = 0, truncated = false, todo = 0, fixme = 0, textRead = 0;
  const recent = [];
  const stack = [[dir, 0]];
  while (stack.length) {
    if (files >= maxFiles || Date.now() - t0 > budgetMs) { truncated = true; break; }
    const [cur, depth] = stack.pop();
    let ents; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith('.') && e.name !== '.github') { if (e.isDirectory()) continue; }
      const full = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue;                         // 不穿透符号链接
      if (e.isDirectory()) { if (IGNORE.has(e.name) || depth >= maxDepth) continue; dirs++; stack.push([full, depth + 1]); continue; }
      if (!e.isFile()) continue;
      let s; try { s = fs.statSync(full); } catch { continue; }
      files++; bytes += s.size;
      const ext = path.extname(e.name).toLowerCase();
      const L = LANG[ext];
      if (L) { const o = lang.get(L) || { name: L, files: 0, bytes: 0, code: CODE.has(ext) }; o.files++; o.bytes += s.size; lang.set(L, o); }
      if (recent.length < 400 || s.mtimeMs > recent[recent.length - 1].t) { recent.push({ p: path.relative(dir, full).replace(/\\/g, '/'), t: s.mtimeMs }); if (recent.length > 800) { recent.sort((a, b) => b.t - a.t); recent.length = 200; } }
      if (TEXTY.has(ext) && s.size <= 200 * 1024 && textRead < 1500) {
        textRead++;
        try { const txt = fs.readFileSync(full, 'utf8'); todo += (txt.match(/\bTODO\b/g) || []).length; fixme += (txt.match(/\bFIXME\b/g) || []).length; } catch {}
      }
    }
  }
  recent.sort((a, b) => b.t - a.t);
  const langs = [...lang.values()].filter((x) => x.code).sort((a, b) => b.bytes - a.bytes);
  const totalCode = langs.reduce((a, b) => a + b.bytes, 0) || 1;
  let readmeTitle = null;
  for (const n of ['README.md', 'readme.md', 'README.zh-CN.md']) {
    const t = readLine(path.join(dir, n), 400); const m = /^#\s+(.+)$/m.exec(t);
    if (t) { readmeTitle = m ? m[1].trim().slice(0, 60) : null; break; }
  }
  let pkg = null;
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); pkg = { name: j.name, version: j.version, scripts: Object.keys(j.scripts || {}).slice(0, 8) }; } catch {}
  return {
    name: path.basename(dir), files, dirs, bytes, truncated, scannedMs: Date.now() - t0,
    languages: langs.slice(0, 5).map((x) => ({ name: x.name, files: x.files, pct: Math.round(x.bytes / totalCode * 100) })),
    todo, fixme, recent: recent.slice(0, 5).map((x) => ({ path: x.p, at: x.t })),
    git: gitInfo(dir), readmeTitle, pkg
  };
}
module.exports = { scan };
