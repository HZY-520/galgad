#!/usr/bin/env node
/**
 * lint_timers.js —— 复现 BlueOS IDE 的 feature-api 定时器配对规则（离线可跑）。
 *
 * 移植自 galgaoshou/tools/lint-timers.js（规则逐字复刻 IDE 实现，未做任何放宽）：
 *   D:\BlueOSStudio\resources\app\extensions\blueos-language-features\server\dist\modes\script\hap\apiParser.js
 *     getTimerInfo(text, method)
 *   D:\BlueOSStudio\resources\app\extensions\blueos-language-features\server\dist\modes\script\hap\apiValidation.js
 *     validateClearTimer(document, text, result)
 *
 * 规则细节（与 IDE 完全一致，注意它只做字面 token 比较）：
 *   - 对每个 `setTimeout(...)`：正则 `(this\.\w+|\w+)?\s*=\s*(\w*.)?setTimeout|setTimeout\s*\(` 的捕获组 1 即 fn。
 *     因此 `st.typingTimer = setTimeout(...)` 解析出的 fn 是 `typingTimer`（丢了 `st.` 前缀）；
 *     而 `const timer = setTimeout(...)` 解析出的 fn 是 `timer`。
 *   - 对每个 `clearTimeout(...)`：正则 `clearTimeout\s*\(\s*([^)]+)\s*\)` 捕获参数整段，fn 为 `st.typingTimer` 之类原文。
 *   - 每个 setTimeout 必须在 clearTimeout 列表里找到 **fn 字符串完全相等** 的一项，否则 IDE 报
 *     feature-api Error「未正确使用 clearTimeout 关闭，请检查代码」。
 *   - setInterval / clearInterval 同规则（getTimerInfo 只对 set* 走赋值捕获）。
 *
 * 目标工程附加规则（PORT-SPEC §0.5）：
 *   - 页面脚本（src/pages/<Name>/index.ux 的 script 块）禁止直接出现 setTimeout/setInterval/
 *     clearTimeout/clearInterval —— 全部收口在 src/common/reader.js 的 armTimer/armInterval，
 *     页面直接写会命中 IDE feature-api 误报（字面 token 配对无法识别间接持有）。
 *
 * 用法：
 *   node tools/lint-timers.js                     # 扫 <项目根>/src 下所有 .ux 文件
 *   node tools/lint-timers.js --root .            # 指定工程根目录
 *   node tools/lint-timers.js --json out.json     # 指定 JSON 报告（默认 scripts/reports/lint-timers.json）
 *   node tools/lint-timers.js --src <dir>         # 扫指定目录（用于复跑基线快照）
 *   node tools/lint-timers.js --strict            # 额外的“clear 无对应 set”也记为 error
 *   node tools/lint-timers.js --ide <apiParser.js 路径>
 *   node tools/lint-timers.js --no-json           # 不写 JSON 报告
 *
 * 退出码：0 = 无 feature-api 定时器错误；1 = 有错误；2 = 用法/路径错误；3 = 加载 IDE apiParser 失败。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_IDE_PARSER =
  'D:/BlueOSStudio/resources/app/extensions/blueos-language-features/server/dist/modes/script/hap/apiParser.js'
const TIMER_PAIRS = [
  { method: 'setTimeout', clearMethod: 'clearTimeout' },
  { method: 'setInterval', clearMethod: 'clearInterval' },
]
const DIRECT_TIMER_PATTERN = /(?:^|[^\w.$])(setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/g

function parseArgs(argv) {
  const opts = {
    root: PROJECT_ROOT,
    src: null,
    json: null,
    noJson: false,
    ide: DEFAULT_IDE_PARSER,
    strict: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') opts.root = path.resolve(argv[++i])
    else if (arg === '--src') opts.src = path.resolve(argv[++i])
    else if (arg === '--json') opts.json = path.resolve(argv[++i])
    else if (arg === '--no-json') opts.noJson = true
    else if (arg === '--ide') opts.ide = path.resolve(argv[++i])
    else if (arg === '--strict') opts.strict = true
    else if (arg === '-h' || arg === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/\n')[0].replace(/^\/\*\*?\n?/, ''))
      process.exit(0)
    } else {
      console.error(`[lint_timers] 未知参数: ${arg}`)
      process.exit(2)
    }
  }
  if (!opts.json && !opts.noJson) opts.json = path.join(opts.root, 'scripts', 'reports', 'lint-timers.json')
  return opts
}

/** 递归收集目录下所有 .ux 文件（排序，保证输出稳定） */
function walkUx(dir, out) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'dist') continue
      walkUx(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.ux')) {
      out.push(full)
    }
  }
  return out
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

