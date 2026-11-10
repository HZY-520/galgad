#!/usr/bin/env node
/**
 * BlueOS 页面静态校验（tools/validate-pages.mjs）
 *
 * 只读：不 import 工程业务模块（layout.js 用 data: URL 动态加载），不修改 src/。
 *
 * 规则（对应 docs/PORT-SPEC.md §0 硬性规则 + 任务 task-6 item D）：
 *  A. 页面三段式：<script> → <template> → <style> 均存在且闭合；单根节点；标签配平。
 *  B. manifest 路由 ↔ src/pages 目录一致（缺页面输出「未实现」，不算 error）。
 *  C. 模板：
 *     - 禁止 @system. / onswipe / @swipe / scrollview / swiper / image-animator / slider；
 *     - 事件只允许 click/longpress/change/touchstart/touchmove/touchend/touchcancel；
 *       事件处理函数必须在 <script> 中存在；<image> 不得绑定事件；
 *     - <list> 直接子节点只能是 <list-item>；<list-item> 必须有 type；
 *     - <image> 必须有显式宽高 + object-fit（class 规则/内联 style/属性任一来源，动态 style 记 warning）；
 *       静态 src 文件必须存在；
 *  D. 脚本：
 *     - 禁止 private:/protected:/public:、@system.、require(、动态 import；
 *     - 本地模块 import 必须是相对路径 + .js 且文件存在；@blueos.* import 必须在脚本顶部；
 *     - onInit 内不得直接调用 storage/router/prompt/file/brightness/$app 等 feature API；
 *     - data 字段声明：模板绑定的标识符、路由参数必须出现在 data 里；
 *       对 this.X = 的赋值若 X 未在 data 声明记 warning（响应式坑，PORT-SPEC §0.3）；
 *  E. 样式：
 *     - .page 必须 width: 466px；禁止百分比 width；
 *     - 禁止 position: relative / overflow / z-index / box-shadow / filter / 多值 border-radius /
 *       top: auto / flex: 1 / flex-grow；
 *     - opacity 只允许给空 div（带子节点的容器用 rgba 背景色）；
 *     - 禁止 @import / lang="scss" / scss 变量 / @media (shape:)；
 *     - 无 #id 选择器、无后代选择器（warning，性能规范）；
 *  F. Game 页 CSS 几何常量必须与 common/layout.js 的 PANEL/NAME/TEXT/NEXT_HINT/HUD/SPRITE 完全一致
 *     （圆屏 + .square 两套），避免「改一半」导致实机错位。
 *  G. features 声明：代码 import 的 @blueos.* 能力必须在 manifest.features 声明；
 *     5 项必需能力（storage.storage/storage.file/window.prompt/display.brightness/app.app）齐全。
 *  H. About 页 APP_VER == manifest.versionName（About 未实现时记 TODO）。
 *
 * 用法: node tools/validate-pages.mjs [--verbose] [--json <file>]
 * 退出码: 0 = 无 error；1 = 有 error。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const PAGES_DIR = path.join(SRC, 'pages')
const MANIFEST_FILE = path.join(SRC, 'manifest.json')
const REPORT_DIR = path.join(ROOT, 'scripts', 'reports')

const EXPECTED_PAGES = ['pages/Home', 'pages/Game', 'pages/Saves', 'pages/Chapters', 'pages/Gallery', 'pages/Settings', 'pages/About']
const ALLOWED_EVENTS = new Set(['click', 'longpress', 'change', 'touchstart', 'touchmove', 'touchend', 'touchcancel'])
const FORBIDDEN_TAGS = ['scrollview', 'swiper', 'image-animator', 'slider']
const REQUIRED_FEATURES = [
  'blueos.storage.storage',
  'blueos.storage.file',
  'blueos.window.prompt',
  'blueos.hardware.display.brightness',
  'blueos.app.app',
]
// @blueos 模块 -> manifest.features 里的能力名（router 归到 blueos.app.app）
const FEATURE_ALIAS = {
  '@blueos.app.appmanager.router': 'blueos.app.app',
  '@blueos.app.app': 'blueos.app.app',
  '@blueos.window.prompt': 'blueos.window.prompt',
  '@blueos.storage.storage': 'blueos.storage.storage',
  '@blueos.storage.file': 'blueos.storage.file',
  '@blueos.hardware.display.brightness': 'blueos.hardware.display.brightness',
}

const CONTEXT_KEYS = new Set(['$item', '$idx', '$event', '$device', '$app', '$element', 'this', 'true', 'false', 'null', 'undefined'])

// ---------------------------------------------------------------- 通用工具
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

function stripCommentsAndStrings(text) {
  const out = text.split('')
  let i = 0
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        out[i] = ' '
        i += 1
      }
      continue
    }
    if (char === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' '
        i += 1
      }
      if (i < text.length) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      out[i] = ' '
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          out[i] = ' '
          if (i + 1 < text.length && text[i + 1] !== '\n') out[i + 1] = ' '
          i += 2
          continue
        }
        if (text[i] === quote) {
          out[i] = ' '
          i += 1
          break
        }
        if (text[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

function extractBlock(text, name) {
  const openPattern = new RegExp(`<${name}\\b[^>]*>`, 'i')
  const openMatch = openPattern.exec(text)
  if (!openMatch) return null
  const contentOffset = openMatch.index + openMatch[0].length
  const rest = text.slice(contentOffset)
  const closePattern = new RegExp(`</${name}\\s*>`, 'i')
  const closeMatch = closePattern.exec(rest)
  if (!closeMatch) return { content: rest, startLine: lineAt(text, openMatch.index), contentOffset, closed: false, openTag: openMatch[0] }
  return {
    content: rest.slice(0, closeMatch.index),
    startLine: lineAt(text, openMatch.index),
    contentOffset,
    closed: true,
    openTag: openMatch[0],
  }
}

/** 嵌套深度感知的 { } 块读取 */
function readBalancedBlock(text, openIndex) {
  let depth = 0
  let i = openIndex
  while (i < text.length) {
    const char = text[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { content: text.slice(openIndex + 1, i), endIndex: i }
    }
    i += 1
  }
  return { content: text.slice(openIndex + 1), endIndex: text.length }
}

