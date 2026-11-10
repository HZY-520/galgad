# -*- coding: utf-8 -*-
"""轻量 .ux 结构自检：三段齐全、标签配对、{{ }} 配对、静态禁用项。

正式校验由 tools/validate-pages.mjs 负责；本脚本用于页面作者本地快速自检
（不依赖 IDE / Node 依赖，可直接用 python 跑）。

用法：python tools/local_check_ux.py [页面目录...]（默认扫 src/pages）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOID = set()

FORBIDDEN = [
    (r'@system\.', '禁止 Vela 的 @system.*，改用 @blueos.*'),
    (r'\bonswipe\b', 'BlueOS 没有 onswipe 事件，改用 touchstart/touchend 自算手势'),
    (r'\bscrollview\b', 'BlueOS 无 scrollview，使用 scroll/list'),
    (r'<slider', '不推荐 slider（参考工程实机验证改用步进按钮）'),
    (r'flex:\s*1', '禁止 flex: 1'),
    (r'(?<!text-)overflow\s*:', 'BlueOS 不支持 overflow 裁剪，用显式定位/屏幕裁切'),
    (r'position\s*:\s*relative', '避免 position: relative（改用 absolute + 显式 px）'),
    (r'@swipe\b', 'BlueOS 无 swipe 事件'),
    (r'(?<![-\w])opacity\s*:', '带子节点的容器不要用 opacity，半透明用 rgba 背景色'),
    (r'width\s*:\s*100%', '避免百分比宽度（实机会二次换算），改显式 px'),
    (r'scrollTo\s*\(', 'BlueOS list/scroll 的 scrollTo 不可靠，避免依赖'),
    (r'box-shadow', 'BlueOS 不支持 box-shadow'),
    (r'z-index', 'BlueOS 不支持 z-index，靠 DOM 顺序'),
]


def norm(text):
    return text.replace('\r\n', '\n')


def parse_blocks(text):
    blocks = {}
    for name in ('script', 'template', 'style'):
        m = re.search(r'<%s[^>]*>(.*?)</%s>' % (name, name), text, re.S)
        if m:
            blocks[name] = m.group(1)
    return blocks


def check_braces(blocks):
    errors = []
    tmpl = blocks.get('template', '')
    depth = 0
    for i, ch in enumerate(tmpl):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth < 0:
                errors.append('模板中 }} 多余（位置 %d）' % i)
                depth = 0
    if depth != 0:
        errors.append('模板中 {{ / }} 数量不配对（剩余 %d）' % depth)
    return errors


def check_tags(blocks):
    errors = []
    tmpl = blocks.get('template', '')
    # 去掉注释和 {{ }} 表达式
    tmpl = re.sub(r'<!--.*?-->', '', tmpl, flags=re.S)
    tmpl = re.sub(r'\{\{.*?\}\}', 'EXPR', tmpl, flags=re.S)
    stack = []
    for m in re.finditer(r'<(/?)([a-zA-Z][\w-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>', tmpl):
        closing, name, attrs = m.group(1), m.group(2), m.group(3)
        if closing:
            if not stack:
                errors.append('多余闭合标签 </%s>' % name)
                continue
            top = stack.pop()
            if top != name:
                errors.append('标签不配对：<{%s}> 被 </%s> 关闭' % (top, name))
        elif attrs.rstrip().endswith('/') or name in VOID:
            continue
        else:
            stack.append(name)
    for name in stack:
        errors.append('未闭合标签 <%s>' % name)
    return errors


def strip_comments(text):
    """去掉 HTML / JS / CSS 注释后再做静态禁用项检查，避免注释里的说明误报。"""
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r'^\s*//.*$', '', text, flags=re.M)
    return text


def check_static(text):
    errors = []
    code = strip_comments(text)
    for pat, why in FORBIDDEN:
        if re.search(pat, code):
            errors.append('静态禁用项 %r：%s' % (pat, why))
    return errors


def main(argv):
    targets = argv or [os.path.join(ROOT, 'src', 'pages')]
    files = []
    for t in targets:
        if os.path.isdir(t):
            for base, _dirs, names in os.walk(t):
                for n in names:
                    if n.endswith('.ux'):
                        files.append(os.path.join(base, n))
        elif t.endswith('.ux'):
            files.append(t)
    if not files:
        print('没有找到 .ux 文件')
        return 2
    total_err = 0
    for f in sorted(files):
        text = norm(open(f, 'r', encoding='utf-8').read())
        blocks = parse_blocks(text)
        errs = []
        for need in ('script', 'template', 'style'):
            if need not in blocks:
                errs.append('缺少 <%s> 段' % need)
        errs += check_braces(blocks)
        errs += check_tags(blocks)
        errs += check_static(text)
        rel = os.path.relpath(f, ROOT)
        if errs:
            total_err += len(errs)
            print('FAIL %s' % rel)
            for e in errs:
                print('   - ' + e)
        else:
            print('PASS %s' % rel)
    print('\n[local_check_ux] %s（%d 个文件，%d 个问题）'
          % ('PASS' if total_err == 0 else 'FAIL', len(files), total_err))
    return 0 if total_err == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
