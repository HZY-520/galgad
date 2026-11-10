#!/usr/bin/env node
/**
 * test-game-page.mjs —— Game 页「运行时」全链路测试（Node 侧真实执行页面脚本）。
 *
 * 为什么需要它：引擎纯逻辑测试（test-engine）与静态校验都无法发现
 * 「页面方法名拼错 / 漏定义 / 定时器回调里调错方法」这类运行时异常。
 * 实测事故：真机点屏幕报 `JSError:not a function  at onTap`，字幕卡住不动
 * —— onTap 里调用了已改名的 this.onHoldEnd()。本测试把 Game 页的 <script>
 * 原样搬到临时 ESM 工程里，用 stub 替换 @blueos.* 模块与定时器，然后**真实驱动**
 * 点击 / 长按 / 滑动 / 菜单 / 选项 / 结局 / 设置切换，任何抛出的异常都会失败。
 *
 * 用法：node tools/test-game-page.mjs [--taps 600]
 * 退出码：0 = PASS；1 = 有失败。
 */
'use strict'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const PAGE_UX = path.join(SRC, 'pages', 'Game', 'index.ux')

// ------------------------------------------------------------------ 假定时器
const clock = {
  now: 1700000000000,
  timers: new Map(),
  nextId: 1,
}

function installFakeTimers() {
  globalThis.setTimeout = (fn, ms) => {
    const id = clock.nextId++
    clock.timers.set(id, { fn, at: clock.now + (Number(ms) || 0), interval: 0 })
    return id
  }
  globalThis.clearTimeout = (id) => { clock.timers.delete(id) }
  globalThis.setInterval = (fn, ms) => {
    const id = clock.nextId++
    clock.timers.set(id, { fn, at: clock.now + (Number(ms) || 0), interval: Number(ms) || 1 })
    return id
  }
  globalThis.clearInterval = (id) => { clock.timers.delete(id) }
  const realNow = Date.now
  Date.now = () => clock.now
  return realNow
}

/** 推进假时钟，按时间顺序执行到期的定时器回调（回调抛异常直接上抛） */
function tick(ms) {
  const target = clock.now + ms
  for (let guard = 0; guard < 100000; guard += 1) {
    let dueId = 0
    let dueAt = Infinity
    for (const [id, t] of clock.timers) {
      if (t.at <= target && t.at < dueAt) { dueId = id; dueAt = t.at }
    }
    if (!dueId) break
    const t = clock.timers.get(dueId)
    clock.now = t.at
    if (t.interval) t.at = clock.now + t.interval
    else clock.timers.delete(dueId)
    t.fn()
  }
  clock.now = target
}

function pendingTimers() {
  return clock.timers.size
}

// ------------------------------------------------------------------ 临时工程
function extractScript(uxText) {
  const m = uxText.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('Game/index.ux 缺少 <script> 段')
  return m[1]
}

const STUBS = {
  'stub-router.js': `const calls = []
export default {
  push(o) { calls.push({ type: 'push', uri: o && o.uri, params: o && o.params }) },
  replace(o) { calls.push({ type: 'replace', uri: o && o.uri, params: o && o.params }) },
  back() { calls.push({ type: 'back' }) },
  getState() { return { index: 1, name: 'pages/Game', path: '/pages/Game' } },
  __calls: calls,
}
`,
  'stub-prompt.js': `const toasts = []
export default {
  showToast(o) { toasts.push(String((o && o.message) || '')) },
  __toasts: toasts,
}
`,
  'stub-brightness.js': `const calls = []
export default {
  setKeepScreenOn(o) { calls.push(!!(o && o.keepScreenOn)) },
  __calls: calls,
}
`,
  'stub-storage.js': `const map = new Map()
export default {
  get(o) {
    const key = o && o.key
    const value = map.has(key) ? map.get(key) : (o && o.default !== undefined ? o.default : '')
    if (o && o.success) o.success(value)
  },
  set(o) {
    if (o && typeof o.value === 'string' && o.value === '') map.delete(o.key)
    else map.set(o.key, o.value)
    if (o && o.success) o.success()
  },
  delete(o) { map.delete(o.key); if (o && o.success) o.success() },
  clear() { map.clear() },
  __map: map,
}
`,
  'stub-file.js': `import fs from 'node:fs'
const SRC = ${JSON.stringify(SRC.replace(/\\/g, '/'))}
const reads = []
export default {
  readText(o) {
    const uri = String((o && o.uri) || '')
    const rel = uri.replace(/^\\//, '')
    const file = SRC + '/' + rel
    try {
      const text = fs.readFileSync(file, 'utf8')
      reads.push(uri)
      if (o && o.success) o.success({ text })
    } catch (error) {
      if (o && o.fail) o.fail(error.message, 301)
    }
  },
  __reads: reads,
}
`,
}

