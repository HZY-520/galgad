#!/usr/bin/env node
/**
 * import_story.mjs —— 把 galgod-band（小米手环 Vela 版）的剧本数据导入 BlueOS 工程。
 *
 * 源工程：C:\Users\Administrator\BlueOSProjects\_galgod_band_src\galgod-band-main
 * 目标工程：本工程根目录
 *
 * 做的事：
 *  1. src/common/story/index.txt -> src/common/story/index.json（chunk 路径改成 .json）
 *  2. src/common/story/chunk-000..043.txt -> src/common/story/chunk-000..043.json
 *  3. src/common/assets.js / cglist.js 原样复制（图片索引表 / CG 鉴赏分组）
 *  4. 完整性校验：节点数、分块覆盖、图片下标范围、章节表、node 类型统计
 *
 * 用法：node tools/import_story.mjs [--src <源工程根目录>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SRC = 'C:/Users/Administrator/BlueOSProjects/_galgod_band_src/galgod-band-main'

function parseArgs(argv) {
  let src = DEFAULT_SRC
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--src') src = path.resolve(argv[++i])
  }
  return { src }
}

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

function main() {
  const { src } = parseArgs(process.argv.slice(2))
  const srcStory = path.join(src, 'src/common/story')
  const dstStory = path.join(ROOT, 'src/common/story')
  if (!fs.existsSync(srcStory)) {
    console.error('[import_story] 找不到源剧本目录: ' + srcStory)
    process.exit(2)
  }
  fs.mkdirSync(dstStory, { recursive: true })
  // 清掉旧的 chunk，避免 chunk 数变化后旧文件残留进包
  for (const name of fs.readdirSync(dstStory)) {
    if (/^chunk-\d+\.json$/.test(name) || name === 'index.json') fs.unlinkSync(path.join(dstStory, name))
  }

  const index = JSON.parse(readUtf8(path.join(srcStory, 'index.txt')))
  let totalNodes = 0
  const types = {}
  const bgRefs = new Set()
  const csRefs = new Set()
  const cgRefs = new Set()
  const speakers = new Set()
  const flags = new Set()
  const choiceTexts = []
  let maxBg = -3
  let maxCs = -1
  let maxCg = -1

  for (const chunk of index.chunks) {
    const srcFile = path.join(src, 'src', chunk.file.replace(/^\//, ''))
    const nodes = JSON.parse(readUtf8(srcFile))
    if (!Array.isArray(nodes) || nodes.length !== chunk.count) {
      console.error(`[import_story] 分块长度不符 ${chunk.file}: ${nodes && nodes.length} != ${chunk.count}`)
      process.exit(3)
    }
    totalNodes += nodes.length
    for (const n of nodes) {
      types[n.t] = (types[n.t] || 0) + 1
      if (n.bg !== undefined) { bgRefs.add(n.bg); maxBg = Math.max(maxBg, n.bg) }
      if (n.cs !== undefined) for (const s of n.cs) { csRefs.add(s.i); maxCs = Math.max(maxCs, s.i) }
      if (n.cg !== undefined) { cgRefs.add(n.cg); maxCg = Math.max(maxCg, n.cg) }
      if (n.t === 's') { if (n.n) speakers.add(n.n) }
      if (n.t === 'o') for (const o of n.o || []) { choiceTexts.push(o.x); if (o.c) flags.add(o.c[0]) }
      if (n.t === 'f' || n.t === 'sf') flags.add(n.v)
      if (n.t === 'cj') flags.add(n.v)
    }
    const dstFile = path.join(dstStory, 'chunk-' + String(chunk.start / index.chunkSize).padStart(3, '0') + '.json')
    fs.writeFileSync(dstFile, JSON.stringify(nodes), 'utf8')
  }

  // 重写 chunk 文件路径并落盘
  const outIndex = Object.assign({}, index)
  outIndex.chunks = index.chunks.map((c) => Object.assign({}, c, {
    file: c.file.replace(/\.txt$/, '.json'),
  }))
  fs.writeFileSync(path.join(dstStory, 'index.json'), JSON.stringify(outIndex), 'utf8')

  // 复制图片索引表 / CG 鉴赏分组（路径保持不变：/common/img/...）
  for (const name of ['assets.js', 'cglist.js']) {
    fs.copyFileSync(path.join(src, 'src/common', name), path.join(ROOT, 'src/common', name))
  }

  // 校验图片下标范围
  const assetsText = readUtf8(path.join(ROOT, 'src/common/assets.js'))
  const imgMatch = assetsText.match(/"(\/common\/img\/[^"]+)"/g) || []
  const IMG_COUNT = imgMatch.length
  const errors = []
  if (index.nodeCount !== totalNodes) errors.push(`nodeCount ${index.nodeCount} != 实际 ${totalNodes}`)
  if (totalNodes !== 5569) errors.push(`节点总数 ${totalNodes} != 期望 5569`)
  if (index.chunks.length !== 44) errors.push(`分块数 ${index.chunks.length} != 期望 44`)
  if (index.chapters.length !== 18) errors.push(`章节数 ${index.chapters.length} != 期望 18`)
  if (IMG_COUNT !== 127) errors.push(`图片索引 ${IMG_COUNT} != 期望 127`)
  if (maxBg >= IMG_COUNT) errors.push(`背景下标越界 ${maxBg}`)
  if (maxCs >= IMG_COUNT) errors.push(`立绘下标越界 ${maxCs}`)
  if (maxCg >= IMG_COUNT) errors.push(`CG 下标越界 ${maxCg}`)

  console.log('[import_story] 源工程: ' + src)
  console.log('[import_story] 节点 %d / 分块 %d / 章节 %d / 图片索引 %d',
    totalNodes, index.chunks.length, index.chapters.length, IMG_COUNT)
  console.log('[import_story] node 类型: ' + Object.keys(types).sort().map((k) => k + '=' + types[k]).join(' '))
  console.log('[import_story] 引用: bg=%d cs=%d cg=%d speakers=%d flags=%d choices=%d',
    bgRefs.size, csRefs.size, cgRefs.size, speakers.size, flags.size, choiceTexts.length)
  console.log('[import_story] flag 名称: ' + [...flags].sort().join(', '))
  if (errors.length) {
    console.error('[import_story] FAIL\n  - ' + errors.join('\n  - '))
    process.exit(1)
  }
  console.log('[import_story] PASS')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
export { main }
