"""把 raw/ 里的姿势表、行走表、动作表切成 assets/<服装>/ 下的透明 PNG。
所有图保持同一像素比例（不逐帧缩放），运行时再按 idle 的身高归一。"""
import os, numpy as np
from PIL import Image
from scipy import ndimage as ndi

def clean(img):
    a = np.array(img.getchannel("A"))
    lab, n = ndi.label(a > 40)
    sizes = ndi.sum(a > 40, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 150])
    a = np.where(keep, a, 0).astype(np.uint8)
    out = img.copy(); out.putalpha(Image.fromarray(a)); return out

def cells(path, cols, rows):
    im = Image.open(path).convert("RGBA"); W, H = im.size; res = []
    for r in range(rows):
        for c in range(cols):
            k = clean(im.crop((c*W//cols, r*H//rows, (c+1)*W//cols, (r+1)*H//rows)))
            bb = k.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
            res.append(k.crop(bb))
    return res

def save(frames, names, size, outdir):
    os.makedirs(outdir, exist_ok=True)
    if size is None:   # 行走帧：画布按最大帧自适应，避免把头裁掉
        size = (int(max(f.width for f in frames) * 1.6), max(f.height for f in frames) + 12)
    cw, ch = size
    for f, n in zip(frames, names):
        a = np.array(f.getchannel("A")); low = a[int(a.shape[0]*0.85):]
        xs = np.where(low.max(axis=0) > 40)[0]; fx = int(xs.mean()) if len(xs) else f.width // 2
        cv = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        x = cw // 2 - fx; y = ch - 6 - f.height
        cv.paste(f, (x, y), f); cv.save(f"{outdir}/{n}.png", optimize=True)

POSES = ["idle", "happy", "talk", "comfort", "sleep", "shy"]
ACTIONS = ["sit", "stretch", "hug", "lie", "cheer", "drink"]
OUTFITS = {"default": ("poses", "walk"), "hoodie": ("poses_hoodie", "walk_hoodie"),
           "gothic": ("poses_gothic", "walk_gothic"), "pajama": ("poses_pajama", "walk_pajama")}
for o, (p, w) in OUTFITS.items():
    d = f"assets/{o}"
    save(cells(f"raw/{p}.png", 3, 2), POSES, (512, 512), d)
    save(cells(f"raw/{w}.png", 4, 1), ["walk1", "walk2", "walk3", "walk4"], None, d)
ACTION_SHEETS = {"default": "actions", "hoodie": "actions_hoodie2", "gothic": "actions_gothic", "pajama": "actions_pajama"}
for o, f in ACTION_SHEETS.items():
    save(cells(f"raw/{f}.png", 3, 2), ACTIONS, (512, 512), f"assets/{o}")

# 被拎起来悬空：4 列(服装) x 2 行(帧A/帧B)
held = cells("raw/held.png", 4, 2)
for i, o in enumerate(["default", "hoodie", "gothic", "pajama"]):
    save([held[i], held[4 + i]], ["held1", "held2"], None, f"assets/{o}")
print("ok")

# ---- 趴在屏幕边上：贴边对齐输出（不留底边空隙）----
def save_flush(frames, names, edge, outdir):
    os.makedirs(outdir, exist_ok=True)
    w = max(f.width for f in frames) + 8; h = max(f.height for f in frames) + 8
    for f, n in zip(frames, names):
        cv = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        x = 0 if edge == "left" else (w - f.width) // 2
        y = h - f.height if edge == "bottom" else (0 if edge == "top" else (h - f.height) // 2)
        if edge == "left": y = h - f.height
        cv.paste(f, (x, y), f); cv.save(f"{outdir}/{n}.png", optimize=True)

PEEK_SHEETS = {"default": "peek", "hoodie": "peek_hoodie", "gothic": "peek_gothic", "pajama": "peek_pajama"}
for o, f in PEEK_SHEETS.items():
    if not os.path.exists(f"raw/{f}.png"):
        print("skip peek", o); continue
    pk = cells(f"raw/{f}.png", 3, 2)
    save_flush(pk[:3], ["peek_b_idle", "peek_b_sleep", "peek_b_happy"], "bottom", f"assets/{o}")
    save_flush(pk[3:], ["peek_s_idle", "peek_s_sleep", "peek_s_happy"], "left", f"assets/{o}")
print("peek ok")

# ---- 趴在上边缘：顶边对齐 ----
TOP_SHEETS = {"default": "peektop_default", "hoodie": "peektop_hoodie", "gothic": "peektop_gothic2", "pajama": "peektop_pajama"}
for o, f in TOP_SHEETS.items():
    save_flush(cells(f"raw/{f}.png", 3, 1), ["peek_t_idle", "peek_t_sleep", "peek_t_happy"], "top", f"assets/{o}")
print("peek top ok")

# ---- 工作姿势：打字/看书/思考/举手等你/报错/趴桌睡 ----
WORK = ["work_type", "work_read", "work_think", "work_wait", "work_error", "work_sleep"]
for o in ["default", "hoodie", "gothic", "pajama"]:
    save(cells(f"raw/work_{o}.png", 3, 2), WORK, (512, 512), f"assets/{o}")
print("work ok")
