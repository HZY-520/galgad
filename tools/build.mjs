#!/usr/bin/env node
/**
 * BlueOS 打包脚本（调用官方 blueos-pack，串行执行）
 *
 * 从 galgaoshou/tools/build.mjs 移植，额外做三件事：
 *   1. 构建全过程日志落盘 scripts/reports/build/<device>-<mode>.log；
 *   2. 结果摘要落盘 scripts/reports/build/<device>-<mode>.json；
 *   3. 失败时把 [ERROR] 原文/涉及页面写进 scripts/reports/build/FIRST-FAILURE.md（供 Lead 定位）。
 *
 * 用法:
 *   node tools/build.mjs --debug   --device watch-round     # = npm run build:debug
 *   node tools/build.mjs --debug   --device watch-square    # = npm run build:square
 *   node tools/build.mjs --release --device watch-round
 *   node tools/build.mjs --release --device watch-square
 *
 * 打包器定位（按优先级）:
 *   1. 环境变量 BLUEOS_PACK_BIN
 *   2. D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js
 *   3. 其他常见 BlueOS Studio 安装位置
 *
 * 说明:
 *  - 官方打包器会把 tailwind 等警告写到 stderr，进程退出码不可信；
 *    因此成功判定 = 输出中出现 "[INFO] finish compile" 且 dist/<device>/ 下生成了新的 .rpk。
 *  - dist 目录按 device 分目录（dist/<device>/debug|release），不同 device 可并行，
 *    同一 device 请勿并发构建；本脚本用 scripts/reports/build/.build.lock 做进程级互斥，
 *    检测到已有 blueos-pack 在跑时直接失败（避免缓存竞态导致的随机页面编译错）。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(ROOT, 'dist')
const SRC_DIR = path.join(ROOT, 'src')
const REPORT_DIR = path.join(ROOT, 'scripts', 'reports', 'build')
const LOCK_FILE = path.join(REPORT_DIR, '.build.lock')
const FIRST_FAILURE_FILE = path.join(REPORT_DIR, 'FIRST-FAILURE.md')

const PACKER_CANDIDATES = [
  'D:\\BlueOSStudio\\resources\\app\\extensions\\blueos-debugger\\node_modules\\blueos-pack\\bin\\index.js',
  'C:\\Program Files\\BlueOSStudio\\resources\\app\\extensions\\blueos-debugger\\node_modules\\blueos-pack\\bin\\index.js',
  'C:\\Program Files (x86)\\BlueOSStudio\\resources\\app\\extensions\\blueos-debugger\\node_modules\\blueos-pack\\bin\\index.js',
  path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'BlueOSStudio',
    'resources',
    'app',
    'extensions',
    'blueos-debugger',
    'node_modules',
    'blueos-pack',
    'bin',
    'index.js'
  ),
]
const ALLOWED_DEVICES = ['watch-round', 'watch-square', 'watch']
const SUCCESS_MARKER = '[INFO] finish compile'
const MAX_LOG_CHARS = 4 * 1024 * 1024

function parseArgs(argv) {
  const options = {
    mode: 'debug',
    device: 'watch-round',
    help: false,
    noForce: false,
    contentCheck: true,
    verifyRpk: null,
    entryOnly: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--debug') {
      options.mode = 'debug'
    } else if (arg === '--release') {
      options.mode = 'release'
    } else if (arg === '--entry-only') {
      // blueos-pack 的 --debug 只编译入口页（IDE 快速预览用），不能用于整包验收
      options.entryOnly = true
    } else if (arg === '--device' || arg === '-d') {
      options.device = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--device=')) {
      options.device = arg.slice('--device='.length)
    } else if (arg === '--verify-rpk') {
      options.verifyRpk = path.resolve(argv[i + 1])
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--force' || arg === '-f') {
      // 默认总是 -f（禁缓存），这里兼容显式传入
    } else if (arg === '--no-force') {
      options.noForce = true
    } else if (arg === '--skip-content-check') {
      options.contentCheck = false
    } else {
      console.error(`[build] 未知参数：${arg}`)
      options.help = true
    }
  }
  return options
}

function printHelp() {
  console.log(`用法: node tools/build.mjs [--debug|--release] [--device watch-round|watch-square|watch]

选项:
  --debug              调试/开发构建：blueos-pack build 子命令（dev 阶段、不签名、输出 dist/<device>/debug），
                       **编译全部页面**（整包验收用）
  --entry-only         透传 blueos-pack build --debug：只编译入口页（IDE 快速预览，不完整，不能当整包验收）
  --release            发布构建（blueos-pack release ...，输出到 dist/<device>/release，需要 sign/private.pem 与 sign/certificate.pem）
  --device <type>      设备类型，默认 watch-round；可选 watch-round / watch-square / watch
  --skip-content-check 跳过 rpk 产物内容断言（默认会校验 manifest/pages/45 个剧本 JSON/全部图片）
  -h, --help           显示帮助

环境变量:
  BLUEOS_PACK_BIN      覆盖 blueos-pack/bin/index.js 路径

日志:
  scripts/reports/build/<device>-<mode>.log   完整构建输出
  scripts/reports/build/<device>-<mode>.json  结果摘要
  scripts/reports/build/FIRST-FAILURE.md      失败时的首条错误摘要

示例:
  node tools/build.mjs --debug --device watch-round
  node tools/build.mjs --release --device watch-square
`)
}

function resolvePacker() {
  if (process.env.BLUEOS_PACK_BIN && process.env.BLUEOS_PACK_BIN.trim()) {
    const custom = path.resolve(process.env.BLUEOS_PACK_BIN.trim())
    if (fs.existsSync(custom)) return custom
    throw new Error(`环境变量 BLUEOS_PACK_BIN 指向的文件不存在：${custom}`)
  }
  for (const candidate of PACKER_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    '找不到 BlueOS 官方打包器 blueos-pack/bin/index.js。\n' +
      '  请安装 BlueOS Studio，或通过环境变量 BLUEOS_PACK_BIN 指定路径：\n' +
      '  $env:BLUEOS_PACK_BIN = "D:\\BlueOSStudio\\...\\blueos-pack\\bin\\index.js"\n' +
      '  已尝试：\n' +
      PACKER_CANDIDATES.map((item) => '    - ' + item).join('\n')
  )
}

function readPackerVersion(packerFile) {
  try {
    const packageFile = path.resolve(path.dirname(packerFile), '..', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    return packageJson.version || 'unknown'
  } catch (error) {
    return 'unknown'
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit >= 2 ? 2 : 0)} ${units[unit]}`
}

function rel(target) {
  return path.relative(ROOT, target).replace(/\\/g, '/')
}

function findRpkFiles(dir, collected = []) {
  if (!fs.existsSync(dir)) return collected
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    return collected
  }
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findRpkFiles(full, collected)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.rpk')) {
      try {
        const stat = fs.statSync(full)
        collected.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch (error) {
        /* ignore */
      }
    }
  })
  return collected
}