/** 把字符串/注释内容替换成空格（保留换行与长度），避免注释里的 setTimeout 误报 */
function stripStringsAndComments(text) {
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

/** 抽 <script> 内容（页面策略规则只看脚本，避免模板/样式误报） */
function extractScript(text) {
  const open = /<script\b[^>]*>/i.exec(text)
  if (!open) return ''
  const rest = text.slice(open.index + open[0].length)
  const close = /<\/script\s*>/i.exec(rest)
  return close ? rest.slice(0, close.index) : rest
}

function loadApiParser(ideParserPath) {
  if (!fs.existsSync(ideParserPath)) {
    console.error(
      `[lint_timers] 找不到 IDE 的 apiParser.js: ${ideParserPath}\n` +
        '  请用 --ide <path> 指定 BlueOS Studio 安装目录下的 apiParser.js。'
    )
    process.exit(3)
  }
  try {
    return require(ideParserPath)
  } catch (error) {
    console.error(`[lint_timers] 加载 apiParser 失败: ${error.message}`)
    process.exit(3)
  }
}

function scanFile(apiParser, file, strict) {
  const text = fs.readFileSync(file, 'utf8')
  const errors = []
  const warnings = []
  const stats = {}
  for (const pair of TIMER_PAIRS) {
    const setCalls = apiParser.getTimerInfo(text, pair.method)
    const clearCalls = apiParser.getTimerInfo(text, pair.clearMethod)
    stats[pair.method] = setCalls.length
    stats[pair.clearMethod] = clearCalls.length
    for (const call of setCalls) {
      const matched = clearCalls.some((clearCall) => clearCall.fn === call.fn)
      if (!matched) {
        errors.push({
          kind: 'feature-api',
          method: pair.method,
          clearMethod: pair.clearMethod,
          fn: call.fn,
          line: lineOf(text, call.start),
          snippet: text.slice(call.start, call.end).trim(),
          message: `未正确使用 ${pair.clearMethod} 关闭，请检查代码（fn=${JSON.stringify(call.fn)}）`,
        })
      }
    }
    for (const clearCall of clearCalls) {
      const matched = setCalls.some((call) => call.fn === clearCall.fn)
      if (!matched) {
        const item = {
          kind: 'orphan-clear',
          method: pair.clearMethod,
          fn: clearCall.fn,
          line: lineOf(text, clearCall.start),
          snippet: text.slice(clearCall.start, clearCall.end).trim(),
          message: `${pair.clearMethod} 找不到 fn 相同的 ${pair.method}（IDE 不报此错，仅提示）`,
        }
        if (strict) errors.push(item)
        else warnings.push(item)
      }
    }
  }

  // 目标工程附加规则：页面脚本禁止直接使用定时器（必须走 reader 的 armTimer/armInterval）
  const script = stripStringsAndComments(extractScript(text))
  let match
  DIRECT_TIMER_PATTERN.lastIndex = 0
  while ((match = DIRECT_TIMER_PATTERN.exec(script)) !== null) {
    const line = lineOf(script, match.index) + lineOf(text, text.indexOf('<script'))
    errors.push({
      kind: 'page-timer-direct',
      method: match[1],
      fn: '(direct)',
      line,
      snippet: script.slice(match.index, script.indexOf('\n', match.index) < 0 ? script.length : script.indexOf('\n', match.index)).trim(),
      message: `页面脚本禁止直接调用 ${match[1]}，请改用 common/reader.js 的 armTimer/disarmTimer/armInterval/disarmInterval（PORT-SPEC §0.5）`,
    })
  }
  return { file, stats, errors, warnings }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const apiParser = loadApiParser(opts.ide)
  const scanRoot = opts.src || path.join(opts.root, 'src')
  const files = walkUx(scanRoot, [])
  if (files.length === 0) {
    console.error(`[lint_timers] 没有找到 .ux 文件: ${scanRoot}`)
    process.exit(2)
  }

  const results = files.map((file) => scanFile(apiParser, file, opts.strict))
  const errors = results.flatMap((r) => r.errors.map((e) => Object.assign({ file: r.file }, e)))
  const warnings = results.flatMap((r) => r.warnings.map((w) => Object.assign({ file: r.file }, w)))
  const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/')

  console.log(`[lint_timers] IDE 规则: ${rel(opts.ide)} -> validateClearTimer`)
  console.log(`[lint_timers] 扫描: ${rel(scanRoot)}  共 ${files.length} 个 .ux 文件`)
  for (const r of results) {
    if (!r.errors.length && !r.warnings.length) continue
    console.log('')
    console.log(rel(r.file))
    for (const e of r.errors) {
      console.log(`  ${rel(r.file)}:${e.line}  [${e.kind}] ${e.method} ${e.message}  << ${e.snippet} >>`)
    }
    for (const w of r.warnings) {
      console.log(`  ${rel(r.file)}:${w.line}  [warning] ${w.method} ${w.message}  << ${w.snippet} >>`)
    }
  }
  const fileStats = results.reduce((acc, r) => {
    for (const [k, v] of Object.entries(r.stats)) acc[k] = (acc[k] || 0) + v
    return acc
  }, {})
  console.log('')
  console.log(
    `[lint_timers] 调用统计: ` +
      TIMER_PAIRS.map((p) => `${p.method}=${fileStats[p.method] || 0}/${p.clearMethod}=${fileStats[p.clearMethod] || 0}`).join(
        '  '
      )
  )
  const pass = errors.length === 0
  console.log(`[lint_timers] 结果: ${pass ? 'PASS' : 'FAIL'}  errors=${errors.length} warnings=${warnings.length}`)

  const report = {
    tool: 'tools/lint-timers.js',
    rule: 'BlueOS IDE feature-api validateClearTimer (apiParser.getTimerInfo token pairing) + 页面禁用直接定时器',
    ideParser: opts.ide,
    scannedRoot: scanRoot,
    filesScanned: files.length,
    callStats: fileStats,
    errors,
    warnings,
    pass,
    generatedAt: new Date().toISOString(),
  }
  if (opts.json) {
    fs.mkdirSync(path.dirname(opts.json), { recursive: true })
    fs.writeFileSync(opts.json, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[lint_timers] JSON 报告: ${rel(opts.json)}`)
  }
  process.exit(pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { scanFile, walkUx }