/** 解析 CSS 规则（支持 @media 嵌套），返回 [{selector, decls, atRule}] */
function parseCss(cssText) {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules = []
  const atRules = []
  function parseRange(start, end) {
    let i = start
    while (i < end) {
      while (i < end && /\s/.test(text[i])) i += 1
      if (i >= end) break
      const preludeStart = i
      let cursor = i
      while (cursor < end && text[cursor] !== '{' && text[cursor] !== ';' && text[cursor] !== '}') cursor += 1
      const prelude = text.slice(preludeStart, cursor).trim()
      if (cursor >= end) break
      if (text[cursor] === ';') {
        if (prelude.startsWith('@')) atRules.push({ prelude, block: '' })
        i = cursor + 1
        continue
      }
      if (text[cursor] === '}') {
        i = cursor + 1
        continue
      }
      const block = readBalancedBlock(text, cursor)
      if (prelude.startsWith('@')) {
        atRules.push({ prelude, block: block.content })
        parseRange(cursor + 1, block.endIndex)
      } else if (prelude) {
        const decls = {}
        block.content.split(';').forEach((chunk) => {
          const colon = chunk.indexOf(':')
          if (colon <= 0) return
          const prop = chunk.slice(0, colon).trim().toLowerCase()
          const value = chunk.slice(colon + 1).trim()
          if (prop && value) decls[prop] = value
        })
        prelude.split(',').forEach((selector) => {
          const clean = selector.trim()
          if (clean) rules.push({ selector: clean, decls })
        })
      }
      i = block.endIndex + 1
    }
  }
  parseRange(0, text.length)
  return { rules, atRules }
}

