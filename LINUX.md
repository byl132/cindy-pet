# Cindy 桌宠 · Linux 版

提供两种安装包（x64）：

| 格式 | 适合 | 安装方式 |
|---|---|---|
| `.AppImage` | 所有发行版，免安装 | `chmod +x Cindy*.AppImage && ./Cindy*.AppImage` |
| `.deb` | Debian / Ubuntu / Mint 等 | `sudo apt install ./cindy-desktop-pet_*.deb` |

构建在 GitHub Actions 里完成：Actions → **build-linux** → Run workflow，完成后在页面底部下载 `Cindy-linux-appimage` 或 `Cindy-linux-deb`。

## 已知限制（先看这里）

- **Wayland 会话**：桌宠强制使用 X11（XWayland）模式运行，否则 Wayland 不允许程序自己定位和置顶窗口。大多数发行版自带 XWayland，不用额外设置。
- **透明窗口需要合成器**：GNOME、KDE、XFCE（开启合成）、Cinnamon 等都可以。如果桌宠背后出现黑块，请打开窗口合成效果。
- **托盘图标**：GNOME 默认不显示托盘图标，需要安装扩展 *AppIndicator and KStatusNotifierItem Support*。没有托盘时，直接**右键桌宠**也能打开同样的菜单。
- **全屏应用上方**：部分桌面环境里，全屏的游戏/视频会盖住桌宠，这是窗口管理器的行为。
- **AppImage 沙盒**：AppImage 内没有 setuid 的 chrome-sandbox，应用会自动用 `--no-sandbox` 运行；deb 版则使用正常沙盒。

## 与 Cindy 联动
- **跟随 Cindy**：用 `pgrep -xi cindy` 检测 Cindy 是否在运行。如果你机器上的进程名不是 `cindy`，在设置里把“跟随进程名”改成实际名称（用 `ps -e | grep -i cindy` 查看）。
- **开机自启**：在菜单里勾选后，会写入 `~/.config/autostart/cindy-desktop-pet.desktop`，取消勾选即删除。
- **配置文件**：`~/.config/cindy-desktop-pet/config.json`。
- **本机接口、命令行、MCP**：与 Windows / macOS 完全相同（127.0.0.1:47831），见 `integrations/README.md`。
- `cindy-pet://` 链接：deb 安装后自动注册；AppImage 需要用 AppImageLauncher 之类的工具集成后才会注册。

## 自己构建
```bash
npm install
npm run dist:linux      # 生成 dist/*.AppImage 与 dist/*.deb
```


## 读取并点击 Cindy 界面（实验功能，默认关闭，未经真机验证）
让桌宠把项目里的提问卡 / 命令确认卡显示在桌宠上，点选后替你点击 Cindy 里的按钮。
- 开启：右键桌宠 → 勾选“读取并点击 Cindy 界面（实验功能…）”，会先弹出说明。
- 需要：`sudo apt install python3-gi gir1.2-atspi-2.0`，并开启系统无障碍服务（GNOME：`gsettings set org.gnome.desktop.interface toolkit-accessibility true`），然后重启 Cindy，Cindy 才会暴露界面树。
- Wayland 下可能读不到；不同桌面环境表现不一样。脚本（`scripts/cindy-ui-linux.py`，AT-SPI）没有在真实 Linux 桌面上运行过，只做了语法检查。
