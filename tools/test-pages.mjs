#!/usr/bin/env node
/**
 * test-pages.mjs —— 其余 6 个页面（Home / Saves / Chapters / Gallery / Settings / About）
 * 的「运行时」全链路测试（Node 侧真实执行页面脚本）。
 *
 * 为什么需要它：静态校验（tools/check-methods.mjs）只能证明「方法名存在」，
 * 引擎/公共模块测试（test-engine / test-reader）只能证明纯逻辑正确，都不覆盖
 * 「页面对象在真实生命周期里被调用时会不会抛异常、绑定的字段对不对」。
 * 真机事故（Game 页 onTap 里调了不存在的 this.onHoldEnd()）与后续的第二个真 bug
 * （Game 页 st.booted 从未置 true）都是这类问题，由 tools/test-game-page.mjs 抓到。
 * 本工具沿用同一套做法，把 6 个页面的 <script> 原样搬到临时 ESM 工程里，
 * stub 掉 @blueos.*（router / prompt / brightness / storage / file）与定时器 +
 * Date.now，然后**真实驱动**每个页面的生命周期与交互（点击 / 长按 / 拖动 /
 * 模式切换 / 防抖 / 彩蛋），断言页面绑定的字段、路由调用、storage 落盘内容。
 *
 * 不 mock engine / reader / story / asset / cglist：这些公共模块以真实代码参与运行，
 * 页面跑的是真实剧本索引、真实 CGLIST、真实设置归一化与真实存档格式。
 *
 * 用法：node tools/test-pages.mjs
 * 退出码：0 = 全 PASS；1 = 有失败。
 * 报告：scripts/reports/test-pages.json（结构同 test-game-page.json，另加 pages 分页统计）。
 *
 * 只读 src/，不改任何页面；页面若有真实 bug，只报出来（见输出末尾「发现问题」）。
 */
'use strict'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const REPORT = path.join(ROOT, 'scripts', 'reports', 'test-pages.json')

/** 被测页面（顺序即输出顺序） */
const PAGE_NAMES = ['Home', 'Saves', 'Chapters', 'Gallery', 'Settings', 'About']

/** 原样复制进临时工程的公共模块（只把 @blueos.* 换成 stub） */
const COMMON_FILES = ['layout.js', 'reader.js', 'engine.js', 'story.js', 'asset.js', 'assets.js', 'cglist.js']

/** 页面 / 公共模块里的 @blueos 模块 → stub 文件名 */
const BLUEOS_STUBS = [
  ['@blueos.app.appmanager.router', './stub-router.js'],
  ['@blueos.window.prompt', './stub-prompt.js'],
  ['@blueos.hardware.display.brightness', './stub-brightness.js'],
  ['@blueos.storage.storage', './stub-storage.js'],
  ['@blueos.storage.file', './stub-file.js'],
]

/** 页面脚本里的公共模块相对路径 → 临时工程里的本地文件 */
const COMMON_IMPORTS = COMMON_FILES.map((name) => ['../../common/' + name, './' + name])

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
  for (let guardLoop = 0; guardLoop < 100000; guardLoop += 1) {
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

function resetTimers() {
  clock.timers.clear()
  clock.now = 1700000000000
}

// ------------------------------------------------------------------ stub 模块
const STUBS = {
  'stub-router.js': `const calls = []
export default {
  push(o) { calls.push({ type: 'push', uri: o && o.uri, params: o && o.params }) },
  replace(o) { calls.push({ type: 'replace', uri: o && o.uri, params: o && o.params }) },
  back() { calls.push({ type: 'back' }) },
  getState() { return { index: 1, name: 'pages/Test', path: '/pages/Test' } },
  __calls: calls,
  __reset() { calls.length = 0 },
}
`,
  'stub-prompt.js': `const toasts = []
export default {
  showToast(o) { toasts.push(String((o && o.message) || '')) },
  __toasts: toasts,
  __reset() { toasts.length = 0 },
}
`,
  'stub-brightness.js': `const calls = []
export default {
  setKeepScreenOn(o) { calls.push(!!(o && o.keepScreenOn)) },
  __calls: calls,
  __reset() { calls.length = 0 },
}
`,
  // storage：内存 map + 调用记录（用于断言「onInit 不触碰 storage」「防抖只写一次」）
  'stub-storage.js': `const map = new Map()
const calls = []
function record(op, key) { calls.push({ op: op, key: String(key === undefined ? '' : key) }) }
export default {
  get(o) {
    const key = o && o.key
    record('get', key)
    const value = map.has(key) ? map.get(key) : (o && o.default !== undefined ? o.default : '')
    if (o && o.success) o.success(value)
  },
  set(o) {
    record('set', o && o.key)
    if (o && typeof o.value === 'string' && o.value === '') map.delete(o.key)
    else map.set(o.key, o.value)
    if (o && o.success) o.success()
  },
  delete(o) { record('delete', o && o.key); map.delete(o.key); if (o && o.success) o.success() },
  clear() { map.clear() },
  __map: map,
  __calls: calls,
  __reset() { calls.length = 0 },
}
`,
  // file：读真实 src 目录（支持 /common/story/index.json 这类资源路径）；
  // __state.down 可模拟「索引读取失败」分支；__state.bad 可精确指定失败的 URI。
  'stub-file.js': `import fs from 'node:fs'
const SRC = ${JSON.stringify(SRC.replace(/\\/g, '/'))}
const reads = []
const state = { down: false, bad: [] }
export default {
  readText(o) {
    const uri = String((o && o.uri) || '')
    if (state.down || state.bad.indexOf(uri) >= 0) {
      if (o && o.fail) o.fail('mock file unavailable', 301)
      return
    }
    const file = SRC + '/' + uri.replace(/^\\//, '')
    try {
      const text = fs.readFileSync(file, 'utf8')
      reads.push(uri)
      if (o && o.success) o.success({ text })
    } catch (error) {
      if (o && o.fail) o.fail(error.message, 301)
    }
  },
  __reads: reads,
  __state: state,
  __reset() { reads.length = 0; state.down = false; state.bad.length = 0 },
}
`,
}

/** 把页面 script 的 import 改写到临时工程里的本地文件 */
function rewriteImports(script, pageName) {
  let out = script
  for (const [from, to] of BLUEOS_STUBS.concat(COMMON_IMPORTS)) {
    out = out.split("'" + from + "'").join("'" + to + "'")
  }
  // 残留的 @blueos.* 一律报错，避免静默漏改
  const left = out.match(/from\s+'(@blueos[^']*)'/g)
  if (left) throw new Error(pageName + '/index.ux 还有未映射的 @blueos 导入：' + left.join(', '))
  return out
}

function extractScript(uxText, pageName) {
  const m = uxText.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error(pageName + '/index.ux 缺少 <script> 段')
  return m[1]
}

function prepareWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galgad-pages-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  for (const [name, code] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, name), code, 'utf8')
  }
  // 公共模块：原样复制，只把 @blueos.* 换成 stub
  for (const name of COMMON_FILES) {
    let code = fs.readFileSync(path.join(SRC, 'common', name), 'utf8')
    for (const [from, to] of BLUEOS_STUBS) code = code.split("'" + from + "'").join("'" + to + "'")
    fs.writeFileSync(path.join(dir, name), code, 'utf8')
  }
  // 6 个页面各自的 <script>
  for (const name of PAGE_NAMES) {
    const ux = fs.readFileSync(path.join(SRC, 'pages', name, 'index.ux'), 'utf8')
    fs.writeFileSync(path.join(dir, name + '.mjs'), rewriteImports(extractScript(ux, name), name), 'utf8')
  }
  return dir
}

/** 用页面对象字面量造一个「页面实例」：方法挂到 this，data 字段各自深拷贝 */
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

// ------------------------------------------------------------------ 断言框架
const results = []
let currentPage = ''
const issues = []