/** 模板解析成树（元素 + 文本 + 属性） */
function tokenizeTemplate(template) {
  const tokens = []
  let i = 0
  let textBuffer = ''
  const flushText = (offset) => {
    if (textBuffer.trim()) tokens.push({ kind: 'text', text: textBuffer.trim(), offset })
    textBuffer = ''
  }
  while (i < template.length) {
    const lt = template.indexOf('<', i)
    if (lt < 0) {
      textBuffer += template.slice(i)
      break
    }
    if (lt > i) textBuffer += template.slice(i, lt)
    flushText(lt)
    if (template.startsWith('<!--', lt)) {
      const end = template.indexOf('-->', lt + 4)
      i = end < 0 ? template.length : end + 3
      continue
    }
    const first = template[lt + 1]
    if (first === '!' || first === '?') {
      const end = template.indexOf('>', lt)
      i = end < 0 ? template.length : end + 1
      continue
    }
    const isClosing = first === '/'
    let cursor = lt + (isClosing ? 2 : 1)
    const nameMatch = /^[A-Za-z][\w-]*/.exec(template.slice(cursor))
    if (!nameMatch) {
      i = lt + 1
      continue
    }
    const name = nameMatch[0]
    cursor += name.length
    let quote = null
    let end = -1
    let selfClosing = false
    while (cursor < template.length) {
      const char = template[cursor]
      if (quote) {
        if (char === quote) quote = null
        cursor += 1
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        cursor += 1
        continue
      }
      if (char === '>') {
        let back = cursor - 1
        while (back > lt && /\s/.test(template[back])) back -= 1
        selfClosing = !isClosing && template[back] === '/'
        end = cursor
        break
      }
      cursor += 1
    }
    if (end < 0) {
      tokens.push({ kind: 'text', text: template.slice(lt), offset: lt })
      break
    }
    const rawAttrs = template.slice(lt + (isClosing ? 2 : 1) + name.length, end - (selfClosing ? 1 : 0))
    const attrs = {}
    const attrPattern = /([@A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    let attrMatch
    while ((attrMatch = attrPattern.exec(rawAttrs)) !== null) {
      attrs[attrMatch[1]] = attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4] !== undefined ? attrMatch[4] : attrMatch[5]
    }
    // 无值属性（如 static）
    const barePattern = /(?:^|\s)([A-Za-z_][\w:.-]*)(?=\s|$)/g
    let bareMatch
    const consumed = new Set(Object.keys(attrs))
    while ((bareMatch = barePattern.exec(rawAttrs.replace(/([@A-Za-z_][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/g, ' '))) !== null) {
      const key = bareMatch[1]
      if (!consumed.has(key)) attrs[key] = ''
    }
    tokens.push({
      kind: isClosing ? 'close' : 'open',
      name,
      attrs,
      selfClosing,
      line: lineAt(template, lt),
      offset: lt,
    })
    i = end + 1
  }
  flushText(i)
  return tokens
}

function buildTemplateTree(tokens) {
  const root = { name: '#root', attrs: {}, children: [], text: '', selfClosing: false, line: 0 }
  const stack = [root]
  for (const token of tokens) {
    if (token.kind === 'text') {
      stack[stack.length - 1].text += token.text
      continue
    }
    if (token.kind === 'open') {
      const node = { name: token.name, attrs: token.attrs, children: [], text: '', selfClosing: token.selfClosing, line: token.line }
      stack[stack.length - 1].children.push(node)
      if (!token.selfClosing) stack.push(node)
      continue
    }
    // close
    const top = stack[stack.length - 1]
    if (top.name === token.name) stack.pop()
    else {
      const found = stack.map((n) => n.name).lastIndexOf(token.name)
      if (found > 0) stack.length = found
      else stack[stack.length - 1].strayClose = token.name
    }
  }
  return root
}

function walkTree(node, visit) {
  visit(node)
  for (const child of node.children) walkTree(child, visit)
}

function flattenTree(node, out = []) {
  out.push(node)
  for (const child of node.children) flattenTree(child, out)
  return out
}

function attrOf(node, name) {
  return Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : undefined
}

function classListOf(node) {
  const value = attrOf(node, 'class')
  if (!value || value.indexOf('{{') >= 0) return []
  return value.split(/\s+/).filter(Boolean)
}

function pxValueToNumber(value) {
  if (value === undefined) return null
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value).trim())
  return match ? Number(match[1]) : null
}

// ---------------------------------------------------------------- 主逻辑
const layoutModule = await (async () => {
  const source = readText(path.join(SRC, 'common', 'layout.js'))
  const encoded = Buffer.from(source, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
})()
const LAYOUT = layoutModule

const globalErrors = []
const globalWarnings = []
const pageReports = []

function gErr(message) {
  globalErrors.push(message)
}
function gWarn(message) {
  globalWarnings.push(message)
}

const manifest = JSON.parse(readText(MANIFEST_FILE))
const manifestFeatures = new Set((manifest.features || []).map((item) => (item && item.name) || '').filter(Boolean))
const manifestPages = (manifest.router && manifest.router.pages) || {}
const manifestEntry = (manifest.router && manifest.router.entry) || ''
const versionName = manifest.versionName

// ---------------------------------------------------------------- A. manifest 路由 ↔ 页面目录
function checkManifestRouter() {
  if (!manifestEntry) gErr('manifest.router.entry 缺失')
  else if (!manifestPages[manifestEntry]) gErr(`manifest.router.entry="${manifestEntry}" 未在 router.pages 里注册`)
  const dirs = fs.existsSync(PAGES_DIR)
    ? fs.readdirSync(PAGES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []
  const registeredShort = Object.keys(manifestPages).map((key) => key.replace(/^pages\//, ''))
  for (const dir of dirs) {
    if (!registeredShort.includes(dir)) gErr(`src/pages/${dir} 目录存在但未在 manifest.router.pages 注册`)
    if (!fs.existsSync(path.join(PAGES_DIR, dir, 'index.ux'))) gErr(`src/pages/${dir}/index.ux 不存在（component=index）`)
  }
  for (const key of Object.keys(manifestPages)) {
    if (!dirs.includes(key.replace(/^pages\//, ''))) {
      globalWarnings.push(`manifest 注册了 ${key} 但 src/pages 下还没有对应目录（页面未实现，稍后补跑）`)
    }
  }
  for (const expected of EXPECTED_PAGES) {
    const short = expected.replace(/^pages\//, '')
    const dirExists = dirs.includes(short)
    if (!dirExists) globalWarnings.push(`页面 ${expected} 未实现（目录不存在，稍后补跑）`)
  }
}
checkManifestRouter()

// ---------------------------------------------------------------- G. features 声明
function checkFeatures() {
  for (const feature of REQUIRED_FEATURES) {
    if (!manifestFeatures.has(feature)) gErr(`manifest.features 缺少必需能力：${feature}`)
  }
  const used = new Map() // module -> [files]
  function walkSrc(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'assets') continue
        walkSrc(full)
      } else if (/\.(?:js|mjs|ux)$/i.test(entry.name)) {
        const text = readText(full)
        const pattern = /from\s+['"](@blueos\.[\w.]+)['"]|import\s+['"](@blueos\.[\w.]+)['"]/g
        let m
        while ((m = pattern.exec(text)) !== null) {
          const moduleId = m[1] || m[2]
          if (!used.has(moduleId)) used.set(moduleId, [])
          used.get(moduleId).push(path.relative(ROOT, full).replace(/\\/g, '/'))
        }
      }
    }
  }
  walkSrc(SRC)
  for (const [moduleId, files] of used) {
    const need = FEATURE_ALIAS[moduleId] || moduleId.replace(/^@/, '')
    if (!manifestFeatures.has(need)) {
      gErr(`代码使用 ${moduleId}（${files.join(', ')}）但 manifest.features 未声明 "${need}"`)
    }
  }
}
checkFeatures()

// ---------------------------------------------------------------- 单页校验
function checkPage(pageName) {
  const short = pageName.replace(/^pages\//, '')
  const file = path.join(PAGES_DIR, short, 'index.ux')
  const report = { page: pageName, file: path.relative(ROOT, file).replace(/\\/g, '/'), present: fs.existsSync(file), errors: [], warnings: [] }
  pageReports.push(report)
  if (!report.present) {
    report.status = '未实现'
    return report
  }
  const e = (message) => report.errors.push(message)
  const w = (message) => report.warnings.push(message)
  const text = readText(file)
  const isGame = pageName === 'pages/Game'

  // ---- A. 三段式
  const scriptBlock = extractBlock(text, 'script')
  const templateBlock = extractBlock(text, 'template')
  const styleBlock = extractBlock(text, 'style')
  if (!scriptBlock) e('缺少 <script> 块')
  if (!templateBlock) e('缺少 <template> 块')
  if (!styleBlock) e('缺少 <style> 块')
  if (scriptBlock && !scriptBlock.closed) e('<script> 未闭合')
  if (templateBlock && !templateBlock.closed) e('<template> 未闭合')
  if (styleBlock && !styleBlock.closed) e('<style> 未闭合')
  if (scriptBlock && templateBlock && styleBlock) {
    if (!(scriptBlock.contentOffset < templateBlock.contentOffset && templateBlock.contentOffset < styleBlock.contentOffset)) {
      e('三段顺序必须是 script → template → style')
    }
  }
  const surface = stripCommentsAndStrings(text)
  if (surface.indexOf('@system.') >= 0) e('出现 @system.*（Vela 残留），必须改用 @blueos.*')
  if (/(?:@|\b)onswipe\b|@swipe\b/.test(surface)) e('出现 onswipe/@swipe（BlueOS 不支持滑动事件）')

  const script = scriptBlock ? scriptBlock.content : ''
  const template = templateBlock ? templateBlock.content : ''
  const style = styleBlock ? styleBlock.content : ''
  const { rules: cssRules, atRules } = parseCss(style)

  // ---- 模板树
  const tokens = tokenizeTemplate(template)
  const root = buildTemplateTree(tokens)
  if (root.children.length === 0) e('template 没有根节点')
  if (root.children.length > 1) e(`template 必须只有一个根节点（实际 ${root.children.length} 个）`)
  const allNodes = flattenTree(root)
  for (const node of allNodes) {
    if (node.strayClose) e(`模板标签不配平：多余的 </${node.strayClose}>（第 ${node.line} 行附近）`)
  }
  // 标签闭合检查（未弹出的 open）
  const unclosed = []
  const stack = []
  for (const token of tokens) {
    if (token.kind === 'open') {
      if (!token.selfClosing) stack.push(token)
    } else if (token.kind === 'close') {
      const idx = stack.map((t) => t.name).lastIndexOf(token.name)
      if (idx >= 0) stack.length = idx
      else e(`模板标签不配平：多余的 </${token.name}>（第 ${token.line} 行）`)
    }
  }
  stack.forEach((token) => unclosed.push(token.name))
  if (unclosed.length) e(`模板标签未闭合：${Array.from(new Set(unclosed)).join(', ')}`)

  const scriptCode = stripCommentsAndStrings(script)
  const methodNames = new Set()
  {
    const pattern = /\b([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g
    let m
    while ((m = pattern.exec(scriptCode)) !== null) methodNames.add(m[1])
  }
  const functionNames = new Set()
  {
    const pattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g
    let m
    while ((m = pattern.exec(scriptCode)) !== null) functionNames.add(m[1])
  }

  // ---- C. 模板级规则
  for (const node of allNodes) {
    if (node === root) continue
    if (FORBIDDEN_TAGS.includes(node.name)) {
      e(`使用了禁止组件 <${node.name}>（第 ${node.line} 行）`)
    }
    // 事件
    for (const [attrName, attrValue] of Object.entries(node.attrs)) {
      if (!attrName.startsWith('@')) continue
      const eventName = attrName.slice(1).split('.')[0]
      if (!ALLOWED_EVENTS.has(eventName)) {
        e(`不允许的事件 @${eventName}（第 ${node.line} 行）；允许：${Array.from(ALLOWED_EVENTS).join('/')}`)
        continue
      }
      if (node.name === 'image') e(`<image> 不能绑定事件 @${eventName}（第 ${node.line} 行）；请套手势层 div`)
      const base = String(attrValue).split('(')[0].trim()
      if (base && !methodNames.has(base) && !functionNames.has(base)) {
        e(`事件 @${eventName} 引用的方法 ${base} 在 <script> 中不存在（第 ${node.line} 行）`)
      }
    }
    // 裸属性事件（onswipe 等）
    for (const attrName of Object.keys(node.attrs)) {
      if (/^on[a-z]+$/.test(attrName) && ['onclick', 'onlongpress', 'onchange'].indexOf(attrName) < 0) {
        e(`不允许的旧式事件属性 ${attrName}（第 ${node.line} 行）；请用 @click 等`)
      }
    }
    // list / list-item
    if (node.name === 'list') {
      for (const child of node.children) {
        if (child.name !== 'list-item') e(`<list> 的直接子节点只能是 <list-item>，发现 <${child.name}>（第 ${child.line} 行）`)
      }
    }
    if (node.name === 'list-item') {
      if (!attrOf(node, 'type')) e(`<list-item> 必须有 type 属性（第 ${node.line} 行）`)
    }
    if (node.name === 'slider' && attrOf(node, 'step') !== undefined) e('<slider> 不支持 step（第 ' + node.line + ' 行）')
    // scroll 不支持 margin/padding（通过 class 规则检查，见 CSS 部分）
    // image 静态 src 文件存在
    if (node.name === 'image') {
      const src = attrOf(node, 'src')
      if (src && src.indexOf('{{') < 0) {
        if (src.charAt(0) === '/') {
          const target = path.join(SRC, src.replace(/^\//, '').replace(/\//g, path.sep))
          if (!fs.existsSync(target)) e(`<image> src 文件不存在：${src}（第 ${node.line} 行）`)
        } else {
          w(`<image> src 不是包内绝对路径：${src}（第 ${node.line} 行）`)
        }
      }
      if (attrOf(node, 'static') !== undefined) e(`<image> 不得使用 static 属性（第 ${node.line} 行）`)
      const dynamicStyle = attrOf(node, 'style')
      const widthAttr = attrOf(node, 'width')
      const heightAttr = attrOf(node, 'height')
      const classes = classListOf(node)
      const dynamicClass = String(attrOf(node, 'class') || '').indexOf('{{') >= 0
      const decls = {}
      for (const cls of classes) {
        const rule = cssRules.find((item) => item.selector === `.${cls}`)
        if (rule) Object.assign(decls, rule.decls)
      }
      const hasWidth = widthAttr !== undefined || decls.width !== undefined
      const hasHeight = heightAttr !== undefined || decls.height !== undefined
      const hasFit = decls['object-fit'] !== undefined
      if (dynamicClass) {
        w(`<image> 使用动态 class（第 ${node.line} 行），宽高/object-fit 无法静态核对，人工复核`)
      } else if (dynamicStyle && dynamicStyle.indexOf('{{') >= 0) {
        // 动态 style 无法静态核对宽高；只要求 object-fit 显式（或 style 里带 object-fit）
        if (!hasFit && !/object-fit/.test(dynamicStyle)) w(`<image> 使用动态 style，object-fit 未显式声明（第 ${node.line} 行，人工复核）`)
      } else {
        if (!hasWidth || !hasHeight) e(`<image> 必须显式写宽高（第 ${node.line} 行，class=${classes.join('.') || '(无)'}）`)
        if (!hasFit) e(`<image> 必须显式写 object-fit（第 ${node.line} 行）；封面用 cover / 立绘用 contain / 原图用 fill`)
      }
    }
  }

  // ---- D. 脚本级规则
  if (scriptCode.indexOf('@system.') >= 0) e('脚本出现 @system.*')
  if (/\b(private|protected|public)\s*:/.test(scriptCode)) e('出现 private:/protected:/public:（Vela 概念，BlueOS 用 data 声明）')
  if (/\brequire\s*\(/.test(scriptCode)) e('不支持 require()')
  if (/\bimport\s*\(/.test(scriptCode)) e('不支持动态 import()')
  // imports
  const importPattern = /import\s+(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g
  const imports = []
  let importMatch
  while ((importMatch = importPattern.exec(scriptCode)) !== null) {
    imports.push({ moduleId: importMatch[1], index: importMatch.index })
  }
  const scriptTop = scriptCode.search(/export\s+default|^\s*(?:const|let|var|function)\s/m)
  for (const item of imports) {
    const moduleId = item.moduleId
    if (moduleId.startsWith('@blueos.')) {
      if (scriptTop >= 0 && item.index > scriptTop) e(`@blueos 模块 import 必须在 <script> 顶部：${moduleId}`)
      continue
    }
    if (!moduleId.startsWith('.')) {
      e(`本地模块 import 必须是相对路径（发现 ${moduleId}）；不支持 Node/第三方模块`)
      continue
    }
    if (!/\.js$/.test(moduleId)) {
      e(`本地模块 import 必须带 .js 后缀：${moduleId}`)
      continue
    }
    const target = path.resolve(path.dirname(file), moduleId)
    if (!fs.existsSync(target)) e(`import 的本地模块不存在：${moduleId}`)
  }
  // onInit 内直接调用 feature API
  const onInitMatch = /\bonInit\s*\([^)]*\)\s*\{/.exec(scriptCode)
  if (onInitMatch) {
    const block = readBalancedBlock(scriptCode, onInitMatch.index + onInitMatch[0].length - 1)
    const featureCall = /\b(storage|router|prompt|file|brightness|display)\s*\.|\$app\s*\./.exec(block.content)
    if (featureCall) e(`onInit 内不得直接调用 feature API（发现 ${featureCall[0].trim()}）；请放到 onReady 之后`)
  }
  // data 声明
  const dataMatch = /\bdata\s*:\s*\{/.exec(scriptCode)
  const dataKeys = new Set()
  if (!dataMatch) e('缺少 data: { ... } 声明（路由参数/响应式字段必须声明）')
  else {
    const block = readBalancedBlock(scriptCode, dataMatch.index + dataMatch[0].length - 1)
    const keyPattern = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g
    let keyMatch
    while ((keyMatch = keyPattern.exec(block.content)) !== null) dataKeys.add(keyMatch[1])
    for (const key of dataKeys) {
      if (key.charAt(0) === '$' || key.charAt(0) === '_') e(`data 字段名不能以 $ 或 _ 开头：${key}`)
      if (['for', 'if', 'show', 'tid'].indexOf(key) >= 0) e(`data 字段名不能使用保留字：${key}`)
    }
    const routeParams = ['at', 'load', 'auto', 'mode', 'slot']
    for (const param of routeParams) {
      if (new RegExp(`this\\.${param}\\s*=`).test(scriptCode) && !dataKeys.has(param)) {
        e(`路由参数 ${param} 被赋值但未在 data 中声明`)
      }
    }
    // this.X = 赋值但未声明的响应式字段（warning，常见响应式坑）
    const assignPattern = /\bthis\.([A-Za-z_$][\w$]*)\s*=/g
    let assignMatch
    while ((assignMatch = assignPattern.exec(scriptCode)) !== null) {
      const name = assignMatch[1]
      if (!dataKeys.has(name) && name.charAt(0) !== '$') {
        w(`this.${name} = ... 未在 data 声明（非响应式；模板绑定不会更新，PORT-SPEC §0.3）`)
      }
    }
  }
  // 模板绑定字段必须在 data 声明
  if (dataKeys.size) {
    const reportedBinding = new Set()
    const bindingPattern = /\{\{([^}]+)\}\}/g
    let bindingMatch
    while ((bindingMatch = bindingPattern.exec(template)) !== null) {
      const expression = bindingMatch[1]
      const identifierPattern = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g
      let idMatch
      while ((idMatch = identifierPattern.exec(expression)) !== null) {
        const name = idMatch[2]
        if (CONTEXT_KEYS.has(name)) continue
        if (/^(true|false|null|undefined|if|for|else|item|idx)$/.test(name)) continue
        const after = expression.slice(idMatch.index + idMatch[0].length).trimStart()
        if (after.startsWith('(')) continue // 方法调用
        if (!dataKeys.has(name) && !methodNames.has(name) && !reportedBinding.has(name)) {
          reportedBinding.add(name)
          e(`模板绑定的 ${name} 未在 data 中声明（第 ${lineAt(template, bindingMatch.index)} 行附近）`)
        }
      }
    }
  }

  // ---- E. 样式规则
  for (const atRule of atRules) {
    if (/@import\b/.test(atRule.prelude)) e('样式禁止 @import')
    if (/@media\s*\(\s*shape\s*:/.test(atRule.prelude)) e('禁止 @media (shape:)（BlueOS 不支持，用 device: watch-square 或运行时 deviceType）')
    if (/@media\s*\(\s*device\s*:/.test(atRule.prelude)) w('使用 @media (device: ...)：编译期折叠，仅在确有必要时使用')
    if (/@supports\b/.test(atRule.prelude)) e('样式禁止 @supports')
  }
  if (/lang\s*=\s*["']scss["']/.test(text)) e('<style> 禁止 lang="scss"')
  if (/(^|[\s{;])\$[A-Za-z_][\w-]*\s*:/.test(style)) e('样式出现 SCSS 变量（$var）')
  const styleRuleBySelector = new Map(cssRules.map((rule) => [rule.selector, rule]))
  for (const rule of cssRules) {
    const decls = rule.decls
    if (rule.selector.indexOf('#') >= 0) w(`样式使用 #id 选择器（${rule.selector}）：规范要求只用 class`)
    if (/[\s>+~]\s*[.A-Za-z]/.test(rule.selector) && !/:|,|\[/.test(rule.selector)) {
      w(`样式使用后代/组合选择器（${rule.selector}）：性能规范建议只用单 class`)
    }
    if (decls.position) {
      if (/^relative$/i.test(decls.position)) {
        e(`${rule.selector} 使用 position: relative（平台不支持且子树可能不渲染）`)
      } else if (!/^(absolute|fixed)$/i.test(decls.position)) {
        e(`${rule.selector} 使用不支持的 position: ${decls.position}`)
      }
    }
    if (decls.overflow !== undefined) e(`${rule.selector} 使用 overflow（平台不支持）`)
    if (decls['z-index'] !== undefined) e(`${rule.selector} 使用 z-index（平台不支持）`)
    if (decls['box-shadow'] !== undefined) e(`${rule.selector} 使用 box-shadow（平台不支持）`)
    if (decls.filter !== undefined) e(`${rule.selector} 使用 filter（平台不支持）`)
    if (decls['border-radius'] !== undefined && /[\s/]/.test(decls['border-radius'].trim().replace(/^0$/, ''))) {
      if (!/^\d+(?:\.\d+)?px$/.test(decls['border-radius'].trim()) && !/^\d+(?:\.\d+)?%$/.test(decls['border-radius'].trim())) {
        e(`${rule.selector} border-radius 只支持单值：${decls['border-radius']}`)
      }
    }
    if (decls.top !== undefined && /^auto$/i.test(decls.top)) e(`${rule.selector} 使用 top: auto（平台会丢弃）`)
    if (decls.width !== undefined && /%$/.test(decls.width.trim())) e(`${rule.selector} 使用百分比宽度 ${decls.width}（实机会二次换算，必须显式 px）`)
    if (decls.flex !== undefined && /^\s*1(?:\s|$)/.test(decls.flex)) e(`${rule.selector} 使用 flex: 1（平台不支持）`)
    if (decls['flex-grow'] !== undefined && Number(decls['flex-grow']) > 0) e(`${rule.selector} 使用 flex-grow > 0（用固定 px 布局）`)
    if (decls.opacity !== undefined && Number(decls.opacity) < 1) {
      const cls = rule.selector.replace(/^\./, '')
      const users = allNodes.filter((node) => classListOf(node).indexOf(cls) >= 0)
      if (users.length === 0) w(`opacity 规则 ${rule.selector} 没有对应元素`)
      for (const user of users) {
        if (user.name !== 'div' || (!user.selfClosing && (user.children.length > 0 || user.text.trim() !== ''))) {
          e(`${rule.selector} 使用 opacity 的元素必须是空 div（第 ${user.line} 行）；带子节点请用 rgba 背景色`)
        }
      }
    }
    // scroll 不支持 margin/padding
    const scrollUsers = allNodes.filter((node) => node.name === 'scroll' && classListOf(node).indexOf(rule.selector.replace(/^\./, '')) >= 0)
    if (scrollUsers.length) {
      for (const prop of Object.keys(decls)) {
        if (/^(padding|margin)(-|$)/.test(prop)) e(`${rule.selector} 用于 <scroll> 时不支持 ${prop}`)
      }
    }
  }
  // .page 宽度
  const pageRule = styleRuleBySelector.get('.page')
  if (!pageRule) e('缺少 .page 根节点样式')
  else {
    const width = pxValueToNumber(pageRule.decls.width)
    if (width !== 466) e(`.page 必须 width: 466px（实际 ${pageRule.decls.width || '未设置'}）`)
    if (pageRule.decls.height === undefined) w('.page 未设置 height（通常为 100%）')
  }

  // ---- F. Game 页几何常量与 layout.js 一致
  if (isGame) {
    const expectRule = (selector, expectations) => {
      const rule = styleRuleBySelector.get(selector)
      if (!rule) {
        e(`缺少几何规则 ${selector}（必须与 common/layout.js 一致）`)
        return
      }
      for (const [prop, expected] of Object.entries(expectations)) {
        const actual = pxValueToNumber(rule.decls[prop])
        if (actual === null) e(`${selector} 缺少 ${prop}（期望 ${expected}px）`)
        else if (actual !== expected) e(`${selector} ${prop}=${actual}px，期望 ${expected}px（layout.js）`)
      }
    }
    expectRule('.panel', { left: LAYOUT.PANEL.round.left, width: LAYOUT.PANEL.round.width, height: LAYOUT.PANEL.round.height, bottom: LAYOUT.PANEL.round.bottom, 'border-radius': LAYOUT.PANEL.round.radius })
    expectRule('.panel.square', { left: LAYOUT.PANEL.square.left, width: LAYOUT.PANEL.square.width, height: LAYOUT.PANEL.square.height, bottom: LAYOUT.PANEL.square.bottom, 'border-radius': LAYOUT.PANEL.square.radius })
    expectRule('.speaker', { left: LAYOUT.NAME.round.left, width: LAYOUT.NAME.round.width, height: LAYOUT.NAME.round.height, bottom: LAYOUT.NAME.round.bottom })
    expectRule('.speaker.square', { left: LAYOUT.NAME.square.left, width: LAYOUT.NAME.square.width, height: LAYOUT.NAME.square.height, bottom: LAYOUT.NAME.square.bottom })
    expectRule('.line', { left: LAYOUT.TEXT.round.left, width: LAYOUT.TEXT.round.width, height: LAYOUT.TEXT.round.height, bottom: LAYOUT.TEXT.round.bottom })
    expectRule('.line.square', { left: LAYOUT.TEXT.square.left, width: LAYOUT.TEXT.square.width, bottom: LAYOUT.TEXT.square.bottom })
    expectRule('.next-hint', { left: LAYOUT.NEXT_HINT.round.left, bottom: LAYOUT.NEXT_HINT.round.bottom })
    expectRule('.next-hint.square', { left: LAYOUT.NEXT_HINT.square.left, bottom: LAYOUT.NEXT_HINT.square.bottom })
    expectRule('.hud', { left: LAYOUT.HUD.round.left, top: LAYOUT.HUD.round.top, width: LAYOUT.HUD.round.width, height: LAYOUT.HUD.round.height })
    expectRule('.hud.square', { left: LAYOUT.HUD.square.left, top: LAYOUT.HUD.square.top, width: LAYOUT.HUD.square.width, height: LAYOUT.HUD.square.height })
    expectRule('.menu-fab', { left: LAYOUT.MENU_BTN.round.left, top: LAYOUT.MENU_BTN.round.top, width: LAYOUT.MENU_BTN.round.width, height: LAYOUT.MENU_BTN.round.height, 'border-radius': LAYOUT.MENU_BTN.round.radius })
    expectRule('.menu-fab.square', { left: LAYOUT.MENU_BTN.square.left, top: LAYOUT.MENU_BTN.square.top, width: LAYOUT.MENU_BTN.square.width, height: LAYOUT.MENU_BTN.square.height, 'border-radius': LAYOUT.MENU_BTN.square.radius })
    // 圆屏安全区：对白面板与正文块的四角、菜单按钮都必须在半径 215 的圆内
    const roundPanel = LAYOUT.PANEL.round
    const panelTop = LAYOUT.VIEWPORT.round - roundPanel.bottom - roundPanel.height
    for (const [label, x, y] of [
      ['正文块左上', LAYOUT.TEXT.round.left, LAYOUT.VIEWPORT.round - LAYOUT.TEXT.round.bottom - LAYOUT.TEXT.round.height],
      ['正文块右下', LAYOUT.TEXT.round.left + LAYOUT.TEXT.round.width, LAYOUT.VIEWPORT.round - LAYOUT.TEXT.round.bottom],
      ['面板上沿中心', LAYOUT.PANEL.round.left + roundPanel.width / 2, panelTop],
      ['菜单按钮右上', LAYOUT.MENU_BTN.round.left + LAYOUT.MENU_BTN.round.width, LAYOUT.MENU_BTN.round.top],
    ]) {
      const dx = x - 233
      const dy = y - 233
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 215) e(`${label} 超出圆屏安全半径 215（距离 ${dist.toFixed(1)}）`)
    }
    // 对白面板占屏高比例（圆屏）：超过 55% 会明显压住画面
    const panelRatio = roundPanel.height / LAYOUT.VIEWPORT.round
    if (panelRatio > 0.55) e(`对白面板占屏高 ${(panelRatio * 100).toFixed(0)}%（>55%），会压住画面`)
    // 顶部「≡」菜单按钮必须存在（真机反馈：没有菜单入口）
    if (!/menu-fab/.test(template)) e('Game 页缺少顶部「≡」阅读菜单按钮（class="menu-fab"）')
    if (!/menu-fab[\s\S]{0,120}?@click\s*=\s*"openMenu"/.test(template) && !/@click\s*=\s*"openMenu"[\s\S]{0,120}?menu-fab/.test(template)) {
      e('顶部「≡」菜单按钮必须绑定 @click="openMenu"')
    }
    expectRule('.sp', { width: LAYOUT.SPRITE.width, height: LAYOUT.SPRITE.height, bottom: 0 })
    expectRule('.sp-l', { left: LAYOUT.SPRITE.left })
    expectRule('.sp-c', { left: LAYOUT.SPRITE.center })
    expectRule('.sp-r', { left: LAYOUT.SPRITE.right })
  }

  // ---- H. About 版本号
  if (pageName === 'pages/About') {
    const m = /APP_VER\s*=\s*['"]([^'"]+)['"]/.exec(script)
    if (!m) e('About 页缺少 APP_VER 常量')
    else if (m[1] !== versionName) e(`About APP_VER=${m[1]} != manifest.versionName=${versionName}`)
  }

  report.status = report.errors.length === 0 ? 'PASS' : 'FAIL'
  return report
}

for (const pageName of EXPECTED_PAGES) {
  try {
    checkPage(pageName)
  } catch (error) {
    gErr(`页面 ${pageName} 校验异常（文件可能正在被并行编写）：${error && error.message ? error.message : error}`)
  }
}

// 未注册但存在的页面目录也校验一下（防止漏注册）
for (const entry of fs.readdirSync(PAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pageName = `pages/${entry.name}`
  if (!EXPECTED_PAGES.includes(pageName)) {
    try {
      checkPage(pageName)
    } catch (error) {
      gErr(`页面 ${pageName} 校验异常：${error && error.message ? error.message : error}`)
    }
  }
}

// ---------------------------------------------------------------- 输出
const presentPages = pageReports.filter((item) => item.present)
const missingPages = pageReports.filter((item) => !item.present)
const errorCount =
  globalErrors.length + pageReports.reduce((acc, item) => acc + item.errors.length, 0)
const warningCount =
  globalWarnings.length + pageReports.reduce((acc, item) => acc + item.warnings.length, 0)

const report = {
  tool: 'tools/validate-pages.mjs',
  generatedAt: new Date().toISOString(),
  manifest: { package: manifest.package, versionName, entry: manifestEntry, pages: Object.keys(manifestPages), features: Array.from(manifestFeatures) },
  pages: pageReports,
  globalErrors,
  globalWarnings,
  counts: { pages: pageReports.length, present: presentPages.length, missing: missingPages.length, errors: errorCount, warnings: warningCount },
  pass: errorCount === 0,
}

function printReport() {
  console.log('==== 页面静态校验 (tools/validate-pages.mjs) ====')
  console.log(
    `页面 ${presentPages.length}/${pageReports.length} 已实现` +
      (missingPages.length ? `；未实现：${missingPages.map((item) => item.page).join(', ')}` : '')
  )
  console.log(`manifest: package=${manifest.package} versionName=${versionName} features=${Array.from(manifestFeatures).join(',')}`)
  console.log('')
  for (const item of pageReports) {
    if (!item.present) {
      console.log(`  [未实现] ${item.page}`)
      continue
    }
    console.log(`  [${item.status}] ${item.page}  errors=${item.errors.length} warnings=${item.warnings.length}`)
    item.errors.forEach((message) => console.log(`      [error] ${message}`))
    if (process.argv.includes('--verbose')) item.warnings.forEach((message) => console.log(`      [warning] ${message}`))
  }
  if (globalErrors.length) {
    console.log('')
    console.log('全局错误：')
    globalErrors.forEach((message) => console.log(`  [error] ${message}`))
  }
  if (globalWarnings.length) {
    console.log('')
    console.log('全局警告：')
    globalWarnings.slice(0, 30).forEach((message) => console.log(`  [warning] ${message}`))
  }
  console.log('')
  console.log(`[validate-pages] 结果: ${report.pass ? 'PASS' : 'FAIL'}  pages=${presentPages.length}/${pageReports.length} errors=${errorCount} warnings=${warningCount}`)
}

printReport()
try {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'validate-pages.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`[validate-pages] JSON 报告: scripts/reports/validate-pages.json`)
} catch (error) {
  console.error(`[validate-pages] 写 JSON 报告失败：${error.message}`)
}
process.exit(report.pass ? 0 : 1)
