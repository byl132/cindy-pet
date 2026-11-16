#!/usr/bin/env bash
# macOS 冒烟测试：启动打包好的应用，检查本机接口、跟随 Cindy、趴边指令、命令行/MCP 工具，并截屏。
# 由 .github/workflows/smoke-mac.yml 调用；结果写入 smoke-out/ 与 GitHub 任务摘要。
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=smoke-out; mkdir -p "$OUT"; R="$OUT/result.txt"; : > "$R"
log() { echo "$*" | tee -a "$R"; }
ok()  { log "PASS  $*"; }
bad() { log "FAIL  $*"; FAILED=1; }
FAILED=0
APP=$(ls -d dist/mac-*/*.app 2>/dev/null | head -1)
[[ -n "$APP" ]] || { log "FAIL  没有找到构建出的 .app"; exit 1; }
BIN=$(ls "$APP/Contents/MacOS"/* | head -1)
log "系统: $(sw_vers -productVersion) / $(uname -m)"; log "应用: $APP"; log "可执行: $BIN"
J() { curl -s --max-time 4 "$@"; }

# 1) 假的 “Cindy” 进程：验证 pgrep -x Cindy，并用来测试“跟随 Cindy”
cp /bin/sleep /tmp/Cindy; /tmp/Cindy 3000 & DUMMY=$!; sleep 1
if pgrep -x Cindy >/dev/null; then ok "pgrep -x Cindy 能检测到名为 Cindy 的进程"; else bad "pgrep -x Cindy 检测不到"; fi

# 2) 预先写好配置：开启跟随 Cindy
CFG="$HOME/Library/Application Support/cindy-desktop-pet"; mkdir -p "$CFG"
echo '{"followCindy":true,"followProcess":"Cindy"}' > "$CFG/config.json"

# 3) 启动应用
"$BIN" > "$OUT/app.log" 2>&1 & APPPID=$!
for i in $(seq 1 40); do sleep 1; P=$(J http://127.0.0.1:47831/ping) && [[ -n "$P" ]] && break; done
if [[ -n "${P:-}" ]]; then ok "应用已启动，接口在线（${i}s）：$P"; else bad "应用没有在 40 秒内启动或接口无响应"; tail -30 "$OUT/app.log" | tee -a "$R"; fi
kill -0 $APPPID 2>/dev/null && ok "进程存活" || bad "进程已退出"

# 4) 接口
J http://127.0.0.1:47831/api | grep -q '"endpoints"' && ok "GET /api 返回接口说明" || bad "GET /api"
R1=$(J -X POST http://127.0.0.1:47831/say -d '{"text":"Mac 冒烟测试：你好","mood":"happy"}'); [[ "$R1" == *'"ok":true'* ]] && ok "POST /say" || bad "POST /say：$R1"
R2=$(J -X POST http://127.0.0.1:47831/agent -d '{"state":"working","source":"smoke"}'); [[ "$R2" == *'"ok":true'* ]] && ok "POST /agent working" || bad "POST /agent：$R2"
sleep 1; J http://127.0.0.1:47831/agent | grep -q '"state":"working"' && ok "GET /agent 回读 working" || bad "GET /agent 回读"
R3=$(J -X POST http://127.0.0.1:47831/dock -d '{"side":"top"}'); [[ "$R3" == *'"ok":true'* ]] && ok "POST /dock top" || bad "POST /dock：$R3"

# 5) 窗口 / 渲染进程是否出错
sleep 6
grep -E "renderer|gone|Error" "$OUT/app.log" | head -20 > "$OUT/errors.txt"
if [[ -s "$OUT/errors.txt" ]]; then bad "应用日志里有错误/警告："; cat "$OUT/errors.txt" | tee -a "$R"; else ok "应用日志没有渲染错误"; fi
osascript -e 'tell application "System Events" to get name of every process whose background only is false' > "$OUT/processes.txt" 2>&1 || true

# 6) 截屏（桌宠应当在屏幕右下角；上面已让它趴到上边缘）
screencapture -x "$OUT/screen.png" 2>>"$R" && ok "已截屏 screen.png" || log "WARN  截屏失败（运行器可能没有屏幕录制权限）"

# 7) 跟随 Cindy：Cindy 进程存在时可见；进程消失约 16 秒后隐藏；再出现后恢复
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（Cindy 在运行）: $V"
[[ "$V" == '"visible":true' ]] && ok "Cindy 在运行时桌宠可见" || bad "Cindy 在运行时桌宠不可见"
kill $DUMMY 2>/dev/null; sleep 24
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（Cindy 已退出 24s）: $V"
[[ "$V" == '"visible":false' ]] && ok "Cindy 退出后桌宠自动隐藏" || bad "Cindy 退出后桌宠没有隐藏"
/tmp/Cindy 3000 & DUMMY=$!; sleep 12
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（Cindy 重新出现）: $V"
[[ "$V" == '"visible":true' ]] && ok "Cindy 重新出现后桌宠恢复显示" || bad "Cindy 重新出现后桌宠没有恢复"

# 8) 命令行与 MCP
node integrations/deskpet-cli.cjs status > "$OUT/cli.txt" 2>&1 && ok "deskpet-cli status：$(head -c 120 "$OUT/cli.txt")" || bad "deskpet-cli status"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node integrations/deskpet-mcp.cjs 2>/dev/null > "$OUT/mcp.txt"
grep -q "pet_say" "$OUT/mcp.txt" && ok "MCP tools/list 正常" || bad "MCP tools/list"

kill $APPPID $DUMMY 2>/dev/null
log ""; [[ $FAILED -eq 0 ]] && log "== 全部检查通过 ==" || log "== 有失败项 =="
{ echo "## Mac 冒烟测试"; echo '```'; cat "$R"; echo '```'; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