function pickRpk(device, mode, startedAt) {
  const deviceDir = path.join(DIST_DIR, device)
  const candidates = findRpkFiles(deviceDir)
  if (candidates.length === 0) return null
  // 优先选本次构建新生成的（mtime >= startedAt - 5s，兼容文件系统时间粒度）
  const threshold = startedAt - 5000
  const fresh = candidates.filter((item) => item.mtimeMs >= threshold)
  const pool = fresh.length > 0 ? fresh : candidates
  pool.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const best = pool[0]
  return Object.assign({ fresh: fresh.length > 0 }, best)
}

function keyErrorLines(text) {
  const lines = text.split(/\r?\n/)
  const matched = lines.filter((line) =>
    /(\[ERROR\])|(ERROR:)|(Error:)|(错误)|(失败)|(编译失败)|(缺少)|(Cannot find)|(ENOENT)|(BError)/.test(line)
  )
  return Array.from(new Set(matched)).slice(0, 40)
}

/** 从 [ERROR] 行里尽量提取页面/文件/行号，便于写 FIRST-FAILURE.md */
function extractErrorContext(lines) {
  const files = new Set()
  const pages = new Set()
  for (const line of lines) {
    const fileMatch = /([A-Za-z]:[\\/][^\s:'"]+|[^\s:'"]+\.(?:ux|js|json|css|scss))(?::(\d+))?/.exec(line)
    if (fileMatch) files.add(fileMatch[0].replace(/\\/g, '/'))
    const pageMatch = /pages[\\/]([A-Za-z0-9_]+)[\\/]index\.ux/.exec(line)
    if (pageMatch) pages.add(pageMatch[1])
  }
  return { files: Array.from(files).filter((item) => /\.(ux|js|json|css|scss)$/.test(item)).slice(0, 10), pages: Array.from(pages) }
}

function tailLines(text, count = 30) {
  return text.split(/\r?\n/).slice(-count).join('\n')
}

// ---------------------------------------------------------------- rpk 产物内容断言
// rpk = ZIP（含 META-INF/CERT、manifest.json、<package>.<hash>.vru、META-INF/build.txt）。
// .vru = "vivo union file"：16 字节魔数 + 头部 + package 名，随后是目录表
//   [u32 dataOffset][u32 size][u32 nameLen][name]，用最大条目数启发式定位目录起点。
// 内容断言不依赖第三方 zip 库（Node 内置 zlib 足够解 inflate）。
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function readZipEntries(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是 ZIP 文件（找不到 End of Central Directory）')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 暂不支持（本工程 rpk 不应超过 4GB/65535 条目）')
  const out = []
  let p = cdOffset
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`中央目录第 ${i} 项签名损坏（offset=${p}）`)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8')
    out.push({ name, method, csize, usize, localOffset, isDir: name.endsWith('/') })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function extractZipEntry(buf, entry) {
  if (entry.isDir) return Buffer.alloc(0)
  const local = entry.localOffset
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`local header 损坏：${entry.name}`)
  const nameLen = buf.readUInt16LE(local + 26)
  const extraLen = buf.readUInt16LE(local + 28)
  const start = local + 30 + nameLen + extraLen
  const raw = buf.slice(start, start + entry.csize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error(`不支持的 ZIP 压缩方法 ${entry.method}：${entry.name}`)
}

function isPrintableName(buf) {
  if (buf.length === 0) return false
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i]
    if (byte < 0x20 || byte > 0x7e) return false
  }
  return true
}