/** 把页面 script 的 import 改写到临时工程里的本地文件 */
function rewriteImports(script) {
  const map = {
    '@blueos.app.appmanager.router': './stub-router.js',
    '@blueos.window.prompt': './stub-prompt.js',
    '@blueos.hardware.display.brightness': './stub-brightness.js',
    '@blueos.storage.storage': './stub-storage.js',
    '@blueos.storage.file': './stub-file.js',
    '../../common/layout.js': './layout.js',
    '../../common/reader.js': './reader.js',
    '../../common/engine.js': './engine.js',
    '../../common/story.js': './story.js',
    '../../common/asset.js': './asset.js',
    '../../common/assets.js': './assets.js',
    '../../common/cglist.js': './cglist.js',
  }
  let out = script
  for (const [from, to] of Object.entries(map)) {
    out = out.split("'" + from + "'").join("'" + to + "'")
  }
  // 残留的 @blueos.* 一律报错，避免静默漏改
  const left = out.match(/from\s+'(@blueos[^']*)'/g)
  if (left) throw new Error('还有未映射的 @blueos 导入：' + left.join(', '))
  return out
}

function prepareWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galgad-game-page-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  for (const [name, code] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, name), code, 'utf8')
  }
  // 公共模块：原样复制，只把 @blueos.* 换成 stub
  const commonFiles = ['layout.js', 'reader.js', 'engine.js', 'story.js', 'asset.js', 'assets.js', 'cglist.js']
  for (const name of commonFiles) {
    let code = fs.readFileSync(path.join(SRC, 'common', name), 'utf8')
    code = code.split("'@blueos.storage.storage'").join("'./stub-storage.js'")
    code = code.split("'@blueos.storage.file'").join("'./stub-file.js'")
    code = code.split("'@blueos.window.prompt'").join("'./stub-prompt.js'")
    code = code.split("'@blueos.app.appmanager.router'").join("'./stub-router.js'")
    code = code.split("'@blueos.hardware.display.brightness'").join("'./stub-brightness.js'")
    fs.writeFileSync(path.join(dir, name), code, 'utf8')
  }
  const ux = fs.readFileSync(PAGE_UX, 'utf8')
  fs.writeFileSync(path.join(dir, 'page.mjs'), rewriteImports(extractScript(ux)), 'utf8')
  return dir
}

/** 用页面对象字面量造一个「页面实例」：方法挂到 this，data 字段各自拷贝 */
function makeInstance(def, deviceType) {
  const inst = {}
  for (const key of Object.keys(def)) inst[key] = def[key]
  const data = def.data || {}
  for (const key of Object.keys(data)) {
    const value = data[key]
    inst[key] = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  }
  inst.$device = { deviceType }
  inst.$app = { exit() { inst.__exited = (inst.__exited || 0) + 1 } }
  return inst
}

