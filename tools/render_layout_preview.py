# -*- coding: utf-8 -*-
"""
render_layout_preview.py —— 按 common/layout.js 的几何常量，把 Game 页渲染成预览图。

用途：真机/模拟器不方便快速对比时，用真实素材 + 真实几何数值合成一张 1:1 的版面图，
检查对白面板占屏比例、正文安全区、顶部「≡」菜单按钮位置是否合理。

注意：这不是模拟器截图，而是按 layout.js 数值直接绘制的几何预检图。

用法：
  python tools/render_layout_preview.py [--out docs/preview]
产出：
  docs/preview/game-round.png   466x466（圆屏，圆形裁切）
  docs/preview/game-square.png  466x554（方屏）
"""
import argparse
import io
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT_JS = os.path.join(ROOT, "src", "common", "layout.js")

BG_IMAGE = os.path.join(ROOT, "src", "common", "img", "b", "school1.png")
STORY_CHUNK = os.path.join(ROOT, "src", "common", "story", "chunk-000.json")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\Deng.ttf",
]
MONO_CANDIDATES = [r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\arial.ttf"]


def load_font(size, bold=True):
    for path in (FONT_CANDIDATES if bold else FONT_CANDIDATES[1:]):
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def js_const(name):
    """从 layout.js 里抠出 `export const NAME = { ... }` 并解析成 dict。

    对象字面量的 key 没有引号、可能有注释与尾逗号，这里做最小化处理：
    去注释 → key 加引号 → 去尾逗号 → json 解析。
    """
    text = io.open(LAYOUT_JS, encoding="utf-8").read()
    m = re.search(r"export const %s = (\{.*?\n\})" % name, text, re.S)
    if not m:
        raise RuntimeError("layout.js 里找不到 %s" % name)
    body = m.group(1)
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"^\s*/\*.*?\*/\s*$", "", body, flags=re.S)
    body = re.sub(r"([{,]\s*)([A-Za-z_][\w]*)\s*:", r'\1"\2":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    body = re.sub(r"'\s*", '"', body)
    body = re.sub(r'"\s*', '"', body)
    return json.loads(body)


def sample_dialogue():
    """取一段真实台词（优先挑 3~4 行的长句）。"""
    try:
        nodes = json.load(io.open(STORY_CHUNK, encoding="utf-8"))
    except Exception:
        return "月幕下，清辉洒落。", "旁白"
    for node in nodes:
        if node.get("t") == "s" and 40 <= len(node.get("x", "")) < 90:
            return node.get("x", ""), (node.get("n") or "")
    return nodes[0].get("x", ""), (nodes[0].get("n") or "")


def wrap(text, cpl):
    lines, cur = [], ""
    for ch in text:
        cur += ch
        if len(cur) >= cpl:
            lines.append(cur)
            cur = ""
    if cur:
        lines.append(cur)
    return lines


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render(shape, out_dir):
    L = {}
    for name in ("PANEL", "NAME", "TEXT", "NEXT_HINT", "HUD", "MENU_BTN", "VIEWPORT", "SPRITE"):
        L[name] = js_const(name)
    viewport_h = L["VIEWPORT"][shape]
    width = 466
    height = viewport_h

    # 背景：源图 466x466，方屏纵向铺满
    if os.path.isfile(BG_IMAGE):
        bg = Image.open(BG_IMAGE).convert("RGB").resize((width, viewport_h if shape == "round" else viewport_h), Image.LANCZOS)
    else:
        bg = Image.new("RGB", (width, height), (24, 20, 30))
    canvas = bg.copy()
    if shape == "square":
        canvas = bg.resize((width, viewport_h), Image.LANCZOS)

    # 立绘（真实素材，取一张中心立绘）
    sprite_path = os.path.join(ROOT, "src", "common", "img", "s", "001.png")
    if os.path.isfile(sprite_path):
        sp = Image.open(sprite_path).convert("RGBA")
        sp = sp.resize((L["SPRITE"]["width"], L["SPRITE"]["height"]), Image.LANCZOS)
        canvas.paste(sp, (L["SPRITE"]["center"], height - L["SPRITE"]["height"]), sp)

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    panel = L["PANEL"][shape]
    panel_top = height - panel["bottom"] - panel["height"]
    rounded(d, [panel["left"], panel_top, panel["left"] + panel["width"], panel_top + panel["height"]],
            panel["radius"], (18, 13, 19, 204))

    name_cfg = L["NAME"][shape]
    name_top = height - name_cfg["bottom"] - name_cfg["height"]
    rounded(d, [name_cfg["left"], name_top, name_cfg["left"] + name_cfg["width"], name_top + name_cfg["height"]],
            15, (16, 11, 18, 190))

    hud = L["HUD"][shape]
    rounded(d, [hud["left"], hud["top"], hud["left"] + hud["width"], hud["top"] + hud["height"]],
            hud["height"] // 2, (0, 0, 0, 140))

    fab = L["MENU_BTN"][shape]
    rounded(d, [fab["left"], fab["top"], fab["left"] + fab["width"], fab["top"] + fab["height"]],
            fab["radius"], (27, 21, 32, 210))

    text_cfg = L["TEXT"][shape]
    text_top = height - text_cfg["bottom"] - text_cfg["height"]

    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    d = ImageDraw.Draw(canvas)

    # 顶部信息 + 菜单按钮图标
    d.text((hud["left"] + hud["width"] // 2, hud["top"] + hud["height"] // 2), "第一幕 · 月幕 · 12%",
           font=load_font(hud["size"]), fill=(255, 230, 239), anchor="mm")
    d.text((fab["left"] + fab["width"] // 2, fab["top"] + fab["height"] // 2 - 2), "≡",
           font=load_font(fab["size"]), fill=(255, 216, 230), anchor="mm")

    # 说话人
    speaker = "林曦"
    d.text((name_cfg["left"] + name_cfg["width"] // 2, name_top + name_cfg["height"] // 2), speaker,
           font=load_font(22), fill=(255, 216, 230), anchor="mm")

    # 正文：字号 20、行高 24、每行 floor((宽-12)/20)
    text, _ = sample_dialogue()
    size = 20
    line_h = size + 4
    cpl = max(4, (text_cfg["width"] - 12) // size)
    lines = wrap(text, cpl)
    capacity = max(1, min(6, text_cfg["height"] // line_h))
    font = load_font(size, bold=True)
    for i, line in enumerate(lines[:capacity]):
        d.text((text_cfg["left"], text_top + i * line_h), line, font=font, fill=(255, 255, 255))

    hint = L["NEXT_HINT"][shape]
    d.text((hint["left"], height - hint["bottom"] - hint["size"]), "▼",
           font=load_font(hint["size"]), fill=(255, 158, 196))

    # 圆屏裁切
    if shape == "round":
        mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, width - 1, height - 1], fill=255)
        out = Image.new("RGBA", (width, height), (0, 0, 0, 255))
        out.paste(canvas, (0, 0), mask)
        canvas = out
        # 画出安全圆参考线（半径 215，仅预览用）
        d2 = ImageDraw.Draw(canvas)
        d2.ellipse([233 - 215, 233 - 215, 233 + 215, 233 + 215], outline=(90, 200, 220, 160), width=1)

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "game-%s.png" % shape)
    canvas.convert("RGB").save(path, "PNG")
    ratio = panel["height"] / float(viewport_h) * 100
    print("  %-6s 面板 %dx%d（占屏高 %.1f%%）、正文 %dx%d（每行 %d 字 / %d 行）→ %s"
          % (shape, panel["width"], panel["height"], ratio,
             text_cfg["width"], text_cfg["height"], cpl, capacity, os.path.relpath(path, ROOT)))
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "preview"))
    args = ap.parse_args()
    print("[render_layout_preview] 几何来自 %s" % os.path.relpath(LAYOUT_JS, ROOT))
    for shape in ("round", "square"):
        render(shape, args.out)


if __name__ == "__main__":
    sys.exit(main())
