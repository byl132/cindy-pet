"""把桌面版素材压成适合插件包的 256 色透明 PNG，并用默认造型的脸部裁一张图标。"""
import os, glob
from PIL import Image

SRC, DST, K = "assets", "plugin/assets", 0.75
for f in glob.glob(f"{SRC}/*/*.png"):
    o = f.split(os.sep)[-2] if os.sep in f else f.split("/")[-2]
    n = os.path.splitext(os.path.basename(f))[0]
    if n.startswith(("held", "peek_")):   # 插件页面暂不使用被拎起/趴边素材
        continue
    im = Image.open(f).convert("RGBA")
    bb = im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    # 保持底边和水平中心不变：只裁掉上方空白，减小体积
    im = im.crop((0, max(0, bb[1] - 4), im.width, im.height))
    im = im.resize((int(im.width * K), int(im.height * K)), Image.LANCZOS)
    os.makedirs(f"{DST}/{o}", exist_ok=True)
    q = im.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)  # 保留透明通道的 256 色 PNG
    q.save(f"{DST}/{o}/{n}.png", optimize=True)

# 图标：默认造型 idle 的头部
im = Image.open(f"{SRC}/default/idle.png").convert("RGBA")
bb = im.getchannel("A").getbbox()
w = bb[2] - bb[0]
head = im.crop((bb[0] - 10, bb[1] - 6, bb[2] + 10, bb[1] + int(w * 1.05)))
side = max(head.size)
icon = Image.new("RGBA", (side, side), (0, 0, 0, 0))
icon.paste(head, ((side - head.width) // 2, (side - head.height) // 2), head)
icon = icon.resize((256, 256), Image.LANCZOS)
os.makedirs(f"{DST}", exist_ok=True)
icon.save(f"{DST}/icon.png", optimize=True)
print("done")