// ------------------------------------------------------------------ 测试主体
const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  → ${detail}` : ''))
}

function guard(label, fn) {
  try {
    fn()
    return null
  } catch (error) {
    const msg = `${label}: ${error && error.message ? error.message : error}`
    check(false, msg)
    return error
  }
}

async function main() {
  const realNow = installFakeTimers()
  const dir = prepareWorkspace()
  const mod = await import(pathToFileURL(path.join(dir, 'page.mjs')).href)
  const def = mod.default
  const router = (await import(pathToFileURL(path.join(dir, 'stub-router.js')).href)).default
  const prompt = (await import(pathToFileURL(path.join(dir, 'stub-prompt.js')).href)).default
  const brightness = (await import(pathToFileURL(path.join(dir, 'stub-brightness.js')).href)).default
  const storage = (await import(pathToFileURL(path.join(dir, 'stub-storage.js')).href)).default

  console.log('==== Game 页运行时全链路测试 (tools/test-game-page.mjs) ====')
  console.log(`页面脚本: ${path.relative(ROOT, PAGE_UX).replace(/\\/g, '/')}  临时工程: ${dir}`)
  console.log('')

  const page = makeInstance(def, 'watch-square')

  // ---------------- 0. 模板结构：顶部「≡」菜单按钮必须存在且在点击层之后
  const uxText = fs.readFileSync(PAGE_UX, 'utf8')
  const tapIdx = uxText.indexOf('class="tap-layer"')
  const fabIdx = uxText.indexOf('class="menu-fab')
  check(tapIdx > 0, '模板存在阅读点击层 .tap-layer')
  check(fabIdx > 0, '模板存在顶部「≡」菜单按钮 .menu-fab（真机反馈：没有菜单入口）')
  check(fabIdx > tapIdx, '「≡」按钮在 DOM 顺序上位于点击层之后（否则点击被点击层吃掉）')
  check(/menu-fab[\s\S]{0,160}?@click="openMenu"/.test(uxText), '「≡」按钮绑定 @click="openMenu"')

  // ---------------- 1. 首次进入（新游戏）
  let err = guard('onInit', () => page.onInit())
  if (!err) err = guard('onReady', () => page.onReady())
  check(!err, 'onInit / onReady 不抛异常')
  check(page.layoutClass === 'square', '方屏布局类生效（watch-square → .square）', `layoutClass=${JSON.stringify(page.layoutClass)}`)

  tick(3000)  // 走完打字机 + 各类定时器
  check(typeof page.pageText === 'string' && page.pageText.length > 0,
    '进入阅读后首句已渲染', `pageText=${JSON.stringify((page.pageText || '').slice(0, 18))}…`)
  check(page.canTap === true, '打字机结束后允许翻页（canTap=true）')
  check(page.chapterTitle !== '——', '顶部章节信息已更新', page.chapterTitle + ' · ' + page.progress)
  check(prompt.__toasts.length === 0, '进入阅读过程中没有 toast 报错', prompt.__toasts.join('|'))
  check(brightness.__calls.length > 0, '调用了屏幕常亮接口', `calls=${JSON.stringify(brightness.__calls)}`)

  // ---------------- 2. 点击推进（本次事故的直接回归）
  const before = page.pageText
  let tapError = null
  for (let i = 0; i < 60 && !tapError; i += 1) {
    tapError = guard('onTap#' + i, () => { page.onTap(); tick(400) })
  }
  check(!tapError, '连续 60 次 onTap 点击均不抛异常（回归 not a function）')
  check(page.pageText !== before || page.choices.length > 0 || !!page.endText,
    '点击后字幕/状态有推进', `页面: ${JSON.stringify((page.pageText || '').slice(0, 14))}`)

  // ---------------- 3. 一路点到选项 → 分支 → 结局
  let steps = 0
  let sawChoice = false
  let sawEnd = false
  let loopError = null
  while (steps < 20000 && !loopError) {
    steps += 1
    loopError = guard('advance-loop#' + steps, () => {
      if (page.choices.length) {
        sawChoice = true
        page.pickChoice(0)
      } else if (page.endText) {
        sawEnd = true
      } else {
        page.onTap()
      }
      // 每步给足打字机时间（字号 20 / 速度 28ms 时一句最多约 3 秒）
      tick(1200)
    })
    if (sawEnd) break
  }
  check(!loopError, `点击推进 ${steps} 步不抛异常`)
  check(sawChoice, '推进过程中出现了选项分支')
  check(sawEnd, '一路点击可以走到结局', page.endText ? JSON.stringify(page.endText) : '')
  check(prompt.__toasts.every((t) => typeof t === 'string'), 'toast 调用参数合法', prompt.__toasts.join('|'))

  // ---------------- 4. 阅读菜单全按钮（不抛异常）
  const page2 = makeInstance(def, 'watch-round')
  guard('onInit#2', () => page2.onInit())
  guard('onReady#2', () => page2.onReady())
  tick(2000)
  check(page2.layoutClass === '', '圆屏布局类为空（watch-round）')
  err = guard('菜单全按钮', () => {
    page2.openMenu(); check(page2.menu === true, '开菜单菜单可见')
    page2.toggleAuto(); check(page2.autoOn === true, '自动播放开关打开')
    page2.openMenu(); page2.toggleAuto(); check(page2.autoOn === false, '自动播放开关关闭')
    page2.openMenu(); page2.toggleFast(); check(page2.fastOn === true, '快进开关打开')
    page2.openMenu(); page2.toggleFast(); check(page2.fastOn === false, '快进开关关闭')
    page2.openMenu(); page2.nextChapter()
    page2.openMenu(); page2.rewind(); page2.stopRewindRepeat()
    page2.openMenu(); page2.goSave()
    page2.openMenu(); page2.goLoad()
    page2.openMenu(); page2.goChapters()
    page2.openMenu(); page2.goGallery()
    page2.openMenu(); page2.goSettings()
    page2.openMenu(); page2.goHome()
    page2.openMenu(); page2.closeMenu()
  })
  check(!err, '阅读菜单 12 个按钮调用均不抛异常')
  const routes = router.__calls.map((c) => c.type + ':' + (c.uri || ''))
  check(routes.some((r) => r.includes('replace:') && r.includes('pages/Home')), '「主页」按钮走 router.replace 回主页', routes.slice(-4).join(' , '))
  check(routes.some((r) => r.startsWith('push:') && r.includes('pages/Saves')), '「保存/读取」跳转存档页', routes.filter((r) => r.includes('Saves')).join(' , '))

  // ---------------- 5. 触摸手势：下滑开菜单 / 右滑快退 / 长按快进
  const page3 = makeInstance(def, 'watch-round')
  guard('onInit#3', () => page3.onInit())
  guard('onReady#3', () => page3.onReady())
  tick(2000)
  err = guard('手势：下滑开菜单', () => {
    page3.onTouchStart({ touches: [{ clientX: 200, clientY: 100 }] })
    page3.onTouchEnd({ changedTouches: [{ clientX: 205, clientY: 200 }] })
  })
  check(!err && page3.menu === true, '下滑 100px 打开阅读菜单')
  page3.closeMenu()
  tick(300)
  const pcBefore = page3.pageText
  err = guard('手势：右滑快退', () => {
    page3.onTouchStart({ touches: [{ clientX: 100, clientY: 200 }] })
    page3.onTouchEnd({ changedTouches: [{ clientX: 220, clientY: 205 }] })
    tick(400)
  })
  check(!err, '右滑 120px 快退不抛异常', `字幕前: ${JSON.stringify((pcBefore || '').slice(0, 10))}`)

  err = guard('长按快进', () => {
    // 通过真实设置链路生效：写入 storage 的 settings 键后再 onShow 让页面读回
    storage.__map.set('settings', JSON.stringify({ size: 20, speed: 28, autoMs: 0, keepOn: true, longpress: 'fast' }))
    page3.onShow()
    tick(200)
    page3.onTouchStart({ touches: [{ clientX: 200, clientY: 200 }] })
    tick(600)           // 超过 HOLD_MS=450
    check(page3.fastOn === true, '按住 450ms 后进入快进')
    page3.onTouchEnd({ changedTouches: [{ clientX: 200, clientY: 200 }] })
    tick(100)
    check(page3.fastOn === false, '松手后退出快进')
    storage.__map.delete('settings')
  })
  check(!err, '「按住快进」全流程不抛异常')

  // ---------------- 6. 字号切换后重排 + 结局页返回
  const page4 = makeInstance(def, 'watch-round')
  guard('onInit#4', () => page4.onInit())
  guard('onReady#4', () => page4.onReady())
  tick(2000)
  check(/font-size: 20px/.test(page4.lineStyle), '默认字号 20 生效', page4.lineStyle)
  err = guard('字号 30 重排', () => {
    // 真实链路：设置页写 storage 的 settings（size:30），回到 Game 触发 onShow
    storage.__map.set('settings', JSON.stringify({ size: 30, speed: 28, autoMs: 0, keepOn: true, longpress: 'off' }))
    page4.onShow()
    tick(500)
  })
  check(!err, '从设置页返回（字号 30）触发重排不抛异常')
  check(/font-size: 30px/.test(page4.lineStyle), '字号 30 已被应用到正文行内样式（onShow 生效）', page4.lineStyle)
  check(typeof page4.pageText === 'string' && page4.pageText.length > 0, '重排后仍然渲染出完整字幕',
    JSON.stringify((page4.pageText || '').slice(0, 12)))
  storage.__map.delete('settings')
  err = guard('结局页返回', () => {
    page4.endText = '—— 全剧终 ——'
    page4.onTap()
  })
  check(!err, '结局页点击返回主页不抛异常')
  check(router.__calls.some((c) => c.type === 'replace' && String(c.uri).includes('pages/Home')), '结局页 replace 到主页')

  // ---------------- 7. 存档链路：自动存档继续 / 手动槽读取 / 章节跳转
  const page5 = makeInstance(def, 'watch-round')
  guard('onInit#5', () => page5.onInit())
  guard('onReady#5', () => page5.onReady())
  tick(2000)
  for (let i = 0; i < 12; i += 1) { guard('tap#5-' + i, () => { page5.onTap(); tick(800) }) }
  guard('onHide#5', () => page5.onHide())   // 触发自动存档落盘
  check(storage.__map.has('autoSave'), 'onHide 触发自动存档落盘（autoSave 键存在）')
  const autoData = JSON.parse(storage.__map.get('autoSave') || 'null')
  check(autoData && autoData.magic === 'galgod-band-1' && autoData.pc > 0,
    '自动存档内容合法（magic + pc > 0）', `pc=${autoData && autoData.pc}`)

  const page6 = makeInstance(def, 'watch-round')
  page6.auto = '1'                      // 相当于 router.push({params:{auto:'1'}})
  guard('onInit#6', () => page6.onInit())
  guard('onReady#6', () => page6.onReady())
  tick(2500)
  check(typeof page6.pageText === 'string' && page6.pageText.length > 0,
    '「继续阅读」从自动存档恢复并渲染出字幕', JSON.stringify((page6.pageText || '').slice(0, 14)))
  check(page6.chapterTitle !== '——', '恢复后章节信息已更新', page6.chapterTitle)

  // 手动存档槽：从存档页点「读取」→ router.replace(load:'0')
  const manualSave = JSON.parse(JSON.stringify(autoData))
  manualSave.chapter = 2
  storage.__map.set('saves', JSON.stringify([manualSave, null, null, null, null, null]))
  const page7 = makeInstance(def, 'watch-round')
  page7.load = '0'
  guard('onInit#7', () => page7.onInit())
  guard('onReady#7', () => page7.onReady())
  tick(2500)
  check(typeof page7.pageText === 'string' && page7.pageText.length > 0, '从手动存档槽 0 读档并渲染出字幕',
    JSON.stringify((page7.pageText || '').slice(0, 14)))

  // 章节跳转：router.replace({at:'381'})（第 2 章起点附近）
  const page8 = makeInstance(def, 'watch-round')
  page8.at = '381'
  guard('onInit#8', () => page8.onInit())
  guard('onReady#8', () => page8.onReady())
  tick(2500)
  check(typeof page8.pageText === 'string' && page8.pageText.length > 0, '按 at 参数跳到指定节点并渲染',
    JSON.stringify((page8.pageText || '').slice(0, 14)))
  check(page8.chapterTitle.indexOf('第一幕') === 0 || page8.chapterTitle.indexOf('第二幕') === 0,
    '跳转后章节标题落在预期范围', page8.chapterTitle)

  // ---------------- 8. 生命周期收尾
  err = guard('onHide / onDestroy', () => { page8.onHide(); page8.onDestroy() })
  check(!err, 'onHide / onDestroy 不抛异常')
  check(pendingTimers() === 0, 'onDestroy 后没有残留定时器', `pending=${pendingTimers()}`)

  // ---------------- 汇总
  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`[test-game-page] 结果: ${failed.length === 0 ? 'PASS' : 'FAIL'}  checks=${results.length} failures=${failed.length}`)
  fs.mkdirSync(path.join(ROOT, 'scripts', 'reports'), { recursive: true })
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'reports', 'test-game-page.json'),
    JSON.stringify({ tool: 'tools/test-game-page.mjs', checks: results.length, failures: failed.length, results, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
  Date.now = realNow
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('[test-game-page] 未捕获异常：', error)
  process.exit(1)
})
