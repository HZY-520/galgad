#!/usr/bin/env node
/**
 * 阅读器分页 / 设置逻辑测试（tools/test-reader.mjs）
 *
 * 在 Node 里加载 src/common/reader.js 的纯函数（临时 ESM 目录 + storage stub），
 * 对**全部 5457 句台词 × 字号 14~30（17 档）× 圆屏/方屏（2 种）**跑分页不变量：
 *   1. 不丢字：pages 展平后按行 join === 原文去掉换行符；
 *   2. 每行长度 ≤ charsPerLine；
 *   3. 每页行数 ≤ min(MAX_LINES, linesPerPage)；
 *   4. 行宽估算（line.length × fontSize）≤ 文本框宽；
 *   5. pages > 0；
 * 再测：
 *   - paginationMetrics 边界（字号夹取、行高/每行字数/每页行数、圆方屏文本框宽高）；
 *   - normalizeSettings 默认值/越界/非法值/老存档兼容（keepOn 缺省 true、fast 不持久化）；
 *   - autoDelay 边界（1.2s~12s 夹取、空白不计、未定义文本）；
 *   - longpressMode 归一化；wrapText 标点断行；paginateText 分页分组。
 *
 * 用法: node tools/test-reader.mjs [--json <file>]
 * 退出码: 0 = 全 PASS；1 = 有失败。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const STORY_DIR = path.join(SRC, 'common', 'story')
const REPORT_DIR = path.join(ROOT, 'scripts', 'reports')

const failures = []
const checks = []
const stats = {}

function fail(message) {
  failures.push(message)
}

function check(name, fn) {
  const before = failures.length
  try {
    const detail = fn()
    checks.push({ name, pass: failures.length === before, detail: detail === undefined ? '' : String(detail) })
  } catch (error) {
    fail(`${name} 异常：${error && error.stack ? error.stack.split('\n')[0] : error}`)
    checks.push({ name, pass: false, detail: 'throw' })
  }
}

function assert(condition, message) {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------- 临时 ESM 工程
function prepareTempModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galgad-reader-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  const layoutSource = fs.readFileSync(path.join(SRC, 'common', 'layout.js'), 'utf8')
  fs.writeFileSync(path.join(dir, 'layout.mjs'), layoutSource, 'utf8')
  let readerSource = fs.readFileSync(path.join(SRC, 'common', 'reader.js'), 'utf8')
  readerSource = readerSource.replace("from '@blueos.storage.storage'", "from './storage-stub.mjs'").replace("'./layout.js'", "'./layout.mjs'")
  fs.writeFileSync(path.join(dir, 'reader.mjs'), readerSource, 'utf8')
  fs.writeFileSync(
    path.join(dir, 'storage-stub.mjs'),
    [
      'export const state = { map: new Map() }',
      'export default {',
      '  get(options) {',
      '    const { key, default: dflt, success, fail: failCb } = options || {}',
      '    if (state.map.has(key)) { if (success) success(state.map.get(key)); return }',
      '    if (dflt !== undefined) { if (success) success(dflt); return }',
      '    if (failCb) failCb({}, 404)',
      '  },',
      '  set(options) {',
      '    const { key, value, success } = options || {}',
      '    state.map.set(key, value)',
      '    if (success) success()',
      '  },',
      '}',
    ].join('\n'),
    'utf8'
  )
  return dir
}

const tempDir = prepareTempModules()
const reader = await import(pathToFileURL(path.join(tempDir, 'reader.mjs')).href)
const layout = await import(pathToFileURL(path.join(tempDir, 'layout.mjs')).href)

// 读全部剧本台词（say 节点 x）
const index = JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'index.json'), 'utf8'))
const sentences = []
for (const chunk of index.chunks) {
  const nodes = JSON.parse(fs.readFileSync(path.join(STORY_DIR, path.basename(chunk.file)), 'utf8'))
  for (const node of nodes) {
    if (node.t === 's' && typeof node.x === 'string') sentences.push({ pc: chunk.start + nodes.indexOf(node), text: node.x })
  }
}
stats.sentenceCount = sentences.length
assert(sentences.length === 5457, `台词句数 ${sentences.length}，期望 5457`)

// ---------------------------------------------------------------- 1. paginationMetrics
check('paginationMetrics 边界（字号 14-30 / 圆方屏）', () => {
  for (const shape of ['round', 'square']) {
    const box = shape === 'square' ? layout.TEXT.square : layout.TEXT.round
    for (let size = 14; size <= 30; size += 1) {
      const m = layout.paginationMetrics(size, shape)
      assert(m.shape === shape, `paginationMetrics(${size},${shape}).shape 异常`)
      assert(m.fontSize === size, `fontSize 应=${size}`)
      assert(m.lineHeight === layout.lineHeightOf(size), `lineHeight 应=lineHeightOf(${size})=${layout.lineHeightOf(size)}，实际 ${m.lineHeight}`)
      assert(m.charsPerLine === Math.max(4, Math.floor((box.width - 12) / size)), `charsPerLine 公式异常（${size}/${shape}: ${m.charsPerLine}）`)
      assert(m.linesPerPage === Math.max(1, Math.min(layout.MAX_LINES, Math.floor(box.height / m.lineHeight))), `linesPerPage 公式异常（${size}/${shape}: ${m.linesPerPage}）`)
      assert(m.linesPerPage >= 1 && m.linesPerPage <= layout.MAX_LINES, `linesPerPage 越界: ${m.linesPerPage}`)
      assert(m.textWidth === box.width && m.textHeight === box.height, 'textWidth/textHeight 应与 layout TEXT 一致')
      assert(m.charsPerLine >= 4, `charsPerLine 应 >=4，实际 ${m.charsPerLine}`)
    }
  }
  // 越界字号夹取
  assert(layout.paginationMetrics(1, 'round').fontSize === layout.SIZE_MIN, '字号过小应夹到 SIZE_MIN')
  assert(layout.paginationMetrics(99, 'round').fontSize === layout.SIZE_MAX, '字号过大应夹到 SIZE_MAX')
  assert(layout.paginationMetrics(20, 'weird').shape === 'round', '未知 shape 应归一为 round')
  assert(layout.detectShape({ deviceType: 'watch-square' }) === 'square', 'detectShape watch-square 异常')
  assert(layout.detectShape({ deviceType: 'watch-round' }) === 'round', 'detectShape watch-round 异常')
  assert(layout.detectShape(null) === 'round', 'detectShape 空设备应保守 round')
  assert(layout.viewportHeight('square') === layout.VIEWPORT.square && layout.viewportHeight('round') === layout.VIEWPORT.round, 'viewportHeight 异常')
  return 'ok'
})

// ---------------------------------------------------------------- 2. readerLayout 自适应
check('readerLayout 自适应（行数×行高 = 渲染框高，且不超可用高度 / 圆屏安全圆）', () => {
  for (const shape of ['round', 'square']) {
    for (let size = layout.SIZE_MIN; size <= layout.SIZE_MAX; size += 1) {
      const g = layout.readerLayout(size, shape)
      const m = layout.paginationMetrics(size, shape)
      assert(g.linesPerPage === m.linesPerPage, `${shape}/${size}：readerLayout 与 paginationMetrics 行数不一致`)
      assert(g.textHeight === g.linesPerPage * g.lineHeight,
        `${shape}/${size}：textHeight=${g.textHeight} != 行数×行高=${g.linesPerPage * g.lineHeight}（会裁字）`)
      assert(g.textHeight <= g.textMaxHeight, `${shape}/${size}：textHeight=${g.textHeight} 超过可用 ${g.textMaxHeight}`)
      assert(g.panelHeight === g.padTop + g.textHeight + g.padBottom, `${shape}/${size}：面板高度与留白+正文不一致`)
      assert(new RegExp('lines: ' + g.linesPerPage + ';').test(g.lineStyle), `${shape}/${size}：行内 style 未带 lines`)
      assert(new RegExp('height: ' + g.textHeight + 'px').test(g.lineStyle), `${shape}/${size}：行内 style 未带正文高度`)
      assert(new RegExp('height: ' + g.panelHeight + 'px').test(g.panelStyle), `${shape}/${size}：面板 style 未带高度`)
      if (shape === 'round') {
        const vh = layout.VIEWPORT.round
        const textTop = vh - g.textBottom - g.textHeight
        for (const [x, y] of [
          [g.textLeft, textTop],
          [g.textLeft + g.textWidth, textTop],
          [g.textLeft, textTop + g.textHeight],
          [g.textLeft + g.textWidth, textTop + g.textHeight],
        ]) {
          const dist = Math.sqrt((x - 233) * (x - 233) + (y - 233) * (y - 233))
          assert(dist <= 215, `圆屏/${size}：正文块角距圆心 ${dist.toFixed(1)} > 215（会被圆边裁字）`)
        }
      }
    }
  }
  return 'ok'
})

// ---------------------------------------------------------------- 3. 全量分页不变量
check('全 5457 句 × 17 字号 × 圆/方屏分页不变量', () => {
  const shapes = ['round', 'square']
  const sizes = []
  for (let size = layout.SIZE_MIN; size <= layout.SIZE_MAX; size += 1) sizes.push(size)
  let paginations = 0
  let totalPages = 0
  let maxPages = 0
  const failureLimit = 20
  let failuresLocal = 0
  for (const shape of shapes) {
    for (const size of sizes) {
      const m = layout.paginationMetrics(size, shape)
      for (const sentence of sentences) {
        paginations += 1
        const pages = reader.paginateText(sentence.text, m.charsPerLine, m.linesPerPage)
        if (failuresLocal >= failureLimit) continue
        if (!Array.isArray(pages) || pages.length === 0) {
          fail(`[${shape}/${size}] pc=${sentence.pc} 分页结果为空`)
          failuresLocal += 1
          continue
        }
        const lines = []
        for (let pi = 0; pi < pages.length; pi += 1) {
          const page = pages[pi]
          if (!Array.isArray(page) || page.length === 0) {
            fail(`[${shape}/${size}] pc=${sentence.pc} 第 ${pi} 页为空`)
            failuresLocal += 1
            break
          }
          if (page.length > m.linesPerPage || page.length > layout.MAX_LINES) {
            fail(`[${shape}/${size}] pc=${sentence.pc} 第 ${pi} 页行数 ${page.length} > ${Math.min(m.linesPerPage, layout.MAX_LINES)}`)
            failuresLocal += 1
            break
          }
          for (const line of page) {
            lines.push(line)
            if (line.length > m.charsPerLine) {
              fail(`[${shape}/${size}] pc=${sentence.pc} 行长度 ${line.length} > cpl ${m.charsPerLine}: <<${line}>>`)
              failuresLocal += 1
            }
            if (line.length * m.fontSize > m.textWidth) {
              fail(`[${shape}/${size}] pc=${sentence.pc} 行宽估算 ${line.length * m.fontSize} > 文本框宽 ${m.textWidth}`)
              failuresLocal += 1
            }
          }
        }
        const joined = lines.join('')
        const expected = sentence.text.split('\n').join('')
        if (joined !== expected) {
          fail(`[${shape}/${size}] pc=${sentence.pc} 丢字/多字：${JSON.stringify(joined.slice(0, 40))} != ${JSON.stringify(expected.slice(0, 40))}`)
          failuresLocal += 1
        }
        totalPages += pages.length
        if (pages.length > maxPages) maxPages = pages.length
      }
    }
  }
  stats.paginations = paginations
  stats.avgPages = Number((totalPages / paginations).toFixed(3))
  stats.maxPages = maxPages
  stats.expectedPaginations = sentences.length * sizes.length * shapes.length
  assert(paginations === stats.expectedPaginations, `分页次数 ${paginations} != ${stats.expectedPaginations}`)
  return `${paginations} 次分页，平均 ${stats.avgPages} 页/句，最多 ${maxPages} 页`
})

// ---------------------------------------------------------------- 3. 设置归一化
check('normalizeSettings 默认值 / 越界 / 非法值', () => {
  const def = reader.normalizeSettings()
  const expected = reader.DEFAULT_SETTINGS
  assert(def.size === expected.size, `默认字号应 ${expected.size}`)
  assert(def.speed === expected.speed, `默认打字速度应 ${expected.speed}`)
  assert(def.autoMs === expected.autoMs, '默认自动播放应 0')
  assert(def.fast === false, 'fast 默认应 false')
  assert(def.keepOn === true, 'keepOn 默认应 true')
  assert(def.longpress === 'off', `默认 longpress 应 off，实际 ${def.longpress}`)
  const clampCases = [
    [{ size: 1 }, 'size', layout.SIZE_MIN],
    [{ size: 999 }, 'size', layout.SIZE_MAX],
    [{ size: 'abc' }, 'size', expected.size],
    [{ speed: -10 }, 'speed', reader.SPEED_MIN],
    [{ speed: 9999 }, 'speed', reader.SPEED_MAX],
    [{ speed: 'x' }, 'speed', expected.speed],
    [{ autoMs: -1 }, 'autoMs', reader.AUTO_MIN],
    [{ autoMs: 9999 }, 'autoMs', reader.AUTO_MAX],
    [{ autoMs: 'x' }, 'autoMs', expected.autoMs],
  ]
  for (const [raw, key, value] of clampCases) {
    const out = reader.normalizeSettings(raw)
    assert(out[key] === value, `normalizeSettings(${JSON.stringify(raw)}).${key} 应=${value}，实际 ${out[key]}`)
  }
  // 老存档：没有 keepOn 键不能被压成 false
  assert(reader.normalizeSettings({ size: 24 }).keepOn === true, '老存档缺 keepOn 应保持 true')
  assert(reader.normalizeSettings({ keepOn: false }).keepOn === false, 'keepOn=false 应保留 false')
  // 旧字段 auto / autoSpeed 应被删除
  const legacy = reader.normalizeSettings({ auto: true, autoSpeed: 'fast' })
  assert(!('auto' in legacy) && !('autoSpeed' in legacy), '旧字段 auto/autoSpeed 应被删除')
  // fast 不持久化
  assert(reader.normalizeSettings({ fast: true }).fast === false, 'fast 读回应强制 false')
  // longpress 历史布尔值/非法值
  assert(reader.normalizeSettings({ longpress: true }).longpress === 'hide', 'longpress=true 应归一为 hide')
  assert(reader.normalizeSettings({ longpress: false }).longpress === 'off', 'longpress=false 应归一为 off')
  assert(reader.normalizeSettings({ longpress: 'bogus' }).longpress === 'off', '非法 longpress 应回默认 off')
  return 'ok'
})

check('longpressMode 归一化', () => {
  assert(reader.longpressMode({}) === 'hide', '空设置默认 hide')
  assert(reader.longpressMode({ longpress: 'fast' }) === 'fast', 'fast 保留')
  assert(reader.longpressMode({ longpress: 'off' }) === 'off', 'off 保留')
  assert(reader.longpressMode({ longpress: 'hide' }) === 'hide', 'hide 保留')
  assert(reader.longpressMode({ longpress: true }) === 'hide', 'true -> hide')
  assert(reader.longpressMode({ longpress: false }) === 'off', 'false -> off')
  assert(reader.longpressMode({ longpress: 'bogus' }) === 'hide', '非法值 -> 保守 hide')
  return 'ok'
})

// ---------------------------------------------------------------- 4. autoDelay 边界
// 语义（src/common/reader.js + docs/refs/source-galgod.md §13）：
//   max(1200, min(12000, round(700 + 非空白字数 × autoMs)))
check('autoDelay 边界（1.2s~12s 夹取）', () => {
  // 下界：700 + n*ms < 1200 一律夹到 1200
  assert(reader.autoDelay('', 0) === 1200, `空文本+0 应 1200，实际 ${reader.autoDelay('', 0)}`)
  assert(reader.autoDelay('x', 0) === 1200, '1 字 +0 应夹到 1200')
  assert(reader.autoDelay('a'.repeat(10), 10) === 1200, `10 字 +10ms=800 应夹到 1200，实际 ${reader.autoDelay('a'.repeat(10), 10)}`)
  assert(reader.autoDelay('a b c', 10) === 1200, '空白不计字数，3 字 +10ms=730 应夹到 1200')
  assert(reader.autoDelay('x', -100) === 1200, '负 autoMs 应夹到 1200')
  assert(reader.autoDelay(undefined, 0) === 1200, 'undefined 文本应 1200')
  // 中间值：700 + n*ms（落在 1200~12000 之间）
  assert(reader.autoDelay('a'.repeat(100), 50) === 5700, `100 字 +50ms 应 5700，实际 ${reader.autoDelay('a'.repeat(100), 50)}`)
  assert(reader.autoDelay('a'.repeat(200), 50) === 10700, `200 字 +50ms 应 10700，实际 ${reader.autoDelay('a'.repeat(200), 50)}`)
  assert(reader.autoDelay('a b c'.repeat(10), 50) === 2200, '空白不计字数：30 字 +50ms = 2200')
  // 上界：700 + n*ms >= 12000 一律夹到 12000（226*50+700 = 12000 恰为边界，227*50 起夹取）
  assert(reader.autoDelay('a'.repeat(226), 50) === 12000, `226 字 +50ms=12000 应 12000，实际 ${reader.autoDelay('a'.repeat(226), 50)}`)
  assert(reader.autoDelay('a'.repeat(227), 50) === 12000, `227 字 +50ms=12050 应夹到 12000，实际 ${reader.autoDelay('a'.repeat(227), 50)}`)
  assert(reader.autoDelay('a'.repeat(1000), 200) === 12000, '超大文本应夹到 12000')
  return '公式 max(1200,min(12000,700+n*ms)) 全部一致'
})

// ---------------------------------------------------------------- 5. wrapText / paginateText
check('wrapText 标点断行与显式换行保留', () => {
  // 显式换行：空行保留为空串（真实 reader.js 行为）
  const lineFold = reader.wrapText('abc\ndef', 80)
  assert(lineFold.length === 2 && lineFold[0] === 'abc' && lineFold[1] === 'def', `单换行拆分异常：${JSON.stringify(lineFold)}`)
  const lineEmpty = reader.wrapText('abc\n\ndef', 80)
  assert(lineEmpty.length === 3, `双换行应保留空行（3 行），实际 ${JSON.stringify(lineEmpty)}`)
  assert(lineEmpty[0] === 'abc' && lineEmpty[1] === '' && lineEmpty[2] === 'def', `空行保留异常：${JSON.stringify(lineEmpty)}`)
  // 标点优先断行：'一二三四五，六七八九十' cpl=6 → 第一行以 '，' 结尾且 ≤6
  const linePunct = reader.wrapText('一二三四五，六七八九十', 6)
  assert(linePunct[0].endsWith('，'), `标点应留在行尾，实际 ${JSON.stringify(linePunct[0])}`)
  assert(linePunct[0].length <= 6, `第一行长度应 <=6，实际 ${linePunct[0].length}`)
  assert(linePunct.join('') === '一二三四五，六七八九十', '标点断行不应丢字')
  // 长行按 limit 切且不丢字
  const source = '甲'.repeat(100)
  const lineLong = reader.wrapText(source, 7)
  assert(lineLong.every((line) => line.length <= 7), '切行长度超限')
  assert(lineLong.join('') === source, '长行切分丢字')
  // cpl 非法值兜底 / 空文本
  assert(reader.wrapText('abc', 0).join('') === 'abc', 'cpl=0 不应丢字')
  assert(reader.wrapText('', 10)[0] === '', '空文本应返回 [""]')
  return 'ok'
})

check('paginateText 分组', () => {
  const pages = reader.paginateText('a'.repeat(20), 5, 2)
  assert(pages.length === 2, `20 字/cpl5/lpp2 应 2 页，实际 ${pages.length}`)
  assert(pages[0].length === 2 && pages[1].length === 2, '每页行数异常')
  assert(pages.flat().join('') === 'a'.repeat(20), '分页丢字')
  const one = reader.paginateText('短句', 10, 6)
  assert(one.length === 1 && one[0].length === 1, '短句应 1 页 1 行')
  const empty = reader.paginateText('', 10, 6)
  assert(empty.length === 1 && empty[0][0] === '', '空文本应返回 [[""]]')
  return 'ok'
})

// ---------------------------------------------------------------- 输出
const pass = failures.length === 0
const report = {
  tool: 'tools/test-reader.mjs',
  generatedAt: new Date().toISOString(),
  pass,
  failures,
  checks,
  stats,
}
console.log('==== 分页/设置逻辑测试 (tools/test-reader.mjs) ====')
console.log(`台词: ${stats.sentenceCount} 句；分页组合: ${stats.paginations} 次（17 字号 × 2 屏）`)
console.log('')
for (const item of checks) {
  console.log(`  [${item.pass ? 'PASS' : 'FAIL'}] ${item.name}${item.detail ? '  → ' + item.detail : ''}`)
}
if (failures.length) {
  console.log('')
  console.log(`失败 ${failures.length} 条（最多显示 40）：`)
  failures.slice(0, 40).forEach((message) => console.log(`  [fail] ${message}`))
}
console.log('')
console.log(`[test-reader] 结果: ${pass ? 'PASS' : 'FAIL'}  checks=${checks.length} failures=${failures.length}`)

try {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'test-reader.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('[test-reader] JSON 报告: scripts/reports/test-reader.json')
} catch (error) {
  console.error(`[test-reader] 写 JSON 报告失败：${error.message}`)
}

try {
  fs.rmSync(tempDir, { recursive: true, force: true })
} catch (error) {
  /* ignore */
}

process.exit(pass ? 0 : 1)