function check(ok, name, detail) {
  results.push({ page: currentPage, ok: !!ok, name, detail: detail === undefined ? '' : String(detail) })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  → ${detail}` : ''))
  return !!ok
}

function guard(label, fn) {
  try {
    fn()
    return null
  } catch (error) {
    const msg = `${label}: ${error && error.message ? error.message : error}`
    check(false, msg, error && error.stack ? String(error.stack).split('\n')[1].trim() : '')
    return error
  }
}

function banner(name) {
  console.log('')
  console.log(`---------- ${name} ----------`)
}

function lastCall(list) {
  return list.length ? list[list.length - 1] : null
}

/** storage stub 的调用次数：op = 'get' | 'set' | 'delete'，key 省略 = 全部 */
function ops(env, op, key) {
  return env.storage.__calls.filter(
    (c) => c.op === op && (key === undefined || c.key === key)
  ).length
}

const SAVE_MAGIC = 'galgod-band-1'

/** 写存档 / 自动存档用的最小合法快照（字段与 engine.collectSave 一致） */
function makeSave(patch) {
  return Object.assign({
    magic: SAVE_MAGIC,
    pc: 0,
    chapter: 0,
    flags: {},
    bgSrc: '',
    showBlack: true,
    showWhite: false,
    cs: [],
    cgSrc: '',
    tint: '',
    text: '',
    at: 1,
  }, patch || {})
}

function putAuto(storage, patch) {
  storage.__map.set('autoSave', JSON.stringify(makeSave(patch)))
}

/** 每次切页前把 5 个 stub + 假定时器全部复位，避免页面之间互相污染 */
function resetAll(env) {
  env.storage.__map.clear()
  env.storage.__reset()
  env.router.__reset()
  env.prompt.__reset()
  env.brightness.__reset()
  env.file.__reset()
  resetTimers()
}

// ================================================================== Home
async function testHome(env) {
  const { def, storage, router, prompt } = env

  // ---- 1. 无自动存档
  const p1 = makeInstance(def, 'watch-round')
  let err = guard('Home.onInit', () => p1.onInit())
  if (!err) err = guard('Home.onReady', () => p1.onReady())
  check(!err, 'onInit / onReady 不抛异常')
  check(p1.hasAuto === false && p1.autoText === '——',
    '无自动存档：hasAuto=false、autoText=「——」',
    `hasAuto=${p1.hasAuto} autoText=${JSON.stringify(p1.autoText)}`)

  // ---- 2. onShow / onRefresh 都会重新读自动存档
  putAuto(storage, { pc: 210, chapter: 1 })
  err = guard('Home.onShow', () => p1.onShow())
  check(!err && p1.hasAuto === true && p1.autoText === '第2章',
    'onShow 读到自动存档后刷新为「第2章」',
    `hasAuto=${p1.hasAuto} autoText=${JSON.stringify(p1.autoText)}`)
  storage.__map.delete('autoSave')
  err = guard('Home.onRefresh', () => p1.onRefresh())
  check(!err && p1.hasAuto === false && p1.autoText === '——',
    'onRefresh 在自动存档消失后复位',
    `hasAuto=${p1.hasAuto} autoText=${JSON.stringify(p1.autoText)}`)

  // ---- 3. 非法自动存档不算「有进度」
  storage.__map.set('autoSave', JSON.stringify({ magic: 'not-galgod', pc: 100, chapter: 0 }))
  p1.onShow()
  check(p1.hasAuto === false, 'magic 不匹配的自动存档被忽略')
  storage.__map.set('autoSave', JSON.stringify({ magic: SAVE_MAGIC, pc: -1, chapter: 0 }))
  p1.onShow()
  check(p1.hasAuto === false, 'pc<0 的自动存档被忽略')

  // ---- 4. 无存档时的按钮
  router.__reset()
  const pOnly = makeInstance(def, 'watch-round')
  pOnly.onInit()
  pOnly.onReady()
  check(pOnly.hasAuto === false, '（前置）pOnly 无自动存档')
  pOnly.onNewGame()
  check(lastCall(router.__calls) && lastCall(router.__calls).uri === '/pages/Game' &&
    !lastCall(router.__calls).params,
    '「开始阅读」→ push /pages/Game（不带参数）',
    JSON.stringify(lastCall(router.__calls)))
  router.__reset()
  pOnly.onContinue()
  check(lastCall(router.__calls) && lastCall(router.__calls).uri === '/pages/Game' &&
    !lastCall(router.__calls).params,
    '无存档时「继续阅读」退化为开始新游戏（/pages/Game 无 auto 参数）',
    JSON.stringify(lastCall(router.__calls)))

  // ---- 5. 有存档时的按钮
  const pAuto = makeInstance(def, 'watch-round')
  putAuto(storage, { pc: 900, chapter: 2 })
  pAuto.onInit()
  pAuto.onReady()
  check(pAuto.hasAuto === true && pAuto.autoText === '第3章',
    'chapter=2 的自动存档 → autoText「第3章」', JSON.stringify(pAuto.autoText))
  router.__reset()
  pAuto.onContinue()
  check(lastCall(router.__calls) && lastCall(router.__calls).type === 'push' &&
    lastCall(router.__calls).uri === '/pages/Game' &&
    lastCall(router.__calls).params && lastCall(router.__calls).params.auto === '1',
    '「继续阅读」→ push /pages/Game {auto:"1"}',
    JSON.stringify(lastCall(router.__calls)))

  // ---- 6. 六个入口
  router.__reset()
  err = guard('Home 六个入口', () => {
    pAuto.onSaves()
    pAuto.onChapters()
    pAuto.onGallery()
    pAuto.onSettings()
    pAuto.onAbout()
  })
  const calls = router.__calls
  check(!err, '六个入口按钮调用均不抛异常')
  check(calls.length === 5 && calls.every((c) => c.type === 'push'),
    '入口全部走 router.push', calls.map((c) => c.type).join(','))
  check(calls[0] && calls[0].uri === '/pages/Saves' && calls[0].params &&
    calls[0].params.mode === 'load',
    '「存档」→ /pages/Saves {mode:"load"}', JSON.stringify(calls[0]))
  check(calls[1] && calls[1].uri === '/pages/Chapters', '「章节」→ /pages/Chapters', calls[1] && calls[1].uri)
  check(calls[2] && calls[2].uri === '/pages/Gallery', '「CG」→ /pages/Gallery', calls[2] && calls[2].uri)
  check(calls[3] && calls[3].uri === '/pages/Settings', '「设置」→ /pages/Settings', calls[3] && calls[3].uri)
  check(calls[4] && calls[4].uri === '/pages/About', '「关于」→ /pages/About', calls[4] && calls[4].uri)

  // ---- 7. 主按钮文案（Home 没有 primaryText 字段：文案由模板按 hasAuto 切换）
  const homeUx = fs.readFileSync(path.join(SRC, 'pages', 'Home', 'index.ux'), 'utf8')
  check(/if="\{\{ !hasAuto \}\}"[\s\S]{0,120}开始阅读/.test(homeUx) &&
    /if="\{\{ hasAuto \}\}"[\s\S]{0,120}继续阅读/.test(homeUx),
    '主按钮文案随 hasAuto 切换（模板层：开始阅读 / 继续阅读）')

  // ---- 8. 退出
  err = guard('Home.onQuit', () => pAuto.onQuit())
  check(!err && pAuto.__exited === 1, '「退出」调用 $app.exit() 一次', `exited=${pAuto.__exited}`)
  check(prompt.__toasts.length === 0, '主页全程没有误弹 toast', prompt.__toasts.join('|'))
}

// ================================================================== Saves
async function seedSaves(env) {
  // 槽位 0 与槽位 2 有存档，其余为空
  const list = [
    makeSave({ pc: 320, chapter: 1, text: '月幕下，清辉洒落。' }),
    null,
    makeSave({ pc: 1608, chapter: 2, text: '茶餐厅的午后。' }),
    null, null, null,
  ]
  env.storage.__map.set('saves', JSON.stringify(list))
  putAuto(env.storage, { pc: 210, chapter: 1, text: '教室里的午后。' })
}

async function testSaves(env) {
  const { def, storage, router, prompt } = env
  await seedSaves(env)

  // ---- 1. load 模式：onInit 不碰 storage
  storage.__reset()
  const p = makeInstance(def, 'watch-round')
  p.mode = 'load'
  let err = guard('Saves.onInit', () => p.onInit())
  check(!err, 'onInit 不抛异常')
  check(storage.__calls.length === 0,
    'onInit 只做纯状态初始化，不触碰 storage（get/set/delete 均 0 次）',
    JSON.stringify(storage.__calls.slice(0, 3)))

  // ---- 2. onReady 渲染 7 行
  err = guard('Saves.onReady', () => p.onReady())
  check(!err, 'onReady 不抛异常')
  check(p.rows.length === 7, 'rows 固定 7 行（自动存档 + 6 槽）', `rows=${p.rows.length}`)
  check(p.rows.map((r) => r.key).join(',') === 'auto,slot0,slot1,slot2,slot3,slot4,slot5',
    '每行 key 唯一且顺序为 auto / slot0..slot5', p.rows.map((r) => r.key).join(','))
  check(p.rows[0].name === '自动存档' && p.rows[0].tag === '读取' &&
    p.rows[0].info === '第2章 · 教室里的午后。',
    '第 0 行：自动存档 / tag=读取 / describeSave 描述',
    JSON.stringify(p.rows[0]))
  check(p.rows[1].name === '存档 1' && p.rows[1].tag === '读取' &&
    p.rows[1].info === '第2章 · 月幕下，清辉洒落。',
    '第 1 行（有存档）：tag=读取 / 存档描述正确', JSON.stringify(p.rows[1]))
  check(p.rows[3].info === '第3章 · 茶餐厅的午后。', '第 3 行（槽位 3）描述正确', p.rows[3].info)
  check(p.rows.filter((r) => r.info === '（空）').length === 4,
    '4 个空槽显示「（空）」', p.rows.filter((r) => r.info === '（空）').length + ' 个')
  check(p.rows.filter((r) => r.info === '（空）').every((r) => r.tag === '空'),
    '空槽 tag 为「空」')
  check(p.rows[6].name === '存档 6', '最后一行为「存档 6」')

  // ---- 3. load 模式点击
  router.__reset()
  err = guard('Saves.pick(load slot)', () => p.pick(1))
  check(!err && lastCall(router.__calls) && lastCall(router.__calls).type === 'replace' &&
    lastCall(router.__calls).uri === '/pages/Game' &&
    lastCall(router.__calls).params && lastCall(router.__calls).params.load === '0',
    'load 模式点第 1 槽 → replace /pages/Game {load:"0"}',
    JSON.stringify(lastCall(router.__calls)))
  router.__reset()
  p.pick(0)
  check(lastCall(router.__calls) && lastCall(router.__calls).type === 'replace' &&
    lastCall(router.__calls).uri === '/pages/Game' &&
    lastCall(router.__calls).params && lastCall(router.__calls).params.auto === '1',
    'load 模式点自动存档行 → /pages/Game {auto:"1"}',
    JSON.stringify(lastCall(router.__calls)))
  router.__reset()
  prompt.__reset()
  p.pick(2)
  check(prompt.__toasts.length === 1 && prompt.__toasts[0] === '该存档为空' &&
    router.__calls.length === 0,
    'load 模式点空槽 → toast「该存档为空」且不跳转', prompt.__toasts.join('|'))

  // 没有自动存档时点自动行
  storage.__map.delete('autoSave')
  const pNoAuto = makeInstance(def, 'watch-round')
  pNoAuto.mode = 'load'
  pNoAuto.onInit()
  pNoAuto.onReady()
  prompt.__reset()
  pNoAuto.pick(0)
  check(prompt.__toasts[0] === '暂无自动存档',
    '没有自动存档时点自动行 → toast「暂无自动存档」', prompt.__toasts.join('|'))

  // ---- 4. save 模式：pendingSave 读到即清空
  await seedSaves(env)
  storage.__map.set('pendingSave', JSON.stringify(makeSave({ pc: 999, chapter: 2, text: '待保存的进度' })))
  storage.__reset()
  prompt.__reset()
  const ps = makeInstance(def, 'watch-round')
  ps.mode = 'save'
  err = guard('Saves.onInit(save)', () => ps.onInit())
  check(!err && ps.isSave === true, 'mode="save" → isSave=true')
  err = guard('Saves.onReady(save)', () => ps.onReady())
  check(!err, 'save 模式 onReady 不抛异常')
  check(!storage.__map.has('pendingSave'),
    'pendingSave 读到后立即删除（只在 Game → Saves 之间传递一次）')
  check(storage.__calls.some((c) => c.op === 'delete' && c.key === 'pendingSave'),
    'pendingSave 用 storage.delete 清空', JSON.stringify(storage.__calls.filter((c) => c.key === 'pendingSave')))
  check(ps.rows[0].tag === '自动' && ps.rows[1].tag === '覆盖' && ps.rows[3].tag === '覆盖',
    'save 模式：自动行 tag=自动，手动槽 tag=覆盖',
    ps.rows.slice(0, 4).map((r) => r.tag).join(','))

  // 自动行不可覆盖
  prompt.__reset()
  router.__reset()
  ps.pick(0)
  check(prompt.__toasts.length === 1 && prompt.__toasts[0] === '自动存档不可覆盖',
    'save 模式点自动行 → toast「自动存档不可覆盖」', prompt.__toasts.join('|'))
  check(router.__calls.length === 0, '自动行在 save 模式不跳转')

  // 点槽位写入 + toast
  prompt.__reset()
  const beforeSaves = JSON.parse(storage.__map.get('saves'))
  err = guard('Saves.pick(save slot)', () => ps.pick(2))
  const written = JSON.parse(storage.__map.get('saves'))
  check(!err, '点槽位保存不抛异常')
  check(written[1] && written[1].pc === 999 && written[1].magic === SAVE_MAGIC,
    'save 模式点第 2 槽 → saves[1] 落盘为 pendingSave 内容',
    JSON.stringify(written[1] && { pc: written[1].pc, magic: written[1].magic }))
  check(written[0] && written[0].pc === beforeSaves[0].pc && written[5] === null,
    '覆盖一个槽不影响其它槽位')
  check(prompt.__toasts.some((t) => t === '已保存到存档 2'),
    '保存成功 toast「已保存到存档 2」', prompt.__toasts.join('|'))
  check(ps.rows[2].info === '第3章 · 待保存的进度',
    '保存后该行立即重绘为存档描述', ps.rows[2].info)

  // pendingSave 内容非法 → 不可保存
  storage.__map.set('pendingSave', JSON.stringify({ magic: 'broken', pc: 1 }))
  const ps2 = makeInstance(def, 'watch-round')
  ps2.mode = 'save'
  ps2.onInit()
  ps2.onReady()
  prompt.__reset()
  ps2.pick(1)
  check(prompt.__toasts[0] === '没有可保存的进度',
    'pendingSave 内容非法 → toast「没有可保存的进度」', prompt.__toasts.join('|'))
  check(!storage.__map.has('pendingSave'), '非法 pendingSave 也照样清空')

  // ---- 5. onRefresh({mode:'save'}) 切换模式
  await seedSaves(env)
  storage.__map.delete('pendingSave')
  const p3 = makeInstance(def, 'watch-round')
  p3.mode = 'load'
  p3.onInit()
  p3.onReady()
  p3.onShow()                       // 首次 onShow：st.shown 置 true，不重复读
  check(p3.isSave === false, '（前置）p3 处于 load 模式')
  storage.__map.set('pendingSave', JSON.stringify(makeSave({ pc: 42, chapter: 0, text: '刷新后的进度' })))
  prompt.__reset()
  router.__reset()
  err = guard('Saves.onRefresh', () => p3.onRefresh({ mode: 'save' }))
  check(!err && p3.mode === 'save' && p3.isSave === true,
    'onRefresh({mode:"save"}) 切换为保存模式', `mode=${p3.mode} isSave=${p3.isSave}`)
  check(p3.confirmIdx === -1, 'onRefresh 重置 confirmIdx')
  p3.onShow()                       // 回到前台 → reload（重新读 pendingSave）
  check(!storage.__map.has('pendingSave'),
    'onRefresh 之后 onShow 重新读取 pendingSave 并清空')
  p3.pick(1)
  check(prompt.__toasts.some((t) => t === '已保存到存档 1'),
    '切换模式后点第 1 槽 → toast「已保存到存档 1」', prompt.__toasts.join('|'))

  // ---- 6. 长按删除
  await seedSaves(env)
  const p4 = makeInstance(def, 'watch-round')
  p4.mode = 'load'
  p4.onInit()
  p4.onReady()
  prompt.__reset()
  p4.askDelete(0)
  check(p4.confirmIdx === -1 && prompt.__toasts[0] === '自动存档不可删除',
    '长按自动存档行 → toast「自动存档不可删除」且不弹确认框',
    `confirmIdx=${p4.confirmIdx} toast=${prompt.__toasts.join('|')}`)
  p4.askDelete(2)
  check(p4.confirmIdx === 2, '长按第 2 槽 → confirmIdx=2（弹确认框）', `confirmIdx=${p4.confirmIdx}`)
  p4.cancelDelete()
  check(p4.confirmIdx === -1, '「取消」→ confirmIdx=-1')

  // suppress：长按后紧跟的那一次 click 被吞掉
  p4.askDelete(5)
  router.__reset()
  prompt.__reset()
  p4.pick(5)
  check(router.__calls.length === 0 && prompt.__toasts.length === 0 && p4.confirmIdx === 5,
    '长按后紧跟的 click 被 suppress 吞掉（不会误读档）',
    `routes=${router.__calls.length} toasts=${prompt.__toasts.length}`)
  p4.pick(5)
  check(prompt.__toasts[0] === '该存档为空', 'suppress 之后的点击恢复正常', prompt.__toasts.join('|'))

  // 删除空槽（第 5 槽是空的）
  p4.doDelete()
  check(p4.confirmIdx === -1, '「删除」→ confirmIdx=-1')
  check(JSON.parse(storage.__map.get('saves'))[4] === null, '删除后 saves[4] 落盘为 null')

  // 删除有存档的槽（第 3 槽）
  p4.askDelete(3)
  check(p4.confirmIdx === 3, '长按有存档的第 3 槽 → confirmIdx=3')
  err = guard('Saves.doDelete', () => p4.doDelete())
  const afterDel = JSON.parse(storage.__map.get('saves'))
  check(!err, '删除不抛异常')
  check(afterDel[2] === null, '删除后 saves[2] = null 并落盘', JSON.stringify(afterDel[2]))
  check(afterDel[0] && afterDel[0].pc === 320, '删除不影响其它槽位（saves[0] 保留）')
  check(p4.rows[3].info === '（空）' && p4.rows[3].tag === '空',
    '删除后列表立即重绘为「（空）」', p4.rows[3].info)

  // confirmIdx=0 时 doDelete 不应误删
  p4.confirmIdx = 0
  p4.doDelete()
  check(JSON.parse(storage.__map.get('saves'))[0] !== null && p4.confirmIdx === -1,
    'confirmIdx=0 时 doDelete 不删除任何槽位（防御分支）')

  // ---- 7. 方屏 / 返回
  const p5 = makeInstance(def, 'watch-square')
  p5.mode = 'load'
  p5.onInit()
  p5.onReady()
  check(p5.square === true, 'watch-square → square=true（列表 338 高）', `square=${p5.square}`)
  router.__reset()
  err = guard('Saves.back', () => p5.back())
  check(!err && lastCall(router.__calls) && lastCall(router.__calls).type === 'back',
    '「返回」→ router.back()', JSON.stringify(lastCall(router.__calls)))
}

// ================================================================== Chapters
async function testChapters(env) {
  const { def, storage, router, file } = env

  // ---- 1. 未通关：14 章
  storage.__reset()
  file.__reset()
  const p = makeInstance(def, 'watch-round')
  let err = guard('Chapters.onInit', () => p.onInit())
  check(!err, 'onInit 不抛异常')
  check(storage.__calls.length === 0 && file.__reads.length === 0,
    'onInit 不触碰 storage / file', `storage=${storage.__calls.length} file=${file.__reads.length}`)
  check(p.square === false, '圆屏 square=false')

  err = guard('Chapters.onReady', () => p.onReady())
  check(!err, 'onReady 不抛异常（真实读取剧本索引）')
  check(file.__reads.indexOf('/common/story/index.json') >= 0,
    '确实读了真实剧本索引 /common/story/index.json', file.__reads.join(','))
  check(p.count === 14 && p.rows.length === 14, '未通关：可见 14 章', `count=${p.count}`)
  check(p.rows[0].no === '1' && p.rows[0].title === '第一幕 · 月幕' && p.rows[0].start === '0',
    '首行 = 第一幕 · 月幕 / start "0"', JSON.stringify(p.rows[0]))
  check(p.rows[13].title === '第三幕 · 天选试', '第 14 行 = 第三幕 · 天选试',
    p.rows[13] && p.rows[13].title)
  check(p.rows.every((r) => r.mark === ''), '没有自动存档时不显示「▶」')
  check(p.rows.every((r) => !/真结局|二人的世界|回归日常|后日谈/.test(r.title)),
    '3 个结局章与未解锁的后日谈都不出现',
    p.rows.map((r) => r.title).filter((t) => /真结局|二人的世界|回归日常|后日谈/.test(t)).join('|'))

  // ---- 2. 有自动存档：只在当前章标 ▶
  putAuto(storage, { pc: 210, chapter: 1 })
  const p2 = makeInstance(def, 'watch-round')
  p2.onInit()
  p2.onReady()
  check(p2.rows[1].mark === '▶',
    '自动存档 pc=210 → 「第一幕 · 教室」标 ▶',
    p2.rows.map((r, i) => (r.mark ? i + ':' + r.title : '')).filter(Boolean).join(','))
  check(p2.rows.filter((r) => r.mark === '▶').length === 1,
    '「▶」全文只有一处（只在当前章）', p2.rows.filter((r) => r.mark === '▶').length + ' 处')

  // ---- 3. 通关后 +1（后日谈）
  storage.__map.set('cleared', JSON.stringify({ ok: 1, at: 1 }))
  const p3 = makeInstance(def, 'watch-round')
  p3.onInit()
  p3.onReady()
  check(p3.count === 15 && p3.rows.length === 15,
    '通关（cleared.ok=1）：可见 15 章（+ 后日谈）', `count=${p3.count}`)
  check(p3.rows[14].title === '后日谈 · 诺提拉', '第 15 行 = 后日谈 · 诺提拉',
    p3.rows[14] && p3.rows[14].title)

  // ---- 4. 点行跳转
  router.__reset()
  err = guard('Chapters.pick', () => p3.pick(0))
  check(!err && lastCall(router.__calls) && lastCall(router.__calls).type === 'replace' &&
    lastCall(router.__calls).uri === '/pages/Game' &&
    lastCall(router.__calls).params && lastCall(router.__calls).params.at === '0',
    '点第 1 章 → replace /pages/Game {at:"0"}',
    JSON.stringify(lastCall(router.__calls)))
  router.__reset()
  p3.pick(3)
  check(lastCall(router.__calls) && lastCall(router.__calls).params &&
    lastCall(router.__calls).params.at === p3.rows[3].start &&
    p3.rows[3].start === '721',
    '点第 4 章 → at 为真实 start（721）',
    JSON.stringify(lastCall(router.__calls) && lastCall(router.__calls).params))
  router.__reset()
  err = guard('Chapters.pick(越界)', () => p3.pick(999))
  check(!err && router.__calls.length === 0, '点越界行不跳转、不抛异常')
  router.__reset()
  err = guard('Chapters.back', () => p3.back())
  check(!err && lastCall(router.__calls) && lastCall(router.__calls).type === 'back',
    '「返回」→ router.back()')

  // ---- 5. 索引读取失败分支
  file.__state.down = true
  const p4 = makeInstance(def, 'watch-round')
  err = guard('Chapters 索引失败', () => { p4.onInit(); p4.onReady() })
  check(!err, '剧本索引读不到时不抛异常')
  check(p4.rows.length === 1 && p4.count === 1 &&
    p4.rows[0].title === '读取剧本索引失败',
    '索引读取失败 → 一行错误提示', JSON.stringify(p4.rows[0]))
  router.__reset()
  err = guard('Chapters.pick(错误行)', () => p4.pick(0))
  check(!err && router.__calls.length === 0, '错误行点按不跳转（starts 为空）')
  file.__state.down = false

  // ---- 6. 方屏
  const p5 = makeInstance(def, 'watch-square')
  p5.onInit()
  p5.onReady()
  check(p5.square === true && p5.count === 15,
    'watch-square → square=true 且仍为 15 章', `square=${p5.square} count=${p5.count}`)
}

// ================================================================== Gallery
async function testGallery(env) {
  const { def, storage, router, prompt } = env

  // ---- 1. cgSeen 为空：9 组全部未解锁
  storage.__reset()
  const p = makeInstance(def, 'watch-round')
  let err = guard('Gallery.onInit', () => p.onInit())
  check(!err, 'onInit 不抛异常')
  check(storage.__calls.length === 0, 'onInit 不触碰 storage')
  check(p.layoutClass === '', '圆屏 layoutClass 为空串', JSON.stringify(p.layoutClass))
  check(p.cgStyle === 'left: -181px; top: 0px; width: 828px; height: 466px;',
    'onInit 大图初始样式：left -181（看中间）/ top 0（圆屏）', p.cgStyle)
  err = guard('Gallery.onReady', () => p.onReady())
  check(!err, 'onReady 不抛异常')
  check(p.rows.length === 9 && p.total === 9, '列表 9 组', `rows=${p.rows.length} total=${p.total}`)
  check(p.openCount === 0, 'cgSeen 为空 → 解锁 0 组', `openCount=${p.openCount}`)
  check(p.rows.every((r) => r.img === '/common/img/t/lock.png' && r.st === '未解锁' && r.ok === false),
    '全部未解锁：占位图 lock.png + 「未解锁」', JSON.stringify(p.rows[0]))
  check(p.rows[0].n === '政客' && p.rows[8].n === '诺提拉',
    '组名来自 cglist（政客 … 诺提拉）', p.rows[0].n + ' … ' + p.rows[8].n)
  prompt.__reset()
  router.__reset()
  err = guard('Gallery.open(locked)', () => p.open(0))
  check(!err && p.viewing === false && prompt.__toasts[0] === '还没在剧情里看到这一组',
    '点未解锁组 → toast 且不打开查看器', prompt.__toasts.join('|'))

  // ---- 2. 部分解锁
  storage.__map.set('cgSeen', JSON.stringify([108, 111, 93]))
  const p2 = makeInstance(def, 'watch-round')
  p2.onInit()
  p2.onReady()
  check(p2.openCount === 3, 'cgSeen=[108,111,93] → 解锁 3 组', `openCount=${p2.openCount}`)
  check(p2.rows[0].ok === true && p2.rows[0].img === '/common/img/t/g0.png' &&
    p2.rows[0].st === '2 张',
    '解锁组：缩略图 + 差分张数「2 张」', JSON.stringify(p2.rows[0]))
  check(p2.rows[1].st === '10 张' && p2.rows[2].st === '3 张',
    '第 2/3 组张数正确（10 / 3）', p2.rows[1].st + ' / ' + p2.rows[2].st)
  check(p2.rows[3].ok === false && p2.rows[3].img === '/common/img/t/lock.png',
    '未写入 cgSeen 的组仍然锁定')

  // ---- 3. 打开查看器
  router.__reset()
  err = guard('Gallery.open', () => p2.open(0))
  check(!err && p2.viewing === true, '已解锁组点开 → viewing=true')
  check(p2.bigSrc === '/common/img/w/sd_001.png',
    'bigSrc 指向 /common/img/w/ 宽图', p2.bigSrc)
  check(p2.bigSrc.indexOf('/img/c/') < 0, 'bigSrc 不是 /common/img/c/ 原图')
  check(p2.pageAll === 2 && p2.pageNo === 1, 'pageAll=2 / pageNo=1（政客组 2 张差分）',
    `${p2.pageNo}/${p2.pageAll}`)
  check(p2.vName === '政客', '查看器标题为组名「政客」', p2.vName)
  check(p2.cgStyle === 'left: -181px; top: 0px; width: 828px; height: 466px;',
    '打开后回到中间位置（left -181）', p2.cgStyle)

  // ---- 4. setPan 边界
  err = guard('Gallery.setPan', () => {
    p2.setPan(50)
    check(p2.cgStyle.indexOf('left: 0px') === 0, 'setPan(50) 上夹到 0', p2.cgStyle)
    p2.setPan(-999)
    check(p2.cgStyle.indexOf('left: -362px') === 0, 'setPan(-999) 下夹到 -362', p2.cgStyle)
    p2.setPan(-181)
    check(p2.cgStyle.indexOf('left: -181px') === 0 && p2.indStyle === 'left: 53px;',
      'setPan(-181) 位置条滑块居中（left 53）', p2.indStyle)
    p2.setPan(-362)
    check(p2.indStyle === 'left: 105px;', 'setPan(-362) 位置条滑块到最右（left 105）', p2.indStyle)
  })
  check(!err, 'setPan 边界夹取不抛异常')

  // ---- 5. 拖动手势层
  p2.setPan(-181)
  err = guard('Gallery 拖动', () => {
    p2.onCgTouchStart({ touches: [{ clientX: 200, clientY: 100 }] })
    p2.onCgTouchMove({ touches: [{ clientX: 260 }] })
  })
  check(!err && p2.cgStyle.indexOf('left: -121px') === 0,
    '按住拖动 60px → left -181+60 = -121', p2.cgStyle)
  err = guard('Gallery 拖动结束', () => {
    p2.onCgTouchEnd()
    p2.onCgTouchMove({ touches: [{ clientX: 400 }] })
  })
  check(!err && p2.cgStyle.indexOf('left: -121px') === 0,
    '松手后 onCgTouchMove 不再改变位置', p2.cgStyle)
  p2.setPan(-181)
  p2.onCgTouchMove({ changedTouches: [{ pageX: 300 }] })
  check(p2.cgStyle.indexOf('left: -181px') === 0,
    '没有 touchstart 时 onCgTouchMove 被忽略（pressX 为 null）', p2.cgStyle)

  // ---- 6. 换差分循环
  err = guard('Gallery.next/prev', () => {
    p2.next()
    check(p2.pageNo === 2 && p2.bigSrc === '/common/img/w/sd_002.png',
      'next → 第 2 张差分（sd_002）', p2.bigSrc)
    check(p2.cgStyle.indexOf('left: -181px') === 0, '换差分后自动回到中间', p2.cgStyle)
    p2.next()
    check(p2.pageNo === 1 && p2.bigSrc === '/common/img/w/sd_001.png',
      'next 到末尾后循环回第 1 张', p2.bigSrc)
    p2.prev()
    check(p2.pageNo === 2, 'prev 从第 1 张循环到最后一张', `${p2.pageNo}/${p2.pageAll}`)
  })
  check(!err, '换差分循环不抛异常')

  // ---- 7. 左右热区步进
  p2.setPan(-181)
  p2.panPrev()
  check(p2.cgStyle.indexOf('left: -60px') === 0, 'panPrev 步进 +121（-181 → -60）', p2.cgStyle)
  p2.setPan(-181)
  p2.panNext()
  check(p2.cgStyle.indexOf('left: -302px') === 0, 'panNext 步进 -121（-181 → -302）', p2.cgStyle)
  p2.panNext()
  check(p2.cgStyle.indexOf('left: -362px') === 0, 'panNext 再次步进夹到 -362', p2.cgStyle)

  // ---- 8. 关闭 / 返回键
  router.__reset()
  err = guard('Gallery.onBackPress(viewing)', () => p2.onBackPress())
  check(!err && p2.viewing === false && p2.bigSrc === '' && p2.vName === '',
    '查看中按返回：先关闭查看器', `viewing=${p2.viewing}`)
  check(router.__calls.length === 0, '关闭查看器的返回不触发路由', JSON.stringify(router.__calls))
  err = guard('Gallery.onBackPress(idle)', () => p2.onBackPress())
  check(!err && router.__calls.length === 1 && router.__calls[0].type === 'back',
    '不在查看时按返回 → router.back()', JSON.stringify(router.__calls))
  p2.open(1)
  err = guard('Gallery.closeView', () => p2.closeView())
  check(!err && p2.viewing === false && p2.bigSrc === '', 'closeView 关闭查看器并清空大图')
  router.__reset()
  err = guard('Gallery.back', () => p2.back())
  check(!err && lastCall(router.__calls) && lastCall(router.__calls).type === 'back',
    '「返回」按钮 → router.back()')

  // ---- 9. 方屏几何
  const p3 = makeInstance(def, 'watch-square')
  storage.__map.set('cgSeen', JSON.stringify([108]))
  p3.onInit()
  p3.onReady()
  check(p3.layoutClass === 'square', 'watch-square → layoutClass="square"', p3.layoutClass)
  p3.open(0)
  check(p3.cgStyle.indexOf('top: 44px') > 0,
    '方屏宽图上下居中 top=44（(554-466)/2）', p3.cgStyle)
}

// ================================================================== Settings
async function testSettings(env) {
  const { def, storage, router, prompt, tick } = env

  // ---- 1. onInit 用默认值、不读 storage
  storage.__reset()
  const p = makeInstance(def, 'watch-round')
  let err = guard('Settings.onInit', () => p.onInit())
  check(!err, 'onInit 不抛异常')
  check(storage.__calls.length === 0, 'onInit 不触碰 storage')
  check(p.layoutClass === '', '圆屏 layoutClass 为空串')
  check(p.sizeText === '20' && p.speedText === '28' && p.autoText === '关闭',
    'onInit 先用默认值渲染（字号 20 / 速度 28 / 自动播放「关闭」）',
    `${p.sizeText} / ${p.speedText} / ${p.autoText}`)

  // ---- 2. loadSettings 后的文案
  storage.__map.set('settings', JSON.stringify({ size: 22, speed: 0, autoMs: 0, keepOn: true, longpress: 'hide' }))
  err = guard('Settings.onReady', () => p.onReady())
  check(!err, 'onReady 不抛异常')
  check(p.sizeText === '22', '读回字号 22', p.sizeText)
  check(p.speedText === '瞬间', 'speed=0 → 「瞬间」', p.speedText)
  check(p.autoText === '关闭', 'autoMs=0 → 「关闭」', p.autoText)
  check(p.pvStyle === 'font-size: 22px; line-height: 26px;',
    '预览行内样式随字号（22px / 行高 26px）', p.pvStyle)
  check(p.rowKeep.length === 2 && p.rowKeep[0].t === '关' && p.rowKeep[1].t === '开' &&
    p.rowKeep[1].cls === 'pill-on' && p.rowKeep[0].cls === 'pill',
    '屏幕常亮：keepOn=true → 「开」选中',
    p.rowKeep.map((x) => x.t + ':' + x.cls).join(' '))
  check(p.rowLp.length === 3 && p.rowLp.map((x) => x.t).join('/') === '隐藏/快进/关闭' &&
    p.rowLp[0].cls === 'pill-on',
    '长按三态：隐藏/快进/关闭，当前 hide 选中',
    p.rowLp.map((x) => x.t + ':' + x.cls).join(' '))
  check(p.hint1.indexOf('14~30') >= 0, '字号提示含 14~30', p.hint1)

  // ---- 3. 三态开关
  err = guard('Settings.pickKeep / pickLp', () => {
    p.pickKeep(0)
    check(p.rowKeep[0].cls === 'pill-on' && p.rowKeep[1].cls === 'pill',
      'pickKeep(0) → 「关」选中', p.rowKeep.map((x) => x.cls).join(','))
    p.pickKeep(1)
    check(p.rowKeep[1].cls === 'pill-on', 'pickKeep(1) → 「开」选中')
    p.pickLp(1)
    check(p.rowLp[1].cls === 'pill-on', 'pickLp(1) → 「快进」选中')
    p.pickLp(2)
    check(p.rowLp[2].cls === 'pill-on', 'pickLp(2) → 「关闭」选中')
    p.pickLp(0)
    check(p.rowLp[0].cls === 'pill-on', 'pickLp(0) → 「隐藏」选中')
  })
  check(!err, '三态开关切换不抛异常')

  // ---- 4. 六组步进的边界夹取
  err = guard('Settings 字号边界', () => {
    for (let i = 0; i < 30; i += 1) p.decSize()
    check(p.sizeText === '14', '字号下限夹到 14', p.sizeText)
    for (let i = 0; i < 40; i += 1) p.incSize()
    check(p.sizeText === '30', '字号上限夹到 30', p.sizeText)
    check(p.pvStyle === 'font-size: 30px; line-height: 34px;',
      '字号 30 时预览行高 34', p.pvStyle)
  })
  check(!err, '字号步进不抛异常')
  err = guard('Settings 速度边界', () => {
    for (let i = 0; i < 70; i += 1) p.incSpeed()
    check(p.speedText === '120', '速度上限夹到 120', p.speedText)
    for (let i = 0; i < 70; i += 1) p.decSpeed()
    check(p.speedText === '瞬间', '速度下限 0 → 「瞬间」', p.speedText)
  })
  check(!err, '速度步进不抛异常')
  err = guard('Settings 自动播放边界', () => {
    for (let i = 0; i < 30; i += 1) p.incAuto()
    check(p.autoText === '200', '自动播放上限夹到 200', p.autoText)
    for (let i = 0; i < 30; i += 1) p.decAuto()
    check(p.autoText === '关闭', '自动播放下限 0 → 「关闭」', p.autoText)
  })
  check(!err, '自动播放步进不抛异常')

  // ---- 5. 300ms 防抖
  p.apply({ size: 20 })
  resetTimers()
  storage.__reset()
  p.incSize()
  p.incSize()
  p.incSize()
  check(ops(env, 'set', 'settings') === 0,
    '连点 3 次后（<300ms）一次都没写 storage（防抖生效）',
    `set=${ops(env, 'set', 'settings')}`)
  tick(299)
  check(ops(env, 'set', 'settings') === 0, '299ms 时仍未写盘', `set=${ops(env, 'set', 'settings')}`)
  tick(2)
  check(ops(env, 'set', 'settings') === 1, '300ms 后只写盘一次',
    `set=${ops(env, 'set', 'settings')}`)
  check(pendingTimers() === 0, '防抖定时器触发后不再残留', `pending=${pendingTimers()}`)
  const written = JSON.parse(storage.__map.get('settings'))
  check(written.size === 23 && written.size === Number(p.sizeText),
    '写盘内容是最新值（size=23）', JSON.stringify(written))

  // ---- 6. flush 立即写盘
  resetTimers()
  storage.__reset()
  p.decSize()
  check(ops(env, 'set', 'settings') === 0, '（前置）flush 前还没写盘')
  err = guard('Settings.flush', () => p.flush())
  check(!err && ops(env, 'set', 'settings') === 1, 'flush() 立即写盘',
    `set=${ops(env, 'set', 'settings')}`)
  check(pendingTimers() === 0, 'flush() 取消防抖定时器', `pending=${pendingTimers()}`)

  // ---- 7. reset
  prompt.__reset()
  storage.__reset()
  p.decSize()
  err = guard('Settings.reset', () => p.reset())
  check(!err && prompt.__toasts[0] === '已恢复默认设置',
    'reset() toast「已恢复默认设置」', prompt.__toasts.join('|'))
  check(p.sizeText === '20' && p.speedText === '28' && p.autoText === '关闭',
    'reset() 后文案回到默认（20 / 28 / 关闭）',
    `${p.sizeText} / ${p.speedText} / ${p.autoText}`)
  check(p.rowKeep[1].cls === 'pill-on' && p.rowLp[2].cls === 'pill-on',
    'reset() 后 keepOn=true、longpress=off 选中',
    p.rowKeep.map((x) => x.cls).join(',') + ' | ' + p.rowLp.map((x) => x.cls).join(','))
  const afterReset = JSON.parse(storage.__map.get('settings'))
  check(afterReset.size === 20 && afterReset.speed === 28 && afterReset.autoMs === 0 &&
    afterReset.keepOn === true && afterReset.longpress === 'off',
    'reset() 立即把默认值写盘', JSON.stringify(afterReset))
  check(pendingTimers() === 0, 'reset() 后没有残留防抖定时器')

  // ---- 8. back()
  router.__reset()
  storage.__reset()
  p.pickLp(1)
  err = guard('Settings.back', () => p.back())
  check(!err && router.__calls.length === 1 && router.__calls[0].type === 'back',
    '「返回」→ router.back()', JSON.stringify(router.__calls))
  check(JSON.parse(storage.__map.get('settings')).longpress === 'fast',
    '返回前 flush 写入最新 longpress=fast')

  // ---- 9. onHide / onDestroy flush
  resetTimers()
  storage.__reset()
  p.pickKeep(0)
  err = guard('Settings.onHide', () => p.onHide())
  check(!err && ops(env, 'set', 'settings') === 1, 'onHide 立即 flush 写盘',
    `set=${ops(env, 'set', 'settings')}`)
  check(JSON.parse(storage.__map.get('settings')).keepOn === false,
    'onHide 写入 keepOn=false')
  resetTimers()
  storage.__reset()
  p.pickKeep(1)
  err = guard('Settings.onDestroy', () => p.onDestroy())
  check(!err && ops(env, 'set', 'settings') === 1 && pendingTimers() === 0,
    'onDestroy 立即 flush 写盘且无残留定时器',
    `set=${ops(env, 'set', 'settings')} pending=${pendingTimers()}`)

  // ---- 10. 未读到用户设置前 flush 不写盘
  const p3 = makeInstance(def, 'watch-round')
  p3.onInit()
  storage.__reset()
  p3.flush()
  check(ops(env, 'set', 'settings') === 0,
    '还没读到用户设置时 flush 不写盘（避免默认值覆盖旧设置）')

  // ---- 11. 方屏
  const p4 = makeInstance(def, 'watch-square')
  p4.onInit()
  check(p4.layoutClass === 'square', 'watch-square → layoutClass="square"', p4.layoutClass)
}

// ================================================================== About
async function testAbout(env) {
  const { def, storage, router, prompt, tick } = env

  // ---- 1. 正文排版
  storage.__reset()
  const p = makeInstance(def, 'watch-round')
  let err = guard('About.onInit', () => p.onInit())
  check(!err, 'onInit 不抛异常')
  check(storage.__calls.length === 0, 'onInit 不触碰 storage')
  check(p.ver === '1.0.0', '版本号 1.0.0（与 manifest 一致）', p.ver)
  check(p.square === false && p.eggOpen === false && p.fishOpen === false,
    '初始状态：圆屏 / 彩蛋关闭', `square=${p.square} egg=${p.eggOpen} fish=${p.fishOpen}`)
  check(p.rows.length > 40, '正文断行后行数合理', `rows=${p.rows.length}`)
  check(p.rows.every((r) => r.t.length <= 15),
    '每一行都不超过 CPL=15 个字',
    'max=' + Math.max.apply(null, p.rows.map((r) => r.t.length)))
  const sections = p.rows.filter((r) => r.c === 'r-s').map((r) => r.t)
  check(['故事梗概', '结局', '版权信息', '开源协议'].every((s) => sections.indexOf(s) >= 0),
    '四个小节标题齐全（故事梗概 / 结局 / 版权信息 / 开源协议）', sections.join('/'))
  check(p.rows.filter((r) => r.c === 'r-g').every((r) => r.t === ''),
    '空行（r-g）不带文字',
    p.rows.filter((r) => r.c === 'r-g').length + ' 行空行')
  check(p.rows[0].c === 'r-s' && p.rows[0].t === '故事梗概',
    '首行为小节「故事梗概」', JSON.stringify(p.rows[0]))
  check(p.rows.some((r) => r.t.indexOf('诺提拉') >= 0), '正文含「诺提拉」（后日谈小节）')
  check(p.rows.every((r) => r.c === 'r-s' || r.c === 'r-p' || r.c === 'r-g'),
    '行样式只用 r-s / r-p / r-g')

  // ---- 2. 连点 7 次开彩蛋
  err = guard('About 连点 7 次', () => {
    p.tapTitle()
    check(p.dots === '' && p.eggOpen === false, '第 1 次点击无提示')
    p.tapTitle()
    p.tapTitle()
    check(p.dots === '' && p.eggOpen === false, '第 3 次点击仍未开彩蛋（dots 空）',
      JSON.stringify(p.dots))
    p.tapTitle()
    check(p.dots === '·', '第 4 次 → 「·」', JSON.stringify(p.dots))
    p.tapTitle()
    check(p.dots === '··', '第 5 次 → 「··」', JSON.stringify(p.dots))
    p.tapTitle()
    check(p.dots === '···', '第 6 次 → 「···」', JSON.stringify(p.dots))
    p.tapTitle()
    check(p.eggOpen === true && p.dots === '',
      '第 7 次 → 打开彩蛋菜单并清空提示',
      `eggOpen=${p.eggOpen} dots=${JSON.stringify(p.dots)}`)
  })
  check(!err, '2 秒内连点 7 次开彩蛋不抛异常')

  // ---- 3. 超过 2 秒计数重置
  p.onInit()
  p.tapTitle()
  tick(2100)
  p.tapTitle()
  p.tapTitle()
  p.tapTitle()
  check(p.dots === '' && p.eggOpen === false,
    '超过 2 秒后计数重置（第 4 次点击仍无提示）', JSON.stringify(p.dots))
  p.tapTitle()
  check(p.dots === '·', '重置后重新从 1 数起：第 4 次才出现「·」', JSON.stringify(p.dots))
  p.tapTitle()
  p.tapTitle()
  err = guard('About 重置后再连点', () => p.tapTitle())
  check(!err && p.eggOpen === true, '重置后仍能靠 7 连点开彩蛋', `eggOpen=${p.eggOpen}`)

  // ---- 4. 关闭彩蛋菜单
  err = guard('About.closeEgg', () => p.closeEgg())
  check(!err && p.eggOpen === false, 'closeEgg 关闭彩蛋菜单')

  // ---- 5. 解锁后日谈
  p.eggOpen = true
  prompt.__reset()
  err = guard('About.unlockAfter', () => p.unlockAfter())
  const cleared = storage.__map.has('cleared') ? JSON.parse(storage.__map.get('cleared')) : null
  check(!err && cleared && cleared.ok === 1,
    'unlockAfter → storage「cleared」写入 {ok:1}', JSON.stringify(cleared))
  check(cleared && cleared.at === clock.now, 'cleared.at 使用当前时间戳',
    `at=${cleared && cleared.at} now=${clock.now}`)
  check(p.eggOpen === false, '解锁后关闭彩蛋菜单')
  check(prompt.__toasts.some((t) => t === '已解锁「后日谈 · 诺提拉」'),
    '解锁后日谈 toast 正确', prompt.__toasts.join('|'))

  // ---- 6. 解锁全部 CG
  p.eggOpen = true
  prompt.__reset()
  err = guard('About.unlockCg', () => p.unlockCg())
  const seen = storage.__map.has('cgSeen') ? JSON.parse(storage.__map.get('cgSeen')) : []
  check(!err && Array.isArray(seen) && seen.length === 32,
    'unlockCg → cgSeen 写入去重后的 32 个图片下标', `len=${seen.length}`)
  check(new Set(seen).size === 32, 'cgSeen 没有重复下标', `unique=${new Set(seen).size}`)
  check(seen.indexOf(93) >= 0 && seen.indexOf(108) >= 0 && seen.indexOf(126) >= 0,
    'cgSeen 覆盖各组的解锁图（93 / 108 / 126）')
  check(prompt.__toasts.some((t) => t === '已解锁全部 CG（32 张）'),
    '解锁全部 CG toast 含数量', prompt.__toasts.join('|'))

  // ---- 7. 小鱼干小剧场
  p.eggOpen = true
  err = guard('About.openFish', () => p.openFish())
  check(!err && p.fishOpen === true && p.eggOpen === false && p.fishIdx === 0,
    'openFish 打开小剧场（fishIdx=0）',
    `fish=${p.fishOpen} egg=${p.eggOpen} idx=${p.fishIdx}`)
  check(p.fishText === '（口袋里还剩最后一包小鱼干。）' && p.fishName === '',
    '第 1 句是旁白（fishName 为空）', JSON.stringify(p.fishText))
  check(p.fishHint === '1 / 30', 'fishHint 形如「n / 30」（1 / 30）', p.fishHint)
  p.tapFish()
  check(p.fishIdx === 1 && p.fishName === 'Yui' && p.fishHint === '2 / 30',
    '点一下 → 第 2 句（Yui / 2 / 30）', `${p.fishName} ${p.fishHint}`)
  err = guard('About 小鱼干走到底', () => {
    for (let i = 0; i < 28; i += 1) p.tapFish()
  })
  check(!err && p.fishIdx === 29 && p.fishOpen === true && p.fishHint === '30 / 30',
    '走到第 30 句时仍在剧场内（30 / 30）',
    `idx=${p.fishIdx} hint=${p.fishHint} open=${p.fishOpen}`)
  p.tapFish()
  check(p.fishIdx === 30 && p.fishOpen === false && p.eggOpen === true,
    '走完 30 句 → 回彩蛋菜单（fishIdx=30、eggOpen=true）',
    `idx=${p.fishIdx} fish=${p.fishOpen} egg=${p.eggOpen}`)
  check(p.fishHint === '30 / 30', '（保持）最后一条提示为 30 / 30', p.fishHint)

  // ---- 8. 返回
  router.__reset()
  err = guard('About.back', () => p.back())
  check(!err && router.__calls.length === 1 && router.__calls[0].type === 'back',
    '「返回」→ router.back()', JSON.stringify(router.__calls))

  // ---- 9. 方屏
  const p2 = makeInstance(def, 'watch-square')
  p2.onInit()
  check(p2.square === true, 'watch-square → square=true（列表 368 高）', `square=${p2.square}`)
}

// ================================================================== 主流程
const SUITES = [
  ['Home', testHome],
  ['Saves', testSaves],
  ['Chapters', testChapters],
  ['Gallery', testGallery],
  ['Settings', testSettings],
  ['About', testAbout],
]

async function main() {
  const realNow = installFakeTimers()
  const dir = prepareWorkspace()
  const load = (file) => import(pathToFileURL(path.join(dir, file)).href)

  const env = {
    dir,
    clock,
    tick,
    pendingTimers,
    router: (await load('stub-router.js')).default,
    prompt: (await load('stub-prompt.js')).default,
    brightness: (await load('stub-brightness.js')).default,
    storage: (await load('stub-storage.js')).default,
    file: (await load('stub-file.js')).default,
    defs: {},
  }
  for (const name of PAGE_NAMES) env.defs[name] = (await load(name + '.mjs')).default

  console.log('==== 页面运行时测试：Home / Saves / Chapters / Gallery / Settings / About (tools/test-pages.mjs) ====')
  console.log(`临时 ESM 工程: ${dir}`)
  console.log(`被测页面: ${PAGE_NAMES.map((n) => 'src/pages/' + n + '/index.ux').join(' , ')}`)
  console.log('公共模块以真实代码参与运行（engine / reader / story / asset / cglist），只 stub @blueos.* 与定时器')

  const pageStats = []
  for (const [name, suite] of SUITES) {
    currentPage = name
    resetAll(env)
    banner(name)
    const start = results.length
    try {
      await suite(Object.assign({}, env, { def: env.defs[name] }))
    } catch (error) {
      check(false, `${name} 测试脚本自身异常`,
        error && error.stack ? String(error.stack).split('\n').slice(0, 2).join(' ') : String(error))
    }
    const pageResults = results.slice(start)
    const failed = pageResults.filter((r) => !r.ok)
    pageStats.push({ name, checks: pageResults.length, failures: failed.length })
    if (failed.length) {
      issues.push({
        page: name,
        failures: failed.map((f) => f.name),
        hint: '上方 [FAIL] 行即为复现点；页面源码在 src/pages/' + name + '/index.ux（只读，未修改）',
      })
    }
    console.log(`---------- ${name} 小计: ${failed.length === 0 ? 'PASS' : 'FAIL'} ` +
      `checks=${pageResults.length} failures=${failed.length} ----------`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log('[test-pages] 各页统计: ' + pageStats.map((s) => `${s.name} ${s.checks - s.failures}/${s.checks}`).join('  '))
  if (failed.length) {
    console.log('[test-pages] 失败明细:')
    for (const f of failed) console.log(`  - [${f.page}] ${f.name}${f.detail ? '  → ' + f.detail : ''}`)
    console.log('[test-pages] 发现问题（未修改 src/pages/**，请 Lead 评估修复）:')
    for (const it of issues) console.log(`  - ${it.page}: ${it.failures.join(' ; ')}`)
  }
  console.log(`[test-pages] 结果: ${failed.length === 0 ? 'PASS' : 'FAIL'}  checks=${results.length} failures=${failed.length}`)

  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(
    REPORT,
    JSON.stringify({
      tool: 'tools/test-pages.mjs',
      checks: results.length,
      failures: failed.length,
      pages: pageStats,
      issues,
      results,
      generatedAt: new Date().toISOString(),
    }, null, 2),
    'utf8'
  )

  Date.now = realNow
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('[test-pages] 未捕获异常：', error)
  process.exit(1)
})
