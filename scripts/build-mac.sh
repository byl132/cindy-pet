#!/usr/bin/env bash
# 在 macOS 上构建 Cindy 桌宠（通用 Intel + Apple 芯片）。需要：macOS、Node.js 18+、已执行 npm install。
# 输出：dist/Cindy桌宠-mac-universal.zip 和 dist/Cindy桌宠-mac-universal.dmg
# 说明：未使用 Apple 开发者证书，只做“临时签名（ad-hoc）”。Apple 芯片的 Mac 要求应用至少有一个签名，否则会提示“已损坏”；
#       临时签名的应用首次打开需要在“系统设置 → 隐私与安全性”里点“仍要打开”，或右键 → 打开。
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname)" != "Darwin" ]]; then echo "这个脚本只能在 macOS 上运行（Windows/Linux 无法构建 macOS 应用）。可以改用 GitHub Actions：见 .github/workflows/build-mac.yml"; exit 1; fi

APP_NAME="Cindy桌宠"
export CSC_IDENTITY_AUTO_DISCOVERY=false
rm -rf "dist/mac-universal"
npx electron-builder --mac dir --universal -c.mac.identity=null

APP="dist/mac-universal/${APP_NAME}.app"
[[ -d "$APP" ]] || { echo "没有找到 $APP"; ls dist; exit 1; }

echo "== 临时签名 =="
codesign --force --deep --sign - "$APP"
codesign --verify --deep --verbose=2 "$APP" || true

echo "== 打包 zip / dmg =="
ZIP="dist/${APP_NAME}-mac-universal.zip"; DMG="dist/${APP_NAME}-mac-universal.dmg"
rm -f "$ZIP" "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$DMG"
echo "完成：$ZIP  $DMG"
