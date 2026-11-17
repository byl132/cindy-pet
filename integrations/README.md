# 让其他 AI 工具接入 Cindy 桌宠

桌宠在本机 `127.0.0.1:47831` 提供一个小接口。下面的方式都基于它，**无需联网、无需 Key**。
安装版桌宠的这个文件夹：Windows 在 `安装目录\resources\integrations`（默认 `%LOCALAPPDATA%\Programs\Cindy桌宠\resources\integrations`）；macOS 在 `/Applications/Cindy桌宠.app/Contents/Resources/integrations`。也可以直接复制到任意位置使用。需要 Node.js 18+。

> 先启动桌宠。如果在桌宠设置里配置了「令牌 Token」，请把环境变量 `DESKPET_TOKEN` 设成同一个值。

## 1. MCP（推荐：Claude Code / Codex / Cursor / Cline / Windsurf / Claude Desktop）

服务入口：`node <路径>\deskpet-mcp.cjs`（stdio，零依赖）。提供 8 个工具：
`pet_say` `pet_task_done` `pet_agent_state` `pet_action` `pet_outfit` `pet_dock` `pet_show` `pet_status`。

| 工具 | 配置方式 |
|---|---|
| Claude Code | `claude mcp add cindy-pet -- node "<路径>\deskpet-mcp.cjs"` |
| Codex | 把 `codex-config.toml` 里的 `[mcp_servers.cindy-pet]` 段加入 `~/.codex/config.toml` |
| Cursor / Cline / Windsurf / Claude Desktop | 把 `mcp.json` 的内容合并进各自的 MCP 配置 |

配置好后，对 AI 说“做完后让桌宠欢呼一下”“让桌宠趴到上边缘”即可。

## 2. 自动播报与“跟着干活”（不需要 AI 主动调用）

**Claude Code 钩子**：把 `claude-code.settings.json` 的 `hooks` 合并进 `~/.claude/settings.json`。
你发出指令后桌宠坐下来打字干活，需要你确认时举手，结束时欢呼并说“Claude Code：这一轮做完啦”。

**Codex 通知**：在 `~/.codex/config.toml` 顶层加入 `codex-config.toml` 里的 `notify = [...]`。

**任意脚本 / CI / 其他 AI 插件**：
```
node deskpet-cli.cjs say "你好" happy
node deskpet-cli.cjs done "整理文档" 我的脚本
node deskpet-cli.cjs fail "构建" CI
node deskpet-cli.cjs action drink      # sit stretch hug lie cheer drink music video
node deskpet-cli.cjs outfit hoodie     # default hoodie gothic pajama
node deskpet-cli.cjs dock top          # top bottom left right none
node deskpet-cli.cjs agent working 我的脚本    # 让桌宠进入工作姿势；done / error / waiting-input / idle 同理
node deskpet-cli.cjs status
```

## 3. 直接调用 HTTP

```
GET  http://127.0.0.1:47831/api              接口说明
GET  http://127.0.0.1:47831/ping             在线、心情、精力、服装
POST /say     {"text":"你好","mood":"happy"}          mood: talk happy shy comfort cheer
POST /event   {"type":"task_done","title":"构建","source":"CI"}   type: task_done | task_failed
POST /action  {"name":"drink"}      // name: sit|stretch|hug|lie|cheer|drink|music|video
POST /media   {"kind":"music"}      // 告知桌宠正在听歌/看视频：music | video | none（桌面版也会自动感应，见根目录 MEDIA.md）
POST /outfit  {"id":"hoodie"}
POST /dock    {"side":"top"}
POST /agent    {"state":"working","source":"我的脚本"}   state: idle working thinking waiting-approval waiting-input done error
GET  /agent    当前工作状态与用量快照
POST /show  /hide
```
有 Token 时加请求头 `X-Token: <令牌>`。

## 4. 在 Cindy 里使用

安装“桌宠联动”插件（`.cindy` 文件），Cindy 的 Agent 就能调用 `pet_say` / `pet_action` / `pet_outfit` / `pet_dock` / `pet_show` / `pet_status`，
并让桌面版使用 Cindy 的模型聊天、与 Cindy 页面双向同步服装和角色。

## 5. 桌宠自己用哪家模型聊天

桌宠设置 → AI 模型接口：预设一键填好 OpenAI、DeepSeek、Anthropic Claude、Google Gemini、Ollama、LM Studio；
也可手动填写任何 OpenAI 兼容地址（通义、Kimi、OneAPI 等）。本机地址（localhost）可不填 Key。
