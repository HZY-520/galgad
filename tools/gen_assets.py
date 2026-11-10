# -*- coding: utf-8 -*-
"""
gen_assets.py —— GalGod · vivo BlueOS 版美术资源流水线

把 galgod-band（小米手环 9 Pro / 336x480 / Vela）仓库里已经转码过一次的 PNG，
重新裁切/缩放到 vivo 蓝河手表的显示尺寸，并做调色板压缩：

  src/common/img/b/<name>.png   466x466  背景（cover 裁剪，64 色 + 抖动）
  src/common/img/s/<n>.png      139x369  立绘（contain 底部对齐、透明补边，128 色 RGBA）
  src/common/img/c/<name>.png   466x466  正文/CG 满屏（cover 裁剪，64 色）
  src/common/img/w/<name>.png   640x360  CG 鉴赏宽图（完整 16:9，48 色；仅鉴赏会用到的 32 张）
  src/common/img/t/g<n>.png     120x68   CG 鉴赏缩略图（64 色）
  src/assets/images/home.png    466x666  主页标题画（等比缩放，96 色）
  src/assets/images/icon.png    114x114  应用图标（正方形、无圆角、无白边）

设计依据（BlueOS开发文档.md）：
  - 图片物理尺寸必须与目标显示区域像素尺寸严格匹配（perf-src）
  - 8 位色深 PNG 优先（perf-src）
  - 删除冗余图片（perf-src）
  - <image> 默认按原尺寸绘制，所以生成尺寸 = CSS 显示尺寸

注意：目标设备两套：
  - watch-round 466x466：图像 1:1 像素显示。
  - watch-square 432x514（设计宽度 466 -> 设计高度约 554）：背景/正文 CG 用
    object-fit: cover 铺满，轻微纵向放大（1.19x），与参考工程 galgame 的做法一致。

用法：
  python tools/gen_assets.py [--src <galgod-band 根目录>] [--out <本工程根目录>]
"""
import argparse
import io
import json
import math
import os
import re
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 目标尺寸
SCREEN_W = 466
SCREEN_H = 466                     # 圆屏设计高度（方屏实际设计高度约 554，用 100% 高度自适应）
BG_W, BG_H = 466, 466
SPRITE_W, SPRITE_H = 139, 369
CG_W, CG_H = 466, 466
WIDE_W, WIDE_H = 640, 360          # CG 鉴赏宽图（16:9），显示时按高 466 放大到 828 宽
THUMB_W, THUMB_H = 120, 68
HOME_W, HOME_H = 466, 666          # 源图 336x480 等比放大 1.387，正好 466x666
ICON_SIZE = 114

# ---------------------------------------------------------------- 调色板颜色数
BG_COLORS = 64
SP_COLORS = 128
CG_COLORS = 64
WIDE_COLORS = 48
THUMB_COLORS = 64
HOME_COLORS = 96

# 背景取景：底部会被对白底板挡住，稍微偏上
BG_BIAS_Y = 0.42

BUDGET_BYTES = 9 * 1024 * 1024     # 真机图片预算参考值（galgod-band README：< 9 MB）