function parseVru(buf) {
  const magic = buf.slice(0, 16).toString('latin1')
  if (!magic.startsWith('vivo union file')) {
    // 兼容：某些版本 .vru 本身就是 zip
    try {
      const zipEntries = readZipEntries(buf)
      return { format: 'zip', entries: zipEntries.filter((item) => !item.isDir).map((item) => ({ name: item.name, size: item.usize })) }
    } catch (error) {
      throw new Error(`未知 .vru 格式（magic=${buf.slice(0, 16).toString('hex')}）`)
    }
  }
  // 在头部区域找目录起点：从候选偏移解析，取能解析出最多条目的那个
  let best = { start: -1, entries: [] }
  const scanEnd = Math.min(buf.length, 4096)
  for (let start = 64; start <= scanEnd; start += 4) {
    let p = start
    const entries = []
    let guard = 0
    while (p + 12 <= buf.length && guard < 200000) {
      const dataOffset = buf.readUInt32LE(p)
      const size = buf.readUInt32LE(p + 4)
      const nameLen = buf.readUInt32LE(p + 8)
      if (nameLen < 1 || nameLen > 260) break
      const nameBuf = buf.slice(p + 12, p + 12 + nameLen)
      if (!isPrintableName(nameBuf)) break
      entries.push({ name: nameBuf.toString('utf8'), size, dataOffset })
      p += 12 + nameLen
      guard += 1
    }
    if (entries.length > best.entries.length) best = { start, entries }
  }
  if (best.entries.length < 3) throw new Error(`无法解析 .vru 目录表（magic 正确但条目不足，首字节=${buf.slice(0, 16).toString('hex')}）`)
  return { format: 'vru', dirStart: best.start, entries: best.entries }
}

/** 递归列出目录下所有文件（返回相对 base 的 posix 路径） */
function walkFiles(dir, filter, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, filter, base, out)
    else if (entry.isFile() && (!filter || filter(entry.name))) {
      out.push(path.relative(base, full).replace(/\\/g, '/'))
    }
  }
  return out
}

/**
 * 断言 rpk 内容与 src 一致：
 *  - 外层：manifest.json / META-INF/CERT / META-INF/build.txt / *.vru；
 *  - 内层 manifest：package、versionName、router.entry/pages、features；
 *  - vru：pages/<Page>/{index.js,index.template.json,index.css.json}、
 *         common/story/{index.json,chunk-000..043.json}（45 个）、
 *         common/img/**（127+32+9=168 张，png→vug）、assets/images/{home,icon}、app.js/app.css.json。
 */
