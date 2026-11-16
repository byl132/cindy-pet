#!/usr/bin/env node
'use strict';
/**
 * Cindy 桌宠 · 命令行（零依赖）。给脚本、钩子、其他 AI 工具用。
 *   node deskpet-cli.cjs say "你好" [happy]
 *   node deskpet-cli.cjs done "整理文档" [来源]      任务完成（欢呼）
 *   node deskpet-cli.cjs fail "构建" [来源]          任务失败（安慰）
 *   node deskpet-cli.cjs agent working|thinking|waiting-approval|waiting-input|done|error|idle [来源]   让桌宠跟着 AI 的工作状态动
 *   node deskpet-cli.cjs action drink | outfit hoodie | dock top | show | hide | status
 *   node deskpet-cli.cjs claude-hook                 作为 Claude Code 钩子（从 stdin 读 JSON）
 *   node deskpet-cli.cjs codex-notify '<json>'       作为 Codex 的 notify 程序
 * 环境变量：DESKPET_URL、DESKPET_TOKEN
 */
const http = require('http');

const BASE = new URL(process.env.DESKPET_URL || 'http://127.0.0.1:47831');
const TOKEN = process.env.DESKPET_TOKEN || '';

function call(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(TOKEN ? { 'X-Token': TOKEN } : {}) };
    const req = http.request({ host: BASE.hostname, port: BASE.port || 80, path, method, headers, timeout: 4000 }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(buf); } catch {} resolve({ ok: res.statusCode === 200 && j.ok !== false, ...j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', () => resolve({ ok: false, error: 'offline' }));
    if (data) req.write(data); req.end();
  });
}
const readStdin = () => new Promise((r) => { let s = ''; if (process.stdin.isTTY) return r(''); process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => r(s)); setTimeout(() => r(s), 1500); });

(async () => {
  const [cmd, a1, a2] = process.argv.slice(2);
  let r;
  switch (cmd) {
    case 'say': r = await call('POST', '/say', { text: a1 === '-' ? (await readStdin()).trim() : a1, mood: a2 || 'talk' }); break;
    case 'done': r = await call('POST', '/event', { type: 'task_done', title: a1 || '任务', source: a2 }); break;
    case 'fail': r = await call('POST', '/event', { type: 'task_failed', title: a1 || '任务', source: a2 }); break;
    case 'agent': r = await call('POST', '/agent', { state: a1, source: a2 || 'cli' }); break;
    case 'action': r = await call('POST', '/action', { name: a1 }); break;
    case 'outfit': r = await call('POST', '/outfit', { id: a1 }); break;
    case 'dock': r = await call('POST', '/dock', { side: a1 || 'none' }); break;
    case 'show': r = await call('POST', '/show', {}); break;
    case 'hide': r = await call('POST', '/hide', {}); break;
    case 'status': r = await call('GET', '/ping'); break;
    case 'claude-hook': {       // Claude Code 钩子：Stop -> 完成；Notification -> 转述提醒
      let j = {}; try { j = JSON.parse(await readStdin() || '{}'); } catch {}
      const ev = j.hook_event_name || '';
      if (ev === 'UserPromptSubmit') r = await call('POST', '/agent', { state: 'working', source: 'Claude Code' });
      else if (ev === 'PreToolUse') r = await call('POST', '/agent', { state: 'working', source: 'Claude Code' });
      else if (ev === 'Stop' || ev === 'SubagentStop') { await call('POST', '/agent', { state: 'done', source: 'Claude Code' }); r = await call('POST', '/event', { type: 'task_done', title: '这一轮', source: 'Claude Code' }); }
      else if (ev === 'Notification') { await call('POST', '/agent', { state: 'waiting-input', source: 'Claude Code' }); r = await call('POST', '/say', { text: 'Claude Code：' + String(j.message || '需要你看一下').slice(0, 80), mood: 'talk' }); }
      else r = { ok: true, ignored: ev };
      break;
    }
    case 'codex-notify': {      // Codex: notify = ["node", ".../deskpet-cli.cjs", "codex-notify"]，JSON 作为最后一个参数
      let j = {}; try { j = JSON.parse(process.argv[process.argv.length - 1]); } catch {}
      if (j.type === 'agent-turn-complete') { await call('POST', '/agent', { state: 'done', source: 'Codex' }); r = await call('POST', '/event', { type: 'task_done', title: '这一轮', source: 'Codex' }); }
      else r = { ok: true, ignored: j.type };
      break;
    }
    default:
      console.error('用法: say <文字> [mood] | done <任务> | fail <任务> | action <名> | outfit <id> | dock <top|bottom|left|right|none> | show | hide | status | claude-hook | codex-notify');
      process.exit(2);
  }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
})();