def cover(im, w, h, bias_y=0.5):
    """等比缩放到刚好覆盖 w x h，然后裁剪。"""
    sw, sh = im.size
    scale = max(float(w) / sw, float(h) / sh)
    nw, nh = max(w, int(round(sw * scale))), max(h, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = int(round((nh - h) * bias_y))
    top = max(0, min(nh - h, top))
    return im.crop((left, top, left + w, top + h))


def contain(im, w, h, anchor="bottom"):
    """等比缩放到完全放进 w x h，留透明边。"""
    sw, sh = im.size
    scale = min(float(w) / sw, float(h) / sh)
    nw, nh = max(1, int(round(sw * scale))), max(1, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    left = (w - nw) // 2
    top = (h - nh) if anchor == "bottom" else (h - nh) // 2
    canvas.paste(im, (left, top), im if im.mode == "RGBA" else None)
    return canvas


def save_palette(im, path, colors, alpha):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if alpha:
        im = im.convert("RGBA")
        q = im.quantize(colors=colors, method=Image.FASTOCTREE)
    else:
        im = im.convert("RGB")
        q = im.quantize(colors=colors, method=Image.MEDIANCUT,
                        dither=Image.FLOYDSTEINBERG)
    q.save(path, "PNG", optimize=True)


def psnr(a, b):
    """两张图（同尺寸）的 PSNR，用于记录压缩损失。"""
    import math
    a = a.convert("RGB")
    b = b.convert("RGB")
    if a.size != b.size:
        return 0.0
    total = 0
    n = 0
    for pa, pb in zip(a.getdata(), b.getdata()):
        for ca, cb in zip(pa, pb):
            d = ca - cb
            total += d * d
            n += 1
    mse = total / float(max(1, n))
    return 99.0 if mse <= 0 else 10 * math.log10(255.0 * 255.0 / mse)


def parse_args(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    default_src = r"C:\Users\Administrator\BlueOSProjects\_galgod_band_src\galgod-band-main"
    p = argparse.ArgumentParser()
    p.add_argument("--src", default=default_src)
    p.add_argument("--out", default=os.path.dirname(here))
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    src = os.path.abspath(args.src)
    root = os.path.abspath(args.out)
    src_common = os.path.join(src, "src", "common")
    dst_common = os.path.join(root, "src", "common")
    img_root = os.path.join(dst_common, "img")
    assets_dst = os.path.join(root, "src", "assets", "images")

    if not os.path.isdir(os.path.join(src_common, "img")):
        sys.exit("找不到源工程图片目录: " + os.path.join(src_common, "img"))

    # 清空旧 img/（派生文件名可能与旧版本不同，避免残留进包）
    if os.path.isdir(img_root):
        import shutil
        removed = 0
        for d in os.listdir(img_root):
            p = os.path.join(img_root, d)
            if os.path.isdir(p):
                removed += len(os.listdir(p))
                shutil.rmtree(p)
            elif os.path.isfile(p):
                os.remove(p)
                removed += 1
        print("  已清空 img/（%d 个旧文件）" % removed)

    assets_js = io.open(os.path.join(src_common, "assets.js"), encoding="utf-8").read()
    # 只保留 /common/img/ 开头的路径（背景 38 + 立绘 55 + CG 34）
    img_paths = re.findall(r'"(/common/img/[^"]+)"', assets_js.split("export const IMG = [")[1].split("]")[0])

    stats = {}
    total = 0
    quality = []
    missing = []

    def record(kind, name, size_bytes):
        nonlocal total
        total += size_bytes
        stats.setdefault(kind, [0, 0])
        stats[kind][0] += 1
        stats[kind][1] += size_bytes

    # 逐张处理：按输出路径判断类型（b / s / c）
    for out_path in img_paths:
        rel = out_path.replace("/common/", "")
        kind = rel.split("/")[1]
        src_file = os.path.join(src_common, rel)
        if not os.path.isfile(src_file):
            missing.append(src_file)
            continue
        im = Image.open(src_file)
        dst = os.path.join(dst_common, rel)
        if kind == "b":
            out = cover(im, BG_W, BG_H, bias_y=BG_BIAS_Y)
            save_palette(out, dst, BG_COLORS, alpha=False)
            quality.append(("b", os.path.basename(rel), psnr(out, Image.open(dst))))
        elif kind == "s":
            out = contain(im, SPRITE_W, SPRITE_H, anchor="bottom")
            save_palette(out, dst, SP_COLORS, alpha=True)
        elif kind == "c":
            out = cover(im, CG_W, CG_H, bias_y=0.5)
            save_palette(out, dst, CG_COLORS, alpha=False)
            quality.append(("c", os.path.basename(rel), psnr(out, Image.open(dst))))
        else:
            raise RuntimeError("未知图片类型: " + rel)
        record(kind, rel, os.path.getsize(dst))

    # CG 鉴赏宽图：只给 cglist 里出现过的图片下标生成
    cglist_text = io.open(os.path.join(src_common, "cglist.js"), encoding="utf-8").read()
    cgg = json.loads(cglist_text.split("export const CGG =", 1)[1].strip())
    gallery_idx = []
    for g in cgg:
        for i in g.get("im", []):
            if i not in gallery_idx:
                gallery_idx.append(i)
    wide_names = []
    for i in gallery_idx:
        rel = img_paths[i].replace("/common/", "")
        if not rel.startswith("img/c/"):
            continue
        src_file = os.path.join(src_common, rel)
        im = Image.open(src_file)
        out = im.convert("RGB").resize((WIDE_W, WIDE_H), Image.LANCZOS)
        dst = os.path.join(dst_common, "img", "w", os.path.basename(rel))
        save_palette(out, dst, WIDE_COLORS, alpha=False)
        quality.append(("w", os.path.basename(rel), psnr(out, Image.open(dst))))
        record("w", rel, os.path.getsize(dst))
        wide_names.append(os.path.basename(rel))

    # CG 鉴赏缩略图 9 组（16:9 取景，从宽图源缩）
    for gi, g in enumerate(cgg):
        idx = (g.get("im") or [None])[0]
        if idx is None:
            continue
        rel = img_paths[idx].replace("/common/", "")
        src_file = os.path.join(src_common, rel)
        if not os.path.isfile(src_file):
            missing.append(src_file)
            continue
        out = cover(Image.open(src_file), THUMB_W, THUMB_H, bias_y=0.5)
        dst = os.path.join(dst_common, "img", "t", "g%d.png" % gi)
        save_palette(out, dst, THUMB_COLORS, alpha=False)
        record("t", "g%d" % gi, os.path.getsize(dst))

    # 未解锁 CG 的占位缩略图（112x63 深色 + 问号）。
    # 列表用同一张图替换未解锁行，避免在 list-item 里用绝对定位叠遮罩
    # （BlueOS 的 list-item 内定位不可靠），也保证同一 type 的 item DOM 完全一致。
    lock = Image.new("RGB", (THUMB_W, THUMB_H), (25, 19, 32))
    draw = ImageDraw.Draw(lock)
    font = None
    for font_path in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.isfile(font_path):
            try:
                font = ImageFont.truetype(font_path, 30)
                break
            except Exception:
                font = None
    if font is not None:
        draw.text((THUMB_W / 2, THUMB_H / 2 - 2), "?", font=font,
                  fill=(76, 64, 85), anchor="mm")
    else:
        draw.text((THUMB_W // 2 - 6, THUMB_H // 2 - 8), "?", fill=(76, 64, 85))
    lock_path = os.path.join(dst_common, "img", "t", "lock.png")
    save_palette(lock, lock_path, 8, alpha=False)
    record("t", "lock", os.path.getsize(lock_path))

    # 主页标题画：源 336x480 -> 466x666 等比放大（下端会被按钮面板盖住）
    home_src = os.path.join(src_common, "home.png")
    os.makedirs(assets_dst, exist_ok=True)
    if os.path.isfile(home_src):
        art = Image.open(home_src).convert("RGB")
        art = art.resize((HOME_W, HOME_H), Image.LANCZOS)
        save_palette(art, os.path.join(assets_dst, "home.png"), HOME_COLORS, alpha=False)
        record("home", "home", os.path.getsize(os.path.join(assets_dst, "home.png")))

    # 应用图标：正方形、无圆角、无白边（BlueOS manifest 要求 114x114）
    # 源 icon.png 自带圆角透明，不满足「不能是圆角」；这里从主页画里取女孩脸部构图。
    icon_src = os.path.join(src_common, "home.png")
    if os.path.isfile(icon_src):
        art = Image.open(icon_src).convert("RGB")
        aw, ah = art.size
        side = int(round(ah * 0.30))                  # 144（480*0.30）
        cx, cy = int(round(aw * 0.675)), int(round(ah * 0.24))
        l = max(0, min(aw - side, cx - side // 2))
        t = max(0, min(ah - side, cy - side // 2))
        im = art.crop((l, t, l + side, t + side)).resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        canvas = Image.new("RGB", (ICON_SIZE, ICON_SIZE), (13, 9, 16))
        canvas.paste(im, (0, 0))
        icon_path = os.path.join(assets_dst, "icon.png")
        canvas.save(icon_path, "PNG", optimize=True)
        record("icon", "icon", os.path.getsize(icon_path))

    # 统计与报告
    print("图片总量 : %.2f MB（预算 %.1f MB）" % (total / 1048576.0, BUDGET_BYTES / 1048576.0))
    for k in sorted(stats):
        n, b = stats[k]
        print("  %-5s %3d 张  %6.2f MB  均值 %6.0f B" % (k, n, b / 1048576.0, b / max(1, n)))
    for kind in ("b", "c", "w"):
        vals = [q for q in quality if q[0] == kind]
        if vals:
            avg = sum(q[2] for q in vals) / len(vals)
            lo = min(q[2] for q in vals)
            print("  PSNR %-2s 均值 %.2f dB（最低 %.2f dB，%s）"
                  % (kind, avg, lo, min(vals, key=lambda x: x[2])[1]))
    print("  CG 鉴赏宽图 %d 张: %s ..." % (len(wide_names), ", ".join(wide_names[:6])))

    if missing:
        print("!! 缺少源图 %d 张:" % len(missing))
        for m in missing[:20]:
            print("   " + m)
        return 1
    if total > BUDGET_BYTES:
        print("!! 超过 %.1f MB 预算，需要继续压低颜色数/尺寸" % (BUDGET_BYTES / 1048576.0))
        return 2
    expected = {"b": 38, "s": 55, "c": 34, "w": len(wide_names), "t": len(cgg) + 1,
                "home": 1, "icon": 1}
    bad = []
    for k, want in expected.items():
        if stats.get(k, [0])[0] != want:
            bad.append("%s 产出 %d 张，期望 %d" % (k, stats.get(k, [0])[0], want))
    if bad:
        print("!! 产出数量不符:\n  " + "\n  ".join(bad))
        return 3
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
