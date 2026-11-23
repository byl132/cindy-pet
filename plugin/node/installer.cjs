'use strict';
// 桌面版桌宠的自动下载与安装（只下载作者自己的 GitHub Release：byl132/cindy-pet）。
// Windows：下载 NSIS 安装包，静默安装到当前用户（不需要管理员权限），然后启动。
// Linux：下载 AppImage 到用户目录，加执行权限后启动。 macOS：下载 zip，解压到 ~/Applications 后打开（未经真机验证）。
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const BASE = 'https://github.com/byl132/cindy-pet/releases/latest/download/';
const FILES = { win32: 'Cindy-Pet-Setup-win-x64.exe', darwin: 'Cindy-Pet-mac-universal.zip', linux: 'Cindy-Pet-linux-x86_64.AppImage' };
const MIN_BYTES = { win32: 50e6, darwin: 50e6, linux: 50e6 };
const DESK_PORT = 47831;

let job = { state: 'idle', pct: 0, error: '', note: '' };      // idle | downloading | installing | starting | done | error
let running = null, curReq = null, cancelled = false;

const setJob = (p) => { job = { ...job, ...p }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: DESK_PORT, path: '/ping', timeout: 2500 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b).ok === true); } catch { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); }); req.on('error', () => resolve(false));
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 20000, windowsHide: true, ...(opts || {}) }, (err, out) => resolve(err ? '' : String(out || ''))));
}

// ---- 找已安装的桌面版可执行文件 ----
async function findExe() {
  if (process.platform === 'win32') {
    const cands = [];
    const la = process.env.LOCALAPPDATA || '';
    if (la) cands.push(path.join(la, 'Programs', 'cindy-desktop-pet'));
    // NSIS 卸载信息里记着真实安装目录（用户可能改过）
    for (const key of ['HKCU', 'HKLM']) {
      const out = await run('reg', ['query', key + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'cindy-desktop-pet', '/d']);
      const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i); if (m) cands.push(m[1].trim());
    }
    for (const dir of cands) {
      try {
        const f = fs.readdirSync(dir).find((n) => /\.exe$/i.test(n) && !/uninstall/i.test(n) && /cindy/i.test(n));
        if (f) return path.join(dir, f);
      } catch {}
    }
    return null;
  }
  if (process.platform === 'darwin') {
    for (const p of [path.join(os.homedir(), 'Applications', 'Cindy桌宠.app'), '/Applications/Cindy桌宠.app']) if (fs.existsSync(p)) return p;
    return null;
  }
  const p = path.join(os.homedir(), '.local', 'share', 'cindy-desk-pet', 'Cindy-Pet.AppImage');
  return fs.existsSync(p) ? p : null;
}

// ---- 下载（跟随重定向，带进度） ----
function download(url, dest, onPct, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('重定向次数过多'));
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('只允许 https 下载'));
    curReq = https.get(u, { headers: { 'User-Agent': 'cindy-desk-pet-plugin' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return download(new URL(res.headers.location, u).toString(), dest, onPct, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('下载失败：服务器返回 ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0; let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; if (total) onPct(Math.floor(got * 100 / total)); });
      res.pipe(out);
      out.on('finish', () => out.close(() => (total && got !== total) ? reject(new Error('下载不完整，请重试')) : resolve(got)));
      out.on('error', reject); res.on('error', reject);
    }).on('timeout', function () { this.destroy(new Error('下载超时，请检查网络')); }).on('error', reject);
  });
}

function launchDetached(file, args) {
  return new Promise((resolve) => {
    const c = spawn(file, args || [], { detached: true, stdio: 'ignore', shell: false });
    c.once('spawn', () => { c.unref(); resolve(true); }); c.once('error', () => resolve(false));
  });
}

async function launch() {
  const exe = await findExe(); if (!exe) return { ok: false, error: '还没有安装桌面版' };
  let ok;
  if (process.platform === 'darwin') ok = await launchDetached('open', [exe]);
  else ok = await launchDetached(exe, []);
  return { ok };
}

async function doInstall() {
  const plat = process.platform, file = FILES[plat];
  if (!file) throw new Error('这个系统暂时没有桌面版安装包');
  cancelled = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-pet-'));
  const tmp = path.join(dir, file);
  setJob({ state: 'downloading', pct: 0, error: '', note: '正在下载桌面版…' });
  const size = await download(BASE + file, tmp, (p) => setJob({ pct: p }));
  if (cancelled) throw new Error('已取消');
  if (size < MIN_BYTES[plat]) throw new Error('下载的文件太小，可能不是安装包，请稍后重试');
  const head = Buffer.alloc(4); const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (plat === 'win32' && head.slice(0, 2).toString() !== 'MZ') throw new Error('下载的文件不是 Windows 安装包');
  if (plat === 'darwin' && head.slice(0, 2).toString() !== 'PK') throw new Error('下载的文件不是 macOS 压缩包');
  setJob({ state: 'installing', pct: 100, note: '正在安装…' });
  if (plat === 'win32') {
    await new Promise((resolve, reject) => {
      const c = spawn(tmp, ['/S'], { stdio: 'ignore', windowsHide: true });
      const t = setTimeout(() => { try { c.kill(); } catch {} reject(new Error('安装超时')); }, 180000);
      c.once('exit', (code) => { clearTimeout(t); code === 0 || code === null ? resolve() : reject(new Error('安装程序退出码 ' + code)); });
      c.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  } else if (plat === 'linux') {
    const dst = path.join(os.homedir(), '.local', 'share', 'cindy-desk-pet'); fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(tmp, path.join(dst, 'Cindy-Pet.AppImage')); fs.chmodSync(path.join(dst, 'Cindy-Pet.AppImage'), 0o755);
  } else {
    const dst = path.join(os.homedir(), 'Applications'); fs.mkdirSync(dst, { recursive: true });
    await new Promise((resolve, reject) => execFile('ditto', ['-x', '-k', tmp, dst], { timeout: 120000 }, (e) => e ? reject(e) : resolve()));
    await run('xattr', ['-dr', 'com.apple.quarantine', path.join(dst, 'Cindy桌宠.app')]);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  setJob({ state: 'starting', note: '正在启动桌面版…' });
  const exe = await findExe();
  if (!exe) throw new Error('安装完成但没找到桌面版程序，请到 GitHub 页面手动安装');
  await launch();
  for (let i = 0; i < 30; i++) { if (await ping()) { setJob({ state: 'done', note: '桌面版已安装并启动' }); return; } await sleep(1000); }
  setJob({ state: 'done', note: '已安装，但还没连上，可以点“启动桌面版”' });
}

function start() {
  if (running) return { ok: true, already: true, job };
  running = doInstall().catch((e) => { if (cancelled) setJob({ state: 'idle', pct: 0, error: '', note: '' }); else setJob({ state: 'error', error: String((e && e.message) || e), note: '' }); }).finally(() => { running = null; });
  return { ok: true, job };
}

function cancel() {
  cancelled = true; try { if (curReq) curReq.destroy(); } catch {}
  if (running) setJob({ state: 'idle', pct: 0, error: '', note: '' });
  return { ok: true };
}

async function state() {
  const online = await ping();
  const exe = online ? 'running' : await findExe();
  return { ok: true, supported: !!FILES[process.platform], platform: process.platform, online, installed: !!exe, job };
}

module.exports = { start, state, launch, cancel };
