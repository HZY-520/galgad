#!/usr/bin/env node
/**
 * 剧本数据静态校验（tools/validate-story.mjs）
 *
 * 目标工程数据契约（见 docs/PORT-SPEC.md §1 与 src/common/story/index.json）：
 *   - 44 个分块 chunk-000.json … chunk-043.json，start/count 连续覆盖 5569 个节点；
 *   - 18 个章节（14 正常 + 3 隐藏结局 + 1 通关后日谈），start 严格递增、末章覆盖到 nodeCount；
 *   - 节点类型只有 s/o/e/f/sf/j/cj 七种，字段按类型校验；
 *   - bg/cs/cg 资源号在 IMG(127) 范围内、语义区间正确（bg 0-37 / cs 38-92 / cg 93-126，-1/-2 纯色），
 *     且对应图片文件真实存在；
 *   - 所有跳转（j / cj / 选项 j）目标在 [0, nodeCount) 内；
 *   - CGG 9 组：缩略图文件存在、u/im 下标合法且对应图片（含鉴赏宽图 w/）存在；
 *   - manifest.versionName 与 About 页 APP_VER 一致（About 未实现时跳过并记 TODO）。
 *
 * 用法: node tools/validate-story.mjs [--root .] [--json <file>]
 * 退出码: 0 = PASS；1 = 有 error；2 = 数据缺失/无法读取。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const STORY_DIR = path.join(SRC, 'common', 'story')
const REPORT_DIR = path.join(ROOT, 'scripts', 'reports')

const EXPECTED_CHUNKS = 44
const EXPECTED_NODES = 5569
const EXPECTED_CHAPTERS = 18
const EXPECTED_IMG = 127
const EXPECTED_CGG = 9
const BG_RANGE = [0, 37]
const CS_RANGE = [38, 92]
const CG_RANGE = [93, 126]
const ALLOWED_TYPES = new Set(['s', 'o', 'e', 'f', 'sf', 'j', 'cj'])
const ALLOWED_OPS = new Set(['>=', '<=', '>', '<', '=='])
const NODE_KEYS = new Set(['t', 'v', 'n', 'x', 'bg', 'cs', 'cg', 'o', 'j', 'tint', 'op'])

const errors = []
const warnings = []
const checks = []
const stats = {}

function err(code, message, extra) {
  errors.push(Object.assign({ code, message }, extra || {}))
}

function warn(code, message, extra) {
  warnings.push(Object.assign({ code, message }, extra || {}))
}

function check(name, fn) {
  const before = errors.length
  try {
    fn()
  } catch (error) {
    err('check-crash', `${name} 异常：${error && error.message ? error.message : error}`)
  }
  checks.push({ name, pass: errors.length === before, errors: errors.length - before })
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function fileExists(uri) {
  if (!uri || uri.charAt(0) !== '/') return false
  return fs.existsSync(path.join(SRC, uri.replace(/^\//, '').replace(/\//g, path.sep)))
}

/** 从 assets.js / cglist.js 里提取 `export const NAME = [...]`（纯字面量，可直接 JSON.parse） */
function readExportedArray(file, name) {
  const text = fs.readFileSync(file, 'utf8')
  const pattern = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*(?:\\n|$)`)
  const match = pattern.exec(text)
  if (!match) throw new Error(`${path.basename(file)} 找不到 export const ${name} 数组`)
  // 允许 JS 字面量里的尾逗号（assets.js/cglist.js 是手写/生成文件）
  const literal = match[1].replace(/,(\s*[\]}])/g, '$1')
  return JSON.parse(literal)
}

function isInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value
}

function rangeText(range) {
  return `${range[0]}~${range[1]}`
}

// ---------------------------------------------------------------- 主流程
const report = {
  tool: 'tools/validate-story.mjs',
  generatedAt: new Date().toISOString(),
  errors,
  warnings,
  checks,
  stats,
  pass: false,
}

check('读取 manifest / 索引 / 资源表', () => {
  const manifestFile = path.join(SRC, 'manifest.json')
  if (!fs.existsSync(manifestFile)) throw new Error('src/manifest.json 不存在')
  const manifest = readJson(manifestFile)
  stats.manifestVersionName = manifest.versionName
  stats.manifestPackage = manifest.package
  if (!manifest.versionName || !/^\d+\.\d+\.\d+/.test(String(manifest.versionName))) {
    err('manifest-version', `manifest.versionName 不是合法版本号：${JSON.stringify(manifest.versionName)}`)
  }
  if (!manifest.package) err('manifest-package', 'manifest.package 缺失')

  const indexFile = path.join(STORY_DIR, 'index.json')
  if (!fs.existsSync(indexFile)) throw new Error('src/common/story/index.json 不存在')
  const index = readJson(indexFile)
  stats.index = index

  const assetsFile = path.join(SRC, 'common', 'assets.js')
  const cglistFile = path.join(SRC, 'common', 'cglist.js')
  if (!fs.existsSync(assetsFile)) throw new Error('src/common/assets.js 不存在')
  if (!fs.existsSync(cglistFile)) throw new Error('src/common/cglist.js 不存在')
  const IMG = readExportedArray(assetsFile, 'IMG')
  const CGG = readExportedArray(cglistFile, 'CGG')
  stats.imgCount = IMG.length
  stats.cggCount = CGG.length

  // About 版本号（页面可能还在并行编写中）
  const aboutFile = path.join(SRC, 'pages', 'About', 'index.ux')
  let aboutVer = null
  if (fs.existsSync(aboutFile)) {
    const m = /APP_VER\s*=\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(aboutFile, 'utf8'))
    if (m) aboutVer = m[1]
  }
  stats.aboutAppVer = aboutVer

  // ---------------- 分块
  const chunkFiles = fs
    .readdirSync(STORY_DIR)
    .filter((name) => /^chunk-\d{3}\.json$/.test(name))
    .sort()
  stats.chunkFileCount = chunkFiles.length
  const chunks = index.chunks || []
  if (chunks.length !== EXPECTED_CHUNKS) {
    err('chunk-count', `index.chunks 数量 ${chunks.length}，期望 ${EXPECTED_CHUNKS}`)
  }
  if (chunkFiles.length !== EXPECTED_CHUNKS) {
    err('chunk-file-count', `story 目录分块文件 ${chunkFiles.length} 个，期望 ${EXPECTED_CHUNKS}`)
  }
  if (chunks.length !== chunkFiles.length) {
    err('chunk-mismatch', `index.chunks=${chunks.length} 与磁盘分块文件=${chunkFiles.length} 不一致`)
  }

  const byBase = new Map(chunkFiles.map((name) => [name, true]))
  let expectedStart = 0
  let total = 0
  const nodeArrays = []
  chunks.forEach((chunk, i) => {
    const base = path.basename(chunk.file || '')
    if (!base) {
      err('chunk-file-missing', `chunks[${i}].file 缺失`)
      nodeArrays.push(null)
      return
    }
    if (!byBase.has(base)) {
      err('chunk-file-missing', `chunks[${i}] 指向的文件不存在：${chunk.file}`)
      nodeArrays.push(null)
      return
    }
    if (chunk.start !== expectedStart) {
      err('chunk-start', `chunks[${i}].start=${chunk.start}，期望 ${expectedStart}（分块必须连续）`)
    }
    const expectedCount = Math.min(index.chunkSize, index.nodeCount - chunk.start)
    if (chunk.count !== expectedCount) {
      err('chunk-size', `chunks[${i}].count=${chunk.count}，期望 ${expectedCount}（chunkSize=${index.chunkSize}，nodeCount=${index.nodeCount}）`)
    }
    let nodes
    try {
      nodes = readJson(path.join(STORY_DIR, base))
    } catch (error) {
      err('chunk-json', `解析 ${base} 失败：${error.message}`)
      nodeArrays.push(null)
      return
    }
    if (!Array.isArray(nodes)) {
      err('chunk-type', `${base} 不是节点数组`)
      nodeArrays.push(null)
      return
    }
    if (nodes.length !== chunk.count) {
      err('chunk-nodecount', `${base} 节点数 ${nodes.length} != count ${chunk.count}`)
    }
    nodeArrays.push(nodes)
    total += nodes.length
    expectedStart = chunk.start + chunk.count
  })
  // 未被索引引用的分块文件
  for (const base of chunkFiles) {
    if (!chunks.some((chunk) => path.basename(chunk.file || '') === base)) {
      err('chunk-orphan', `磁盘分块 ${base} 未被 index.chunks 引用`)
    }
  }
  stats.nodeTotal = total
  stats.expectedNodes = EXPECTED_NODES
  if (total !== EXPECTED_NODES) err('node-total', `节点总数 ${total}，期望 ${EXPECTED_NODES}`)
  if (index.nodeCount !== total) err('index-nodecount', `index.nodeCount=${index.nodeCount} 与实际节点总数 ${total} 不一致`)
  if (index.chunkSize !== 128) err('chunk-size-config', `index.chunkSize=${index.chunkSize}，期望 128`)

  // 节点扁平表（保持下标语义）
  const flat = []
  let flatOk = true
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const nodes = nodeArrays[i]
    if (!nodes) {
      flatOk = false
      continue
    }
    for (let k = 0; k < chunk.count; k += 1) flat[chunk.start + k] = nodes[k]
  }
  for (let i = 0; i < total; i += 1) {
    if (flat[i] === undefined) {
      flatOk = false
      err('node-gap', `节点下标 ${i} 缺失（分块覆盖有空洞）`)
      break
    }
  }
  stats.flatOk = flatOk
  if (!flatOk) return
  stats.nodes = flat

  // ---------------- 章节
  const chapters = index.chapters || []
  stats.chapterCount = chapters.length
  if (chapters.length !== EXPECTED_CHAPTERS) {
    err('chapter-count', `章节数 ${chapters.length}，期望 ${EXPECTED_CHAPTERS}`)
  }
  let lastStart = -1
  const chapterIds = new Set()
  chapters.forEach((chapter, i) => {
    if (!chapter.id || typeof chapter.id !== 'string') err('chapter-id', `章 ${i} id 缺失`)
    else if (chapterIds.has(chapter.id)) err('chapter-id-dup', `章节 id 重复：${chapter.id}`)
    else chapterIds.add(chapter.id)
    if (!chapter.title || typeof chapter.title !== 'string') err('chapter-title', `章 ${i} title 缺失`)
    if (!isInt(chapter.start) || chapter.start < 0) {
      err('chapter-start', `章 ${i} start 非法：${JSON.stringify(chapter.start)}`)
      return
    }
    if (chapter.start <= lastStart) err('chapter-order', `章节 start 未严格递增：${chapter.id}=${chapter.start} <= ${lastStart}`)
    if (chapter.start >= total) err('chapter-range', `章节 start 越界：${chapter.id}=${chapter.start} >= ${total}`)
    lastStart = chapter.start
    if (chapter.hide !== undefined && chapter.hide !== 1 && chapter.hide !== true) {
      err('chapter-hide', `章 ${chapter.id} hide 值非法：${JSON.stringify(chapter.hide)}`)
    }
    if (chapter.need !== undefined && chapter.need !== 1 && chapter.need !== true) {
      err('chapter-need', `章 ${chapter.id} need 值非法：${JSON.stringify(chapter.need)}`)
    }
  })
  if (chapters.length && chapters[0].start !== 0) err('chapter-first', `首章 start=${chapters[0].start}，期望 0（入口节点）`)
  if (chapters.length) {
    const last = chapters[chapters.length - 1]
    if (!(last.start < total && total - last.start > 0)) {
      err('chapter-cover', `末章 ${last.id} start=${last.start} 未覆盖到 nodeCount=${total}`)
    }
  }
  const hideCount = chapters.filter((c) => c.hide).length
  const needCount = chapters.filter((c) => c.need).length
  stats.hideChapterCount = hideCount
  stats.needChapterCount = needCount
  if (hideCount !== 3) err('chapter-hide-count', `隐藏结局章 ${hideCount} 个，期望 3（end_te/end_ne1/end_ne2）`)
  if (needCount !== 1) err('chapter-need-count', `通关解锁章 ${needCount} 个，期望 1（后日谈）`)
  if (index.entry !== 0) err('index-entry', `index.entry=${index.entry}，期望 0`)

  // ---------------- IMG / CGG 资源表
  if (IMG.length !== EXPECTED_IMG) err('img-count', `IMG 数量 ${IMG.length}，期望 ${EXPECTED_IMG}`)
  const imgSeen = new Set()
  IMG.forEach((uri, i) => {
    if (typeof uri !== 'string' || !uri) {
      err('img-uri', `IMG[${i}] 不是字符串：${JSON.stringify(uri)}`)
      return
    }
    if (uri.charAt(0) !== '/') err('img-uri-abs', `IMG[${i}] 不是绝对路径：${uri}`)
    if (imgSeen.has(uri)) err('img-dup', `IMG[${i}] 重复：${uri}`)
    imgSeen.add(uri)
    if (!fileExists(uri)) err('img-missing', `IMG[${i}] 图片文件不存在：${uri}`)
  })
  if (CGG.length !== EXPECTED_CGG) err('cgg-count', `CGG 组数 ${CGG.length}，期望 ${EXPECTED_CGG}`)
  const cggImgs = new Set()
  CGG.forEach((group, i) => {
    if (!group || typeof group !== 'object') {
      err('cgg-type', `CGG[${i}] 不是对象`)
      return
    }
    if (!group.n || typeof group.n !== 'string') err('cgg-name', `CGG[${i}].n 缺失`)
    if (typeof group.th !== 'string' || !group.th) err('cgg-th', `CGG[${i}].th 缺失`)
    else if (!fileExists(group.th)) err('cgg-th-missing', `CGG[${i}] 缩略图不存在：${group.th}`)
    if (!isInt(group.u) || group.u < CG_RANGE[0] || group.u > CG_RANGE[1]) {
      err('cgg-u', `CGG[${i}].u=${JSON.stringify(group.u)} 不在 CG 区间 ${rangeText(CG_RANGE)}`)
    }
    if (!Array.isArray(group.im) || group.im.length === 0) {
      err('cgg-im', `CGG[${i}].im 不是非空数组`)
      return
    }
    group.im.forEach((idx, k) => {
      if (!isInt(idx) || idx < CG_RANGE[0] || idx > CG_RANGE[1]) {
        err('cgg-im-range', `CGG[${i}].im[${k}]=${JSON.stringify(idx)} 不在 CG 区间 ${rangeText(CG_RANGE)}`)
        return
      }
      if (cggImgs.has(idx)) warn('cgg-im-dup', `图片下标 ${idx} 出现在多个 CG 组（${IMG[idx]}）`)
      cggImgs.add(idx)
      if (!fileExists(IMG[idx])) err('cgg-im-missing', `CGG[${i}].im[${k}] 图片不存在：${IMG[idx]}`)
      const wide = String(IMG[idx]).replace('/common/img/c/', '/common/img/w/')
      if (!fileExists(wide)) err('cgg-wide-missing', `CGG[${i}].im[${k}] 鉴赏宽图不存在：${wide}`)
    })
    if (isInt(group.u) && !group.im.includes(group.u)) {
      warn('cgg-u-not-in-im', `CGG[${i}].u=${group.u} 不在 im 数组里`)
    }
  })
  stats.cggUnlockImgCount = cggImgs.size

  // ---------------- 节点字段 / 类型 / 跳转
  const typeCount = {}
  const unknownKeys = new Set()
  let sayCount = 0
  let choiceOptionCount = 0
  const flagNames = new Set()
  const jumpTargets = []
  flat.forEach((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      err('node-type', `节点 ${index} 不是对象`)
      return
    }
    const t = node.t
    typeCount[t] = (typeCount[t] || 0) + 1
    if (!ALLOWED_TYPES.has(t)) {
      err('node-t', `节点 ${index} 类型非法：${JSON.stringify(t)}`)
      return
    }
    for (const key of Object.keys(node)) {
      if (!NODE_KEYS.has(key)) unknownKeys.add(key)
    }
    // 公共可选字段
    if (node.bg !== undefined) {
      if (!isInt(node.bg)) err('node-bg', `节点 ${index} bg 非整数：${JSON.stringify(node.bg)}`)
      else if (node.bg !== -1 && node.bg !== -2) {
        if (node.bg < BG_RANGE[0] || node.bg > BG_RANGE[1]) {
          err('node-bg-range', `节点 ${index} bg=${node.bg} 不在背景区间 ${rangeText(BG_RANGE)}（或 -1/-2）`)
        } else if (IMG[node.bg] && !fileExists(IMG[node.bg])) {
          err('node-bg-missing', `节点 ${index} bg 图片不存在：${IMG[node.bg]}`)
        }
      }
    }
    if (node.cs !== undefined) {
      if (!Array.isArray(node.cs)) err('node-cs', `节点 ${index} cs 非数组`)
      else {
        node.cs.forEach((sprite, k) => {
          if (!sprite || typeof sprite !== 'object') {
            err('node-cs-item', `节点 ${index} cs[${k}] 不是对象`)
            return
          }
          if (typeof sprite.k !== 'string') err('node-cs-k', `节点 ${index} cs[${k}].k 非字符串`)
          if (!isInt(sprite.i) || sprite.i < CS_RANGE[0] || sprite.i > CS_RANGE[1]) {
            err('node-cs-i', `节点 ${index} cs[${k}].i=${JSON.stringify(sprite.i)} 不在立绘区间 ${rangeText(CS_RANGE)}`)
          } else if (IMG[sprite.i] && !fileExists(IMG[sprite.i])) {
            err('node-cs-missing', `节点 ${index} cs[${k}] 图片不存在：${IMG[sprite.i]}`)
          }
          if (sprite.s !== undefined && ['left', 'center', 'right', 'c'].indexOf(sprite.s) < 0) {
            err('node-cs-s', `节点 ${index} cs[${k}].s=${JSON.stringify(sprite.s)} 非法（left/center/right/c）`)
          }
        })
      }
    }
    if (node.cg !== undefined) {
      if (!isInt(node.cg)) err('node-cg', `节点 ${index} cg 非整数：${JSON.stringify(node.cg)}`)
      else if (node.cg !== -1) {
        if (node.cg < CG_RANGE[0] || node.cg > CG_RANGE[1]) {
          err('node-cg-range', `节点 ${index} cg=${node.cg} 不在 CG 区间 ${rangeText(CG_RANGE)}（或 -1）`)
        } else if (IMG[node.cg] && !fileExists(IMG[node.cg])) {
          err('node-cg-missing', `节点 ${index} cg 图片不存在：${IMG[node.cg]}`)
        }
      }
    }
    if (node.tint !== undefined && typeof node.tint !== 'string') {
      err('node-tint', `节点 ${index} tint 非字符串：${JSON.stringify(node.tint)}`)
    }

    // 按类型
    if (t === 's') {
      sayCount += 1
      if (typeof node.x !== 'string') err('node-say-x', `say 节点 ${index} 缺少字符串 x`)
      else if (node.x.length === 0) warn('node-say-empty', `say 节点 ${index} x 为空`)
      if (node.n !== undefined && typeof node.n !== 'string') err('node-say-n', `say 节点 ${index} n 非字符串`)
      if (node.n === undefined) warn('node-say-n-missing', `say 节点 ${index} 缺少 n 字段（渲染时按旁白处理，仅提示）`)
    } else if (t === 'o') {
      if (!Array.isArray(node.o) || node.o.length === 0) err('node-choice-o', `选项节点 ${index} o 不是非空数组`)
      else {
        const optionJs = new Set()
        node.o.forEach((option, k) => {
          choiceOptionCount += 1
          if (!option || typeof option !== 'object') {
            err('node-choice-item', `选项节点 ${index} o[${k}] 不是对象`)
            return
          }
          if (typeof option.x !== 'string' || !option.x) err('node-choice-x', `选项节点 ${index} o[${k}].x 缺失`)
          if (!isInt(option.j)) {
            err('node-choice-j', `选项节点 ${index} o[${k}].j 非整数：${JSON.stringify(option.j)}`)
          } else {
            if (option.j < 0 || option.j >= total) err('node-choice-j-range', `选项节点 ${index} o[${k}].j=${option.j} 越界 [0,${total})`)
            if (option.j <= index) warn('node-choice-backward', `选项节点 ${index} o[${k}].j=${option.j} 指向自身或更早节点`)
            if (optionJs.has(option.j)) warn('node-choice-dup', `选项节点 ${index} 多个选项跳同一目标 ${option.j}`)
            optionJs.add(option.j)
          }
          if (option.c !== undefined && option.c !== null) {
            if (!Array.isArray(option.c) || option.c.length !== 3) {
              err('node-choice-c', `选项节点 ${index} o[${k}].c 非 [v,op,n]：${JSON.stringify(option.c)}`)
            } else {
              const [v, op, n] = option.c
              if (typeof v !== 'string') err('node-choice-c-v', `选项节点 ${index} o[${k}].c[0] 非字符串`)
              if (!ALLOWED_OPS.has(op)) err('node-choice-c-op', `选项节点 ${index} o[${k}].c[1] 运算符非法：${JSON.stringify(op)}`)
              if (typeof n !== 'number' || !Number.isFinite(n)) err('node-choice-c-n', `选项节点 ${index} o[${k}].c[2] 非数字`)
            }
          }
        })
      }
    } else if (t === 'e') {
      if (typeof node.x !== 'string' || !node.x) err('node-end-x', `结局节点 ${index} 缺少 x 文案`)
    } else if (t === 'f' || t === 'sf') {
      if (typeof node.v !== 'string' || !node.v) err(`node-${t}-v`, `${t} 节点 ${index} 缺少 v`)
      else flagNames.add(node.v)
      if (typeof node.n !== 'number' || !Number.isFinite(node.n)) err(`node-${t}-n`, `${t} 节点 ${index} n 非数字：${JSON.stringify(node.n)}`)
    } else if (t === 'j') {
      if (!isInt(node.j)) err('node-j', `跳转节点 ${index} j 非整数：${JSON.stringify(node.j)}`)
      else {
        if (node.j < 0 || node.j >= total) err('node-j-range', `跳转节点 ${index} j=${node.j} 越界 [0,${total})`)
        if (node.j === index) err('node-j-self', `跳转节点 ${index} 指向自身（死循环）`)
        jumpTargets.push({ index, j: node.j })
      }
    } else if (t === 'cj') {
      if (typeof node.v !== 'string' || !node.v) err('node-cj-v', `条件跳转 ${index} 缺少 v`)
      else flagNames.add(node.v)
      if (!ALLOWED_OPS.has(node.op)) err('node-cj-op', `条件跳转 ${index} 运算符非法：${JSON.stringify(node.op)}`)
      if (typeof node.n !== 'number' || !Number.isFinite(node.n)) err('node-cj-n', `条件跳转 ${index} n 非数字`)
      if (!isInt(node.j)) err('node-cj-j', `条件跳转 ${index} j 非整数`)
      else {
        if (node.j < 0 || node.j >= total) err('node-cj-j-range', `条件跳转 ${index} j=${node.j} 越界 [0,${total})`)
        if (node.j === index) err('node-cj-self', `条件跳转 ${index} 指向自身（死循环）`)
        jumpTargets.push({ index, j: node.j })
      }
    }
  })
  stats.typeCount = typeCount
  stats.sayCount = sayCount
  stats.choiceNodeCount = typeCount.o || 0
  stats.choiceOptionCount = choiceOptionCount
  stats.flagNames = Array.from(flagNames).sort()
  stats.jumpNodeCount = jumpTargets.length
  if (unknownKeys.size) warn('node-unknown-keys', `未知节点字段：${Array.from(unknownKeys).join(', ')}`)
  if (sayCount !== 5457) warn('say-count', `say 节点 ${sayCount} 个（PORT-SPEC 记录 5457）`)

  // ---------------- 章节起点语义
  chapters.forEach((chapter) => {
    if (!isInt(chapter.start) || chapter.start < 0 || chapter.start >= total) return
    const node = flat[chapter.start]
    if (!node) return
    // 章节起点允许是指令节点（j/f 等），但若 start 落在 say 中间也无碍；这里只做可读性统计
  })

  // ---------------- 版本一致性（About 未实现则记 TODO）
  if (aboutVer === null) {
    warn('about-missing', 'About 页不存在或未找到 APP_VER，版本一致性检查待页面完成后复跑（TODO）')
  } else if (aboutVer !== manifest.versionName) {
    err('about-version', `About APP_VER=${aboutVer} != manifest.versionName=${manifest.versionName}`)
  }

  void manifest
})

report.pass = errors.length === 0
report.errors = errors.slice(0, 100)
report.warnings = warnings.slice(0, 100)

// ---------------------------------------------------------------- 输出
function printReport() {
  console.log('==== 剧本数据校验 (tools/validate-story.mjs) ====')
  console.log(`节点: ${stats.nodeTotal || 0}/${EXPECTED_NODES}  分块: ${stats.chunkFileCount || 0}/${EXPECTED_CHUNKS}  章节: ${stats.chapterCount || 0}/${EXPECTED_CHAPTERS}  图片: ${stats.imgCount || 0}/${EXPECTED_IMG}  CGG: ${stats.cggCount || 0}/${EXPECTED_CGG}`)
  if (stats.typeCount) {
    console.log(
      `节点类型: s=${stats.typeCount.s || 0} o=${stats.typeCount.o || 0} e=${stats.typeCount.e || 0} f=${stats.typeCount.f || 0} sf=${stats.typeCount.sf || 0} j=${stats.typeCount.j || 0} cj=${stats.typeCount.cj || 0}`
    )
  }
  if (stats.flagNames) console.log(`flag: ${stats.flagNames.join(', ')}`)
  console.log('')
  for (const checkItem of checks) {
    console.log(`  [${checkItem.pass ? 'PASS' : 'FAIL'}] ${checkItem.name}`)
  }
  if (warnings.length) {
    console.log('')
    console.log(`警告 ${warnings.length} 条：`)
    warnings.slice(0, 30).forEach((item) => console.log(`  [warning] ${item.message}`))
    if (warnings.length > 30) console.log(`  ... 其余 ${warnings.length - 30} 条见 JSON`)
  }
  if (errors.length) {
    console.log('')
    console.log(`错误 ${errors.length} 条（最多显示 100）：`)
    errors.slice(0, 100).forEach((item) => console.log(`  [error] ${item.message}`))
  }
  console.log('')
  console.log(`[validate-story] 结果: ${report.pass ? 'PASS' : 'FAIL'}  errors=${errors.length} warnings=${warnings.length}`)
}

function main() {
  printReport()
  const jsonArgIndex = process.argv.indexOf('--json')
  const jsonFile =
    jsonArgIndex >= 0 && process.argv[jsonArgIndex + 1]
      ? path.resolve(process.argv[jsonArgIndex + 1])
      : path.join(REPORT_DIR, 'validate-story.json')
  try {
    fs.mkdirSync(path.dirname(jsonFile), { recursive: true })
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[validate-story] JSON 报告: ${path.relative(ROOT, jsonFile).replace(/\\/g, '/')}`)
  } catch (error) {
    console.error(`[validate-story] 写 JSON 报告失败：${error.message}`)
  }
  process.exit(report.pass ? 0 : 1)
}

main()
