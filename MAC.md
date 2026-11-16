# Cindy 桌宠 · macOS 版

桌宠的代码是跨平台的（Electron），macOS 版已做这些适配：

| 项目 | macOS 上的做法 |
|---|---|
| 菜单栏图标 | 用菜单栏（Tray）图标代替 Windows 托盘；不占 Dock |
| 窗口层级 | 置顶、所有桌面/全屏应用上都可见 |
| 趴在上边缘 | 放开“窗口不得超出屏幕/菜单栏”的限制 |
| 跟随 Cindy | 用 `pgrep -x Cindy` 检测 Cindy 是否在运行 |
| 系统链接 `cindy-pet://` | 通过 macOS 的 open-url 事件处理 |
| 开机自动启动 | 登录项（系统设置 → 通用 → 登录项） |

> **重要**：我是在 Windows 上开发的，**没有 Mac 设备实测过**。上面的适配按 Electron 官方行为编写并做了语法检查，第一次在 Mac 上运行时请留意下面“可能需要调整的地方”。

## 怎么得到 macOS 安装包
Windows 无法构建 macOS 应用，有两种办法：

**办法 A：有 Mac 的话**
```bash
npm install
npm run dist:mac        # 输出 dist/Cindy桌宠-mac-universal.dmg 和 .zip（同时支持 Intel 与 Apple 芯片）
```

**办法 B：用 GitHub Actions（不需要 Mac）**
1. 把整个项目推到一个 GitHub 仓库（`.github/workflows/build-mac.yml` 已经写好）。
2. 打开仓库的 Actions → build-mac → Run workflow。
3. 构建完成后，在运行页面底部的 Artifacts 下载 `Cindy桌宠-mac`。

## 第一次打开
应用没有 Apple 开发者证书签名，只做了临时签名，所以 macOS 会拦一下：
- 右键点应用 → 打开 → 再点“打开”；或
- 系统设置 → 隐私与安全性 → 找到被拦截的提示 → “仍要打开”；或
- 终端执行：`xattr -cr "/Applications/Cindy桌宠.app"`

## 与其他 AI / Cindy 联动（和 Windows 相同）
`integrations` 文件夹在 `Cindy桌宠.app/Contents/Resources/integrations`。例如 Claude Code 的钩子命令：
```
node "/Applications/Cindy桌宠.app/Contents/Resources/integrations/deskpet-cli.cjs" claude-hook
```
MCP 配置里的路径同理。Cindy 里的“桌宠联动”插件不需要改，直接用同一个 `.cindy`。

## 可能需要调整的地方（第一次在 Mac 上运行时看一下）
1. **透明窗口点击穿透**：桌宠身体以外的区域应当能点到下面的窗口。
2. **全屏应用上是否还显示**：已设置“在所有桌面和全屏上可见”，部分系统版本可能需要在 系统设置 → 桌面与程序坞 里允许。
3. **跟随 Cindy**：如果 Cindy 的进程名不是 `Cindy`，在 `~/Library/Application Support/cindy-desktop-pet/config.json` 里把 `followProcess` 改成实际进程名（活动监视器里看）。
4. **菜单栏图标大小**：目前按 18pt 缩放，如果太大或太小告诉我。
