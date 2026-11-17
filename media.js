'use strict';
// 感应电脑正在播放音乐还是视频，让桌宠切到“听音乐 / 看视频”姿势。
// 隐私：只读取“有没有在播放、来自哪个应用、是音乐还是视频”，不读取歌名/视频标题，也不上传任何东西。
// Windows：系统媒体会话（SMTC，和锁屏/音量面板里“正在播放”是同一来源）；Linux：playerctl（需自行安装）；macOS：暂不支持。
const { spawn, execFile } = require('child_process');

const MUSIC_APPS = ['spotify', 'cloudmusic', 'netease', 'qqmusic', 'kugou', 'kuwo', 'foobar', 'aimp', 'itunes', 'applemusic', 'zunemusic', 'groove', 'musicbee', 'tidal', 'deezer', 'amazonmusic', 'ymusic', 'youtubemusic', 'lxmusic', 'yesplaymusic', 'rhythmbox', 'clementine', 'strawberry', 'audacious', 'lollypop', 'amberol', 'cmus', 'mocp', 'deadbeef', 'qmmp'];
const VIDEO_APPS = ['vlc', 'potplayer', 'mpv', 'mpc-hc', 'mpc-be', 'kmplayer', 'movies', 'video.ui', 'netflix', 'bilibili', 'iqiyi', 'youku', 'qqlive', 'tencentvideo', 'disney', 'primevideo', 'plex', 'jellyfin', 'kodi', 'totem', 'celluloid', 'smplayer', 'haruna', 'parole', 'obs'];
const BROWSERS = ['chrome', 'msedge', 'edge', 'firefox', 'opera', 'brave', 'vivaldi', 'chromium', '360', 'qqbrowser', 'sogou'];
const has = (s, list) => list.some((k) => s.includes(k));

// 一条播放会话 → 'music' | 'video' | null
function classify(s, extra) {
  const app = String(s.app || '').toLowerCase();
  const musicApps = MUSIC_APPS.concat((extra && extra.music) || []).map((x) => String(x).toLowerCase());
  const videoApps = VIDEO_APPS.concat((extra && extra.video) || []).map((x) => String(x).toLowerCase());
  if (has(app, musicApps)) return 'music';
  if (has(app, videoApps)) return 'video';
  if (s.type === 2 || s.album) return 'music';       // 系统标明是音乐，或带专辑信息
  if (s.type === 1) return 'video';
  if (has(app, BROWSERS)) return 'video';            // 浏览器里没有更多线索时，按视频算
  return s.type === 0 && s.artist ? 'music' : null;
}
// 多个会话同时播放：视频优先
function pickKind(sessions, extra) {
  let kind = null;
  for (const s of sessions || []) { const k = classify(s, extra); if (k === 'video') return 'video'; if (k === 'music') kind = 'music'; }
  return kind;
}

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskG = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $t) { $m = $asTaskG.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); [void]$task.Wait(4000); if ($task.IsCompleted) { $task.Result } }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$mgrT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrT::RequestAsync()) $mgrT
if (-not $mgr) { [Console]::Out.WriteLine('{"error":"no-manager"}'); exit 2 }
while ($true) {
  $out = @()
  try {
    foreach ($s in $mgr.GetSessions()) {
      $pb = $s.GetPlaybackInfo()
      if ([int]$pb.PlaybackStatus -ne 4) { continue }
      $p = Await ($s.TryGetMediaPropertiesAsync()) $propT
      $pt = $pb.PlaybackType
      $type = 0; if ($pt) { $type = [int]$pt.Value }
      $out += [pscustomobject]@{ app = [string]$s.SourceAppUserModelId; type = $type; album = [bool]($p -and $p.AlbumTitle); artist = [bool]($p -and $p.Artist) }
    }
  } catch {}
  $json = ConvertTo-Json -InputObject @($out) -Compress
  if (-not $json) { $json = '[]' }
  [Console]::Out.WriteLine('{"s":' + $json + '}'); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 3000
}
`;

// 启动监视。返回 { stop() }。onKind(kind) 只在变化时回调；kind 为 'music' | 'video' | null
function start({ getCfg, onKind, log }) {
  let child = null, stopped = false, timer = 0, last = undefined, buf = '', misses = 0;
  const lg = log || (() => {});
  const emit = (sessions) => {
    const c = (getCfg && getCfg()) || {};
    const k = pickKind(sessions, { music: c.mediaMusicApps, video: c.mediaVideoApps });
    if (k === last) { misses = 0; return; }
    if (k === null && last) { if (++misses < 2) return; }       // 停止播放要连续两次确认，避免切歌的空档抖动
    misses = 0; last = k; onKind(k);
  };
  if (process.platform === 'win32') {
    const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const run = () => {
      if (stopped) return;
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8'); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          try { const j = JSON.parse(line); if (j.s) emit(j.s); else if (j.error) lg('media', j.error); } catch {}
        }
      });
      child.on('exit', (code) => { child = null; if (!stopped && code !== 2) timer = setTimeout(run, 15000); });    // 异常退出 15 秒后重启；code 2 = 系统不支持，不再重试
      child.on('error', () => { child = null; });
    };
    run();
  } else if (process.platform === 'linux') {
    let missing = false;
    const poll = () => {
      if (stopped || missing) return;
      execFile('playerctl', ['-a', 'metadata', '--format', '{{playerName}}|{{status}}|{{xesam:album}}|{{xesam:artist}}'], { timeout: 4000 }, (err, out) => {
        if (err && err.code === 'ENOENT') { missing = true; lg('media', 'playerctl 未安装，已关闭音乐/视频感应'); return; }
        const sessions = [];
        String(out || '').split('\n').forEach((l) => {
          const p = l.split('|'); if (p.length < 2 || p[1].trim() !== 'Playing') return;
          sessions.push({ app: p[0], type: 0, album: !!(p[2] || '').trim(), artist: !!(p[3] || '').trim() });
        });
        emit(sessions); timer = setTimeout(poll, 3000);
      });
    };
    poll();
  }
  return {
    stop() { stopped = true; clearTimeout(timer); if (child) { try { child.kill(); } catch {} child = null; } if (last) { last = null; onKind(null); } }
  };
}

module.exports = { start, classify, pickKind, PS_SCRIPT };