function verifyRpkContents(rpkPath, options = {}) {
  const errors = []
  const warnings = []
  const stats = {}
  const buf = fs.readFileSync(rpkPath)
  stats.rpkBytes = buf.length
  let outer
  try {
    outer = readZipEntries(buf)
  } catch (error) {
    return { pass: false, errors: [`rpk 不是可解析的 ZIP：${error.message}`], warnings, stats }
  }
  stats.outerEntries = outer.map((item) => item.name)
  const outerNames = new Set(outer.map((item) => item.name))
  const requireOuter = (name) => {
    if (!outerNames.has(name)) errors.push(`rpk 缺少外层文件：${name}`)
  }
  requireOuter('manifest.json')
  requireOuter('META-INF/CERT')
  requireOuter('META-INF/build.txt')
  const vruEntry = outer.find((item) => /\.vru$/i.test(item.name))
  if (!vruEntry) errors.push('rpk 缺少 .vru 应用包')
  if (outerNames.has('icon.vug')) stats.rootIcon = true

  // 内层 manifest
  let buildManifest = null
  if (outerNames.has('manifest.json')) {
    try {
      const manifestEntry = outer.find((item) => item.name === 'manifest.json')
      buildManifest = JSON.parse(extractZipEntry(buf, manifestEntry).toString('utf8'))
      stats.buildManifest = {
        package: buildManifest.package,
        versionName: buildManifest.versionName,
        entry: buildManifest.router && buildManifest.router.entry,
        pages: buildManifest.router ? Object.keys(buildManifest.router.pages || {}) : [],
        features: (buildManifest.features || []).map((item) => item.name),
      }
    } catch (error) {
      errors.push(`rpk 内 manifest.json 解析失败：${error.message}`)
    }
  }
  let srcManifest = null
  try {
    srcManifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.json'), 'utf8'))
  } catch (error) {
    errors.push(`读取 src/manifest.json 失败：${error.message}`)
  }
  if (buildManifest && srcManifest) {
    if (buildManifest.package !== srcManifest.package) errors.push(`manifest.package: rpk=${buildManifest.package} != src=${srcManifest.package}`)
    if (buildManifest.versionName !== srcManifest.versionName) errors.push(`manifest.versionName: rpk=${buildManifest.versionName} != src=${srcManifest.versionName}`)
    const srcPages = Object.keys((srcManifest.router && srcManifest.router.pages) || {})
    const buildPages = Object.keys((buildManifest.router && buildManifest.router.pages) || {})
    for (const page of srcPages) if (!buildPages.includes(page)) errors.push(`manifest.router.pages 缺少页面：${page}`)
    const srcFeatures = (srcManifest.features || []).map((item) => item.name)
    const buildFeatures = new Set((buildManifest.features || []).map((item) => item.name))
    // blueos-pack 会把能力名归一化为 system.*（实测 1.0.12-beta.13）：
    //   blueos.storage.storage -> system.storage 等，blueos.app.app 保持不变。
    const FEATURE_BUILD_ALIAS = {
      'blueos.storage.storage': 'system.storage',
      'blueos.storage.file': 'system.file',
      'blueos.window.prompt': 'system.prompt',
      'blueos.hardware.display.brightness': 'system.brightness',
      'blueos.app.app': 'blueos.app.app',
    }
    const missingFeatures = []
    for (const feature of srcFeatures) {
      const alias = FEATURE_BUILD_ALIAS[feature]
      if (!buildFeatures.has(feature) && !(alias && buildFeatures.has(alias))) missingFeatures.push(feature)
    }
    missingFeatures.forEach((feature) => errors.push(`manifest.features 缺少能力：${feature}`))
    stats.srcFeatures = srcFeatures
    stats.pages = buildPages
    stats.features = Array.from(buildFeatures)
  }

  if (!vruEntry) return { pass: errors.length === 0, errors, warnings, stats }

  let vru
  try {
    vru = parseVru(extractZipEntry(buf, vruEntry))
  } catch (error) {
    errors.push(`解析 ${vruEntry.name} 失败：${error.message}`)
    return { pass: false, errors, warnings, stats }
  }
  stats.vruFormat = vru.format
  stats.vruEntryCount = vru.entries.length
  const vruNames = new Set(vru.entries.map((item) => item.name))
  const zeroBytes = vru.entries.filter((item) => item.size === 0 && !item.name.endsWith('/'))
  if (zeroBytes.length) errors.push(`vru 中存在 0 字节文件：${zeroBytes.slice(0, 5).map((item) => item.name).join(', ')}`)

  // pages 编译产物（--entry-only 时 packer 只编译入口页，按入口页期望）
  let pageShortNames = srcManifest && srcManifest.router ? Object.keys(srcManifest.router.pages || {}).map((key) => key.replace(/^pages\//, '')) : []
  if (options.entryOnly) {
    const entry = (srcManifest && srcManifest.router && srcManifest.router.entry) || ''
    pageShortNames = [entry.replace(/^pages\//, '')].filter(Boolean)
  }
  let pageFilesFound = 0
  for (const short of pageShortNames) {
    for (const suffix of ['index.js', 'index.template.json', 'index.css.json']) {
      const expected = `pages/${short}/${suffix}`
      if (vruNames.has(expected)) pageFilesFound += 1
      else errors.push(`vru 缺少页面产物：${expected}`)
    }
  }
  stats.pageFilesFound = pageFilesFound
  stats.pageFilesExpected = pageShortNames.length * 3

  // 剧本 JSON（44 分块 + index.json = 45）
  const storyFiles = walkFiles(path.join(SRC_DIR, 'common', 'story'), (name) => name.endsWith('.json'))
  let storyFound = 0
  const storyMissing = []
  for (const rel of storyFiles) {
    const expected = `common/story/${rel}`
    if (vruNames.has(expected)) storyFound += 1
    else storyMissing.push(expected)
  }
  storyMissing.forEach((name) => errors.push(`vru 缺少剧本 JSON：${name}`))
  stats.storyFound = storyFound
  stats.storyExpected = storyFiles.length
  if (storyFiles.length !== 45) warnings.push(`src/common/story 下 JSON 数为 ${storyFiles.length}，预期 45（44 分块 + index）`)

  // 图片：common/img/** 全部随包（galgame 实测 2169/2169 全量进包，不做 tree-shake）；
  //       assets/images 里 home/icon 必须进包（其余未引用资源缺失只警告）。
  const commonImages = walkFiles(path.join(SRC_DIR, 'common', 'img'), (name) => /\.(png|jpg|jpeg|webp)$/i.test(name), path.join(SRC_DIR, 'common'))
  const assetImages = walkFiles(path.join(SRC_DIR, 'assets', 'images'), (name) => /\.(png|jpg|jpeg|webp)$/i.test(name), path.join(SRC_DIR, 'assets'))
  let imageFound = 0
  let imageExpected = 0
  const imageMissing = []
  const imageKeptPng = []
  for (const rel of commonImages) {
    imageExpected += 1
    const expected = `common/${rel.replace(/\.(png|jpg|jpeg|webp)$/i, '.vug')}`
    if (vruNames.has(expected)) imageFound += 1
    else if (vruNames.has(`common/${rel}`)) {
      imageFound += 1
      imageKeptPng.push(`common/${rel}`)
    } else imageMissing.push(expected)
  }
  imageMissing.forEach((name) => errors.push(`vru 缺少图片：${name}`))
  for (const rel of assetImages) {
    imageExpected += 1
    const base = path.basename(rel)
    const nameNoExt = base.replace(/\.(png|jpg|jpeg|webp)$/i, '')
    const expected = `assets/${rel.replace(/\.(png|jpg|jpeg|webp)$/i, '.vug')}`
    const found =
      vruNames.has(expected) ||
      vruNames.has(`assets/${rel}`) ||
      (nameNoExt === 'icon' && outerNames.has('icon.vug'))
    if (found) {
      imageFound += 1
      if (!vruNames.has(expected) && !vruNames.has(`assets/${rel}`)) imageKeptPng.push('root icon.vug')
      else if (!vruNames.has(expected)) imageKeptPng.push(`assets/${rel}`)
    } else if (nameNoExt === 'home' || nameNoExt === 'icon') {
      errors.push(`vru 缺少必需图片：${expected}`)
    } else {
      warnings.push(`vru 缺少未被引用的图片（可能被 tree-shake）：${expected}`)
    }
  }
  if (imageKeptPng.length) warnings.push(`${imageKeptPng.length} 张图片未转 .vug（保留原扩展名/根 icon）：${imageKeptPng.slice(0, 5).join(', ')}`)
  stats.imageFound = imageFound
  stats.imageExpected = imageExpected
  stats.imageCount = {
    commonImg: commonImages.length,
    assetsImages: assetImages.length,
  }
  // icon：manifest.icon 指向 /assets/images/icon.png，打包可能放在根 icon.vug
  const iconFound =
    vruNames.has('assets/images/icon.vug') || vruNames.has('assets/images/icon.png') || outerNames.has('icon.vug')
  if (!iconFound) errors.push('未找到 icon 产物（assets/images/icon.vug 或根 icon.vug）')

  // app 级产物
  for (const required of ['app.js', 'app.css.json']) {
    if (!vruNames.has(required)) errors.push(`vru 缺少应用产物：${required}`)
  }

  // 体积预算（PORT-SPEC §5：rpk 建议 < 16 MiB）
  const rpkMiB = buf.length / (1024 * 1024)
  stats.rpkMiB = Number(rpkMiB.toFixed(2))
  if (rpkMiB > 16) warnings.push(`rpk 体积 ${stats.rpkMiB} MiB，超过建议上限 16 MiB`)

  return { pass: errors.length === 0, errors, warnings, stats }
}


function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return false
  }
}

/** 构建互斥：避免两个 blueos-pack 同时写 build/ 造成随机页面编译错 */
function acquireLock() {
  ensureReportDir()
  if (fs.existsSync(LOCK_FILE)) {
    let info = {}
    try {
      info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
    } catch (error) {
      info = {}
    }
    if (pidAlive(info.pid)) {
      return { ok: false, reason: `已有构建进程在运行（pid=${info.pid}，${info.startedAt || ''}）` }
    }
    try {
      fs.unlinkSync(LOCK_FILE)
    } catch (error) {
      /* ignore */
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8')
  return { ok: true }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE)
  } catch (error) {
    /* ignore */
  }
}

function writeFailureReport(options, log, errorLines, rpk, content) {
  const context = extractErrorContext(errorLines)
  const md = [
    '# 构建首条失败记录（自动生成 by tools/build.mjs）',
    '',
    `- 时间: ${new Date().toISOString()}`,
    `- 设备/模式: ${options.device} / ${options.mode}`,
    `- dist 产物: ${rpk ? rel(rpk.file) : '（未找到新 .rpk）'}`,
    `- 成功标记 "${SUCCESS_MARKER}": ${log.includes(SUCCESS_MARKER) ? '有' : '无'}`,
    '',
    '## 关键错误行（原文）',
    '',
    '```text',
    errorLines.length ? errorLines.join('\n') : '（未匹配到 [ERROR] 行，见下方日志末尾）',
    '```',
    '',
    '## 涉及的页面 / 文件',
    '',
    context.pages.length ? context.pages.map((item) => `- pages/${item}/index.ux`).join('\n') : '- （无法从错误行解析）',
    context.files.length ? context.files.map((item) => `- \`${item}\``).join('\n') : '- （无法从错误行解析）',
    '',
    '## 输出末尾 40 行',
    '',
    '```text',
    tailLines(log, 40),
    '```',
    '',
    `> 完整日志: \`${rel(path.join(REPORT_DIR, `${options.device}-${options.mode}.log`))}\``,
    '',
    '> 说明：构建失败时请让页面作者按上面原文修复（本工具不改 src/）。',
    '',
  ]
  if (content && content.errors && content.errors.length) {
    md.splice(
      5,
      0,
      '## rpk 产物内容断言失败',
      '',
      content.errors.map((item) => `- ${item}`).join('\n'),
      content.warnings && content.warnings.length ? '\n警告：\n\n' + content.warnings.map((item) => `- ${item}`).join('\n') : '',
      ''
    )
  }
  fs.writeFileSync(FIRST_FAILURE_FILE, md.join('\n'), 'utf8')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return Promise.resolve(0)
  }
  if (options.verifyRpk) {
    // 离线校验已有 rpk（不启动 blueos-pack），用于 CI / 人工复查
    console.log(`==== rpk 内容断言：${rel(options.verifyRpk)} ====`)
    if (!fs.existsSync(options.verifyRpk)) {
      console.error(`[verify-rpk] 文件不存在：${options.verifyRpk}`)
      return Promise.resolve(1)
    }
    const result = verifyRpkContents(options.verifyRpk, { entryOnly: options.entryOnly })
    const s = result.stats || {}
    console.log(`格式: ${s.vruFormat || '?'}  外层条目: ${(s.outerEntries || []).length}  vru 条目: ${s.vruEntryCount || 0}  rpk: ${s.rpkMiB || '?'} MiB`)
    console.log(`manifest: ${JSON.stringify(s.buildManifest || null)}`)
    console.log(`页面产物 ${s.pageFilesFound || 0}/${s.pageFilesExpected || 0}；剧本 JSON ${s.storyFound || 0}/${s.storyExpected || 0}；图片 ${s.imageFound || 0}/${s.imageExpected || 0}`)
    result.warnings.forEach((item) => console.log(`  [warning] ${item}`))
    result.errors.forEach((item) => console.log(`  [error] ${item}`))
    console.log(`[verify-rpk] 结果: ${result.pass ? 'PASS' : 'FAIL'}  errors=${result.errors.length} warnings=${result.warnings.length}`)
    try {
      ensureReportDir()
      fs.writeFileSync(path.join(REPORT_DIR, 'verify-rpk.json'), JSON.stringify(result, null, 2), 'utf8')
    } catch (error) {
      /* ignore */
    }
    return Promise.resolve(result.pass ? 0 : 1)
  }
  if (!ALLOWED_DEVICES.includes(options.device)) {
    console.error(`[build] 非法 --device 值：${options.device}（允许 ${ALLOWED_DEVICES.join(' / ')}）`)
    return Promise.resolve(1)
  }

  let packer
  try {
    packer = resolvePacker()
  } catch (error) {
    console.error(`[build] ${error.message}`)
    return Promise.resolve(1)
  }
  const lock = acquireLock()
  if (!lock.ok) {
    console.error(`[build] ❌ ${lock.reason}；拒绝并发构建（blueos-pack 并发会随机报页面编译错）`)
    return Promise.resolve(1)
  }

  const version = readPackerVersion(packer)
  const isDebug = options.mode === 'debug'
  const command = isDebug ? 'build' : 'release'
  const args = [packer, command, '--device-type', options.device]
  // 注意：blueos-pack 的 `--debug` 会把 entries 过滤成「入口页 + app」（getDistFilename 前的
  // `if (globalConfig.debug) delete entries except entry/app`），rpk 里只有 Home。
  // 因此默认 --debug 走 `build`（dev 阶段、不签名）但**不传 --debug**，保证整包页面齐全；
  // 仅 --entry-only 时才透传 packer 的 --debug（IDE 快速预览语义）。
  if (isDebug && options.entryOnly) args.push('--debug')
  if (!options.noForce) args.push('-f')

  ensureReportDir()
  const logFile = path.join(REPORT_DIR, `${options.device}-${options.mode}.log`)
  const jsonFile = path.join(REPORT_DIR, `${options.device}-${options.mode}.json`)

  console.log('==== BlueOS 构建 (tools/build.mjs) ====')
  console.log(`打包器: ${packer}`)
  console.log(`版本:   blueos-pack ${version}`)
  console.log(`命令:   node ${args.map((item) => (item.includes(' ') ? `"${item}"` : item)).join(' ')}`)
  console.log(`模式:   ${isDebug ? 'debug' : 'release'}`)
  console.log(`设备:   ${options.device}（工作目录 ${ROOT}）`)
  console.log(`日志:   ${rel(logFile)}`)
  console.log('')

  const startedAt = Date.now()
  let log = ''
  const appendLog = (text) => {
    log += text
    if (log.length > MAX_LOG_CHARS) log = log.slice(-MAX_LOG_CHARS)
  }

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { VITE_CJS_IGNORE_WARNING: 'true' }),
      })
    } catch (error) {
      releaseLock()
      console.error(`[build] 启动打包器失败：${error.message}`)
      resolve(1)
      return
    }

    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      releaseLock()
      resolve(code)
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      appendLog(text)
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      appendLog(text)
      process.stderr.write(text)
    })
    child.on('error', (error) => {
      appendLog(`\n[build] 无法执行打包器：${error.message}\n`)
      console.error(`\n[build] 无法执行打包器：${error.message}`)
      finish(1)
    })
    child.on('close', (code, signal) => {
      const elapsedMs = Date.now() - startedAt
      const elapsed = (elapsedMs / 1000).toFixed(1)
      const hasMarker = log.includes(SUCCESS_MARKER)
      const rpk = pickRpk(options.device, options.mode, startedAt)
      const errorLines = keyErrorLines(log)
      // 产物内容断言：只有 marker + 新 rpk + 内容齐全 才算真正成功
      let content = null
      if (hasMarker && rpk && options.contentCheck) {
        try {
          content = verifyRpkContents(rpk.file, { entryOnly: options.entryOnly })
        } catch (error) {
          content = { pass: false, errors: [`rpk 内容断言异常：${error.message}`], warnings: [], stats: {} }
        }
      }
      const contentOk = !options.contentCheck || (content && content.pass)
      const ok = hasMarker && !!rpk && contentOk

      // 完整日志落盘（即使失败也要保留）
      try {
        fs.writeFileSync(logFile, log, 'utf8')
      } catch (error) {
        console.error(`[build] 写日志失败：${error.message}`)
      }

      const summary = {
        tool: 'tools/build.mjs',
        packer,
        packerVersion: version,
        device: options.device,
        mode: options.mode,
        command: args.join(' '),
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs,
        exitCode: code,
        signal: signal || null,
        hasSuccessMarker: hasMarker,
        contentCheckEnabled: options.contentCheck,
        entryOnly: options.entryOnly,
        rpk: rpk
          ? { file: rel(rpk.file), size: rpk.size, sizeText: formatBytes(rpk.size), fresh: rpk.fresh, mtime: new Date(rpk.mtimeMs).toISOString() }
          : null,
        rpkContents: content,
        errorLines,
        pass: ok,
        logFile: rel(logFile),
      }
      try {
        fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2), 'utf8')
      } catch (error) {
        console.error(`[build] 写 JSON 摘要失败：${error.message}`)
      }

      console.log('')
      if (ok) {
        console.log(`[build] ✅ 构建成功（${elapsed}s，进程退出码 ${code}）`)
        console.log(`[build] rpk: ${rel(rpk.file)}`)
        console.log(`[build] 大小: ${(rpk.size / (1024 * 1024)).toFixed(2)} MB（${formatBytes(rpk.size)}）`)
        if (content) {
          const s = content.stats || {}
          console.log('[build] rpk 内容抽查：')
          console.log(
            `        外层 ${Array.isArray(s.outerEntries) ? s.outerEntries.length : '?'} 项；vru ${s.vruEntryCount || 0} 项（格式 ${s.vruFormat || '?'}）`
          )
          console.log(`        manifest: package=${s.buildManifest ? s.buildManifest.package : '?'} pages=${s.buildManifest ? s.buildManifest.pages.length : '?'} features=${s.buildManifest ? s.buildManifest.features.join(',') : '?'}`)
          console.log(`        页面产物 ${s.pageFilesFound}/${s.pageFilesExpected}；剧本 JSON ${s.storyFound}/${s.storyExpected}；图片 ${s.imageFound}/${s.imageExpected}（rpk ${s.rpkMiB || '?'} MiB）`)
          if (content.warnings.length) content.warnings.forEach((item) => console.log(`        [warning] ${item}`))
        }
        console.log(`[build] 日志: ${rel(logFile)}`)
        console.log(`[build] 摘要: ${rel(jsonFile)}`)
        finish(0)
        return
      }

      if (signal) console.error(`[build] 打包进程被信号终止：${signal}`)
      if (!hasMarker) {
        console.error(`[build] ❌ 未检测到成功标记 "${SUCCESS_MARKER}"（进程退出码 ${code}）`)
      } else if (!rpk) {
        console.error(`[build] ❌ 编译已结束但 dist/${options.device} 下没有找到新的 .rpk 产物`)
      } else {
        console.error('[build] ❌ rpk 产物内容断言失败：')
        if (content) content.errors.forEach((item) => console.error(`  [content-error] ${item}`))
      }
      if (errorLines.length > 0) {
        console.error('[build] 关键错误行：')
        errorLines.forEach((line) => console.error(`  ${line}`))
        console.error('[build] 输出末尾：')
        console.error(tailLines(log, 20))
      } else {
        console.error('[build] 输出末尾：')
        console.error(tailLines(log, 30))
      }
      try {
        writeFailureReport(options, log, errorLines, rpk, content)
        console.error(`[build] 失败摘要已写入: ${rel(FIRST_FAILURE_FILE)}`)
      } catch (error) {
        console.error(`[build] 写 FIRST-FAILURE.md 失败：${error.message}`)
      }
      console.error(`[build] 完整日志: ${rel(logFile)}`)
      finish(1)
    })
  })
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    releaseLock()
    console.error('[build] 未捕获异常：', error)
    process.exit(1)
  })
