#!/usr/bin/env node
'use strict';
/**
 * Cindy 桌宠 · MCP 服务器（stdio，零依赖）
 * 让任何支持 MCP 的 AI（Claude Code / Codex / Cursor / Cline / Windsurf …）都能操控桌宠。
 * 环境变量：DESKPET_URL（默认 http://127.0.0.1:47831）、DESKPET_TOKEN（桌宠设置里配置了令牌时填写）
 */
const http = require('http');
const readline = require('readline');

const BASE = new URL(process.env.DESKPET_URL || 'http://127.0.0.1:47831');
const TOKEN = process.env.DESKPET_TOKEN || '';
const VERSION = '0.6.4';

function call(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(TOKEN ? { 'X-Token': TOKEN } : {}) };
    const req = http.request({ host: BASE.hostname, port: BASE.port || 80, path, method, headers, timeout: 5000 }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(buf); } catch {} resolve({ ok: res.statusCode === 200 && j.ok !== false, status: res.statusCode, ...j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '桌宠没有响应' }); });
    req.on('error', () => resolve({ ok: false, error: '没有检测到桌宠（请先启动 Cindy 桌宠，或检查 DESKPET_URL）' }));
    if (data) req.write(data); req.end();
  });
}

const MOODS = ['talk', 'happy', 'shy', 'comfort', 'cheer'];
const ACTIONS = ['sit', 'stretch', 'hug', 'lie', 'cheer', 'drink', 'music', 'video'];
const OUTFITS = ['default', 'hoodie', 'gothic', 'pajama'];
const SIDES = ['top', 'bottom', 'left', 'right', 'none'];

const TOOLS = [
  { name: 'pet_say', description: '让桌宠说一句话（任务完成播报、鼓励、提醒休息等）。口语化、60 字以内。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要说的话' }, mood: { type: 'string', enum: MOODS, description: '情绪/动作，默认 talk' } }, required: ['text'] },
    run: (a) => call('POST', '/say', { text: a.text, mood: a.mood || 'talk' }) },
  { name: 'pet_task_done', description: '任务完成/失败时让桌宠播报并欢呼或安慰。',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: '任务名称' }, failed: { type: 'boolean', description: 'true 表示失败' }, source: { type: 'string', description: '来源，如 Claude Code' } }, required: ['title'] },
    run: (a) => call('POST', '/event', { type: a.failed ? 'task_failed' : 'task_done', title: a.title, source: a.source }) },
  { name: 'pet_action', description: '让桌宠做一个动作：sit 坐下 / stretch 伸懒腰 / hug 抱黑猫 / lie 趴着睡 / cheer 欢呼 / drink 喝热饮 / music 听音乐 / video 看视频。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: ACTIONS } }, required: ['name'] },
    run: (a) => call('POST', '/action', { name: a.name }) },
  { name: 'pet_outfit', description: '切换桌宠服装：default 针织衫 / hoodie 猫耳卫衣 / gothic 哥特洛丽塔 / pajama 星星睡衣。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', enum: OUTFITS } }, required: ['id'] },
    run: (a) => call('POST', '/outfit', { id: a.id }) },
  { name: 'pet_dock', description: '让桌宠趴到屏幕边缘（top/bottom/left/right），none 回到桌面。',
    inputSchema: { type: 'object', properties: { side: { type: 'string', enum: SIDES } }, required: ['side'] },
    run: (a) => call('POST', '/dock', { side: a.side }) },
  { name: 'pet_show', description: '显示或隐藏桌宠。',
    inputSchema: { type: 'object', properties: { visible: { type: 'boolean', description: '默认 true' } } },
    run: (a) => call('POST', a.visible === false ? '/hide' : '/show', {}) },
  { name: 'pet_agent_state', description: '告诉桌宠 AI 现在在做什么，桌宠会换成对应的工作姿势：working 工作 / thinking 思考 / waiting-approval 等用户确认 / waiting-input 等用户回答 / error 出错 / done 刚做完 / idle 空闲。开始长任务时设 working，结束时设 done。',
    inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['working', 'thinking', 'waiting-approval', 'waiting-input', 'done', 'error', 'idle'] }, source: { type: 'string', description: '来源，如 Claude Code' } }, required: ['state'] },
    run: (a) => call('POST', '/agent', { state: a.state, source: a.source || 'MCP' }) },
  { name: 'pet_status', description: '查看桌宠是否在线，以及当前心情、精力、服装。',
    inputSchema: { type: 'object', properties: {} }, run: () => call('GET', '/ping') }
];

function send(msg) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); }

async function handle(req) {
  const { id, method, params } = req;
  const isNote = id === undefined || id === null;
  try {
    if (method === 'initialize') {
      return send({ id, result: { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'cindy-desk-pet', version: VERSION } } });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return send({ id, error: { code: -32602, message: 'Unknown tool: ' + params.name } });
      const r = await tool.run(params.arguments || {});
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok } });
    }
    if (isNote) return;                      // notifications/initialized 等通知无需回复
    send({ id, error: { code: -32601, message: 'Method not found: ' + method } });
  } catch (e) {
    if (!isNote) send({ id, error: { code: -32000, message: String((e && e.message) || e) } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let req; try { req = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  handle(req);
});
process.stderr.write('cindy-desk-pet MCP ready -> ' + BASE.origin + '\n');
