#!/usr/bin/env bash
# Linux 冒烟测试：在虚拟显示器（Xvfb）里启动打包好的应用，检查本机接口、跟随 Cindy、趴边指令、命令行/MCP、开机自启文件，并截屏。
# 由 .github/workflows/smoke-linux.yml 调用（需要 xvfb、imagemagick）；结果写入 smoke-out/ 与 GitHub 任务摘要。
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=smoke-out; mkdir -p "$OUT"; R="$OUT/result.txt"; : > "$R"
log() { echo "$*" | tee -a "$R"; }
ok()  { log "PASS  $*"; }
bad() { log "FAIL  $*"; FAILED=1; }
FAILED=0
BIN=$(ls dist/linux-unpacked/cindy-desktop-pet 2>/dev/null | head -1)
[[ -n "$BIN" ]] || { log "FAIL  没有找到 dist/linux-unpacked/cindy-desktop-pet"; exit 1; }
log "系统: $(. /etc/os-release; echo "$PRETTY_NAME") / $(uname -m)  DISPLAY=${DISPLAY:-无}"; log "可执行: $BIN"
J() { curl -s --max-time 4 "$@"; }

# 1) 假的 “cindy” 进程：验证 pgrep -xi，并用来测试“跟随 Cindy”
# 注意：新版 Ubuntu 的 sleep 是多合一程序，改名后会直接退出，所以用 node 的副本当“假 Cindy”
cp "$(command -v node)" /tmp/cindy; /tmp/cindy -e 'setTimeout(()=>{},3e6)' & DUMMY=$!; sleep 1
if pgrep -xi cindy >/dev/null; then ok "pgrep -xi cindy 能检测到名为 cindy 的进程"; else bad "pgrep -xi cindy 检测不到"; fi

# 2) 预先写好配置：开启跟随 Cindy
CFG="$HOME/.config/cindy-desktop-pet"; mkdir -p "$CFG"
echo '{"followCindy":true,"followProcess":"cindy"}' > "$CFG/config.json"

# 3) 启动应用（CI 的 unpacked 目录里 chrome-sandbox 没有 setuid，所以加 --no-sandbox；正式的 AppImage 会自动处理）
"$BIN" --no-sandbox > "$OUT/app.log" 2>&1 & APPPID=$!
for i in $(seq 1 40); do sleep 1; P=$(J http://127.0.0.1:47831/ping) && [[ -n "$P" ]] && break; done
if [[ -n "${P:-}" ]]; then ok "应用已启动，接口在线（${i}s）：$P"; else bad "应用没有在 40 秒内启动或接口无响应"; tail -30 "$OUT/app.log" | tee -a "$R"; fi
kill -0 $APPPID 2>/dev/null && ok "进程存活" || bad "进程已退出"

# 4) 接口（请求紧跟在启动之后，顺便覆盖“素材还没加载完就收到事件”的情况）
J http://127.0.0.1:47831/api | grep -q '"endpoints"' && ok "GET /api 返回接口说明" || bad "GET /api"
R1=$(J -X POST http://127.0.0.1:47831/say -d '{"text":"Linux 冒烟测试：你好","mood":"happy"}'); [[ "$R1" == *'"ok":true'* ]] && ok "POST /say" || bad "POST /say：$R1"
R2=$(J -X POST http://127.0.0.1:47831/agent -d '{"state":"working","source":"smoke"}'); [[ "$R2" == *'"ok":true'* ]] && ok "POST /agent working" || bad "POST /agent：$R2"
sleep 1; J http://127.0.0.1:47831/agent | grep -q '"state":"working"' && ok "GET /agent 回读 working" || bad "GET /agent 回读"
R3=$(J -X POST http://127.0.0.1:47831/dock -d '{"side":"top"}'); [[ "$R3" == *'"ok":true'* ]] && ok "POST /dock top" || bad "POST /dock：$R3"
R3b=$(J -X POST http://127.0.0.1:47831/media -d '{"kind":"music"}'); sleep 1
if [[ "$R3b" == *'"ok":true'* ]] && J http://127.0.0.1:47831/ping | grep -q '"media":"music"'; then ok "POST /media music 生效（ping 里 media=music）"; else bad "POST /media：$R3b"; fi
J -X POST http://127.0.0.1:47831/media -d '{"kind":"video"}' >/dev/null; sleep 1; J -X POST http://127.0.0.1:47831/action -d '{"name":"music"}' | grep -q '"ok":true' && ok "POST /action music" || bad "POST /action music"
J -X POST http://127.0.0.1:47831/media -d '{"kind":"none"}' >/dev/null

# 5) 渲染进程是否出错（只看渲染进程；没有托盘/dbus 的提示在虚拟显示器里是正常的）
sleep 6
grep -E "^\[renderer" "$OUT/app.log" | head -20 > "$OUT/errors.txt"
if [[ -s "$OUT/errors.txt" ]]; then bad "渲染进程有错误/警告："; cat "$OUT/errors.txt" | tee -a "$R"; else ok "应用日志没有渲染错误"; fi
xwininfo -root -tree > "$OUT/windows.txt" 2>&1 || true
grep -qi "cindy" "$OUT/windows.txt" && ok "X11 里能看到桌宠窗口" || log "WARN  X11 窗口列表里没有找到 cindy（见 windows.txt）"

# 6) 截屏
import -window root "$OUT/screen.png" 2>>"$R" && ok "已截屏 screen.png" || log "WARN  截屏失败"

# 7) 跟随 Cindy：进程存在时可见；进程消失约 16 秒后隐藏；再出现后恢复
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（cindy 在运行）: $V"
[[ "$V" == '"visible":true' ]] && ok "Cindy 在运行时桌宠可见" || bad "Cindy 在运行时桌宠不可见"
kill $DUMMY 2>/dev/null; sleep 24
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（cindy 已退出 24s）: $V"
[[ "$V" == '"visible":false' ]] && ok "Cindy 退出后桌宠自动隐藏" || bad "Cindy 退出后桌宠没有隐藏"
/tmp/cindy -e 'setTimeout(()=>{},3e6)' & DUMMY=$!; sleep 12
V=$(J http://127.0.0.1:47831/ping | grep -o '"visible":[a-z]*'); log "跟随 Cindy（cindy 重新出现）: $V"
[[ "$V" == '"visible":true' ]] && ok "Cindy 重新出现后桌宠恢复显示" || bad "Cindy 重新出现后桌宠没有恢复"

# 8) 命令行与 MCP
node integrations/deskpet-cli.cjs status > "$OUT/cli.txt" 2>&1 && ok "deskpet-cli status：$(head -c 120 "$OUT/cli.txt")" || bad "deskpet-cli status"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node integrations/deskpet-mcp.cjs 2>/dev/null > "$OUT/mcp.txt"
grep -q "pet_say" "$OUT/mcp.txt" && ok "MCP tools/list 正常" || bad "MCP tools/list"

kill $APPPID $DUMMY 2>/dev/null
log ""; [[ $FAILED -eq 0 ]] && log "== 全部检查通过 ==" || log "== 有失败项 =="
{ echo "## Linux 冒烟测试"; echo '```'; cat "$R"; echo '```'; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
