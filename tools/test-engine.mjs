#!/usr/bin/env node
/**
 * 引擎 / 剧本加载 / 存档逻辑测试（tools/test-engine.mjs）
 *
 * 在 Node 里直接加载 src/common 的纯逻辑模块：
 *   - 工程 package.json 不是 type:module，src 下的 .js 不能直接 import；
 *     因此把 engine.js / asset.js / assets.js / layout.js / reader.js / story.js 复制到
 *     系统临时目录，改名为 .mjs 并把相对 import 改成 .mjs，
 *     把 @blueos.storage.* 换成内存 stub，再动态 import（参考 galgaoshou/tools/test-engine.mjs）。
 *
 * 覆盖（对应 docs/PORT-SPEC.md §4/§5）：
 *   1. 全 5569 节点顺序执行不越界、动作类型正确（say/choice/end/next）；
 *   2. 8 条策略跑全剧本：Bad End、真结局、NE1、NE2 均可达，不能越界/死循环；
 *   3. true_end_finish 通关：真结局后进入后日谈（5158）并到达剧终节点；
 *   4. 章节可见过滤：未通关 14 章 / 通关 15 章，hide 结局永不显示，need 后日谈仅通关后显示；
 *   5. 每个 say 节点的存档 collectSave→JSON→normalizeSave→applySave 往返一致；
 *   6. 选项条件过滤（true_end_flag 条件选项）；
 *   7. loader：44 分块读取、缓存命中不重复读盘、trim 淘汰、prefetch 预读、坏分块回调 null。
 *
 * 用法: node tools/test-engine.mjs [--json <file>]
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
const EXPECTED_NODES = 5569
const EXPECTED_CHAPTERS = 18
const STEP_LIMIT = 30000

const failures = []
const checks = []
const stats = {}

function fail(message) {
  failures.push(message)
}

function check(name, fn) {
  const before = failures.length
  try {
    const value = fn()
    checks.push({ name, pass: failures.length === before, detail: value === undefined ? '' : String(value) })
  } catch (error) {
    fail(`${name} 异常：${error && error.stack ? error.stack.split('\n')[0] : error}`)
    checks.push({ name, pass: false, detail: 'throw' })
  }
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// ---------------------------------------------------------------- 临时 ESM 工程
function prepareTempModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galgad-engine-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
  const copies = [
    { from: 'layout.js', to: 'layout.mjs', rewrites: [] },
    { from: 'assets.js', to: 'assets.mjs', rewrites: [] },
    { from: 'asset.js', to: 'asset.mjs', rewrites: [["'./assets.js'", "'./assets.mjs'"]] },
    { from: 'engine.js', to: 'engine.mjs', rewrites: [["'./asset.js'", "'./asset.mjs'"]] },
    {
      from: 'reader.js',
      to: 'reader.mjs',
      rewrites: [
        ["from '@blueos.storage.storage'", "from './storage-stub.mjs'"],
        ["'./layout.js'", "'./layout.mjs'"],
      ],
    },
    {
      from: 'story.js',
      to: 'story.mjs',
      rewrites: [["from '@blueos.storage.file'", "from './file-stub.mjs'"]],
    },
  ]
  for (const item of copies) {
    const source = fs.readFileSync(path.join(SRC, 'common', item.from), 'utf8')
    let output = source
    for (const [search, replacement] of item.rewrites) output = output.split(search).join(replacement)
    fs.writeFileSync(path.join(dir, item.to), output, 'utf8')
  }
  // storage stub（内存 Map，可测 readJSON/writeJSON/loadSettings）
  fs.writeFileSync(
    path.join(dir, 'storage-stub.mjs'),
    [
      'export const state = { map: new Map(), calls: { get: 0, set: 0 } }',
      'export function reset() { state.map.clear(); state.calls.get = 0; state.calls.set = 0 }',
      'export default {',
      '  get(options) {',
      '    state.calls.get += 1',
      '    const { key, default: dflt, success, fail: failCb } = options || {}',
      '    if (state.map.has(key)) { if (success) success(state.map.get(key)); return }',
      '    if (dflt !== undefined) { if (success) success(dflt); return }',
      '    if (failCb) failCb({}, 404)',
      '  },',
      '  set(options) {',
      '    state.calls.set += 1',
      '    const { key, value, success } = options || {}',
      '    state.map.set(key, value)',
      '    if (success) success()',
      '  },',
      '}',
    ].join('\n'),
    'utf8'
  )
  // file stub：URI /common/story/xxx.json -> <SRC>/common/story/xxx.json（同步回调，统计读盘次数）
  fs.writeFileSync(
    path.join(dir, 'file-stub.mjs'),
    [
      "import fs from 'node:fs'",
      "import path from 'node:path'",
      `const SRC_ROOT = ${JSON.stringify(SRC)}`,
      'export const state = { reads: [], failures: [] }',
      'export function reset() { state.reads = []; state.failures = [] }',
      'export default {',
      '  readText(options) {',
      '    const { uri, success, fail: failCb } = options || {}',
      '    state.reads.push(uri)',
      "    const full = path.join(SRC_ROOT, String(uri).replace(/^\\//, ''))",
      '    try {',
      '      const text = fs.readFileSync(full, "utf8")',
      '      if (success) success({ text })',
      '    } catch (error) {',
      '      state.failures.push(uri)',
      '      if (failCb) failCb({}, 404)',
      '    }',
      '  },',
      '}',
    ].join('\n'),
    'utf8'
  )
  return dir
}

// ---------------------------------------------------------------- 主流程
const tempDir = prepareTempModules()
const engine = await import(pathToFileURL(path.join(tempDir, 'engine.mjs')).href)
const reader = await import(pathToFileURL(path.join(tempDir, 'reader.mjs')).href)
const storyModule = await import(pathToFileURL(path.join(tempDir, 'story.mjs')).href)
const storageStub = await import(pathToFileURL(path.join(tempDir, 'storage-stub.mjs')).href)
const fileStub = await import(pathToFileURL(path.join(tempDir, 'file-stub.mjs')).href)
void storageStub

// 读全部剧本
const index = JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'index.json'), 'utf8'))
const nodes = []
for (const chunk of index.chunks) {
  const chunkNodes = JSON.parse(fs.readFileSync(path.join(STORY_DIR, path.basename(chunk.file)), 'utf8'))
  for (let i = 0; i < chunk.count; i += 1) nodes[chunk.start + i] = chunkNodes[i]
}
const story = Object.assign({}, index, { nodes })
const assetsModule = await import(pathToFileURL(path.join(tempDir, 'assets.mjs')).href)
const ASSET_URI = assetsModule.IMG
stats.nodeCount = nodes.length
stats.chunkCount = index.chunks.length
stats.chapterCount = index.chapters.length
assert(nodes.length === EXPECTED_NODES, `节点总数 ${nodes.length} != ${EXPECTED_NODES}`)
assert(index.chapters.length === EXPECTED_CHAPTERS, `章节数 ${index.chapters.length} != ${EXPECTED_CHAPTERS}`)
for (let i = 0; i < nodes.length; i += 1) {
  if (!nodes[i]) {
    fail(`节点 ${i} 缺失`)
    break
  }
}

// 章节工具
function chapterIndexOf(pc) {
  return engine.chapterIndex(story, pc)
}
function chapterIdOf(pc) {
  const idx = chapterIndexOf(pc)
  return index.chapters[idx] ? index.chapters[idx].id : '(none)'
}

// 选项后继的 flag 增量（沿 j 链最多看 10 步）
function flagGainAt(targetIndex, flag) {
  let node = nodes[targetIndex]
  let guard = 0
  while (node && guard++ < 10) {
    if ((node.t === 'f' || node.t === 'sf') && node.v === flag) return node.n
    if (node.t === 'j') {
      node = nodes[node.j]
      continue
    }
    break
  }
  return 0
}

// ---------------------------------------------------------------- 1. 引擎纯函数
check('testCond 条件求值', () => {
  const flags = { a: 3, b: 0 }
  assert(engine.testCond(flags, { v: 'a', op: '>=', n: 3 }) === true, 'a>=3 应为 true')
  assert(engine.testCond(flags, { v: 'a', op: '>', n: 3 }) === false, 'a>3 应为 false')
  assert(engine.testCond(flags, { v: 'a', op: '<=', n: 3 }) === true, 'a<=3 应为 true')
  assert(engine.testCond(flags, { v: 'a', op: '<', n: 4 }) === true, 'a<4 应为 true')
  assert(engine.testCond(flags, { v: 'a', op: '==', n: 3 }) === true, 'a==3 应为 true')
  assert(engine.testCond(flags, { v: 'missing', op: '==', n: 0 }) === true, '缺失 flag 视为 0')
  assert(engine.testCond(flags, null) === true, '空条件应为 true')
  return 'ok'
})

check('choicesOf 条件选项过滤（真实节点 4797）', () => {
  const node = nodes[4797]
  assert(node && node.t === 'o', '节点 4797 应为选项节点')
  const noFlag = engine.choicesOf({}, node)
  const flag3 = engine.choicesOf({ true_end_flag: 3 }, node)
  const flag4 = engine.choicesOf({ true_end_flag: 4 }, node)
  assert(noFlag.length === 2, `无 flag 时应 2 个选项，实际 ${noFlag.length}`)
  assert(flag3.length === 2, `flag=3 时应 2 个选项，实际 ${flag3.length}`)
  assert(flag4.length === 3, `flag=4 时应 3 个选项，实际 ${flag4.length}`)
  assert(flag4[2].j === 4800, '第 3 个选项应跳 4800')
  return `选项数 2/2/3`
})

check('executeNode 语义（bg/cs/cg/tint/flags/跳转）', () => {
  const state = engine.createState()
  assert(state.pc === 0 && state.showBlack === true && Array.isArray(state.cs), 'createState 默认值异常')
  let res = engine.executeNode(state, { t: 's', n: 'A', x: 'hi', bg: 0, cs: [{ k: 'x', i: 40, s: 'left' }], cg: 93, tint: 'memory' }, story)
  assert(res.action === 'say', 'say 节点动作应为 say')
  assert(state.bgSrc === '/common/img/b/box_seat.png', `bg 继承异常: ${state.bgSrc}`)
  assert(state.showBlack === false, 'bg>=0 时 showBlack 应为 false')
  assert(state.cs.length === 1, 'cs 应继承')
  assert(state.cgSrc === '/common/img/c/cg_001.png', `cg 继承异常: ${state.cgSrc}`)
  assert(state.tint === 'memory', 'tint 应继承')
  res = engine.executeNode(state, { t: 'sf', v: 'flagA', n: 2 }, story)
  assert(res.action === 'next' && state.flags.flagA === 2, 'sf 应设置 flag 并 next')
  assert(state.pc === 1, 'sf 后 pc 应 +1')
  res = engine.executeNode(state, { t: 'f', v: 'flagA', n: 3 }, story)
  assert(state.flags.flagA === 5 && state.pc === 2, 'f 应累加 flag')
  res = engine.executeNode(state, { t: 'j', j: 100 }, story)
  assert(res.action === 'next' && state.pc === 100, 'j 应跳转')
  res = engine.executeNode(state, { t: 'cj', v: 'flagA', op: '>=', n: 5, j: 200 }, story)
  assert(state.pc === 200, 'cj 条件成立应跳到 j')
  state.pc = 300
  res = engine.executeNode(state, { t: 'cj', v: 'flagA', op: '>', n: 99, j: 200 }, story)
  assert(state.pc === 301, 'cj 条件不成立应 pc+1')
  res = engine.executeNode(state, { t: 'o', o: [{ x: 'a', j: 10 }] }, story)
  assert(res.action === 'choice' && res.choices.length === 1, 'choice 动作异常')
  res = engine.executeNode(state, { t: 'e', x: 'end' }, story)
  assert(res.action === 'end', 'end 动作异常')
  res = engine.executeNode(state, null, story)
  assert(res.action === 'end', '空节点应安全返回 end')
  // bg 切换但无 cs 时清空立绘
  state.cs = [{ k: 'y', i: 41, s: 'left' }]
  state.cgSrc = '/common/img/c/cg_001.png'
  engine.executeNode(state, { t: 's', x: 'x', bg: 1 }, story)
  assert(state.cs.length === 0, 'bg 切换（无 cs）应清空立绘')
  // bg=-1 纯黑 / bg=-2 纯白
  engine.executeNode(state, { t: 's', x: 'x', bg: -1 }, story)
  assert(state.showBlack === true, 'bg=-1 应 showBlack')
  engine.executeNode(state, { t: 's', x: 'x', bg: -2 }, story)
  assert(state.showWhite === true, 'bg=-2 应 showWhite')
  return 'ok'
})

check('renderSprites 三槽位（含 c 归一为 center）', () => {
  const sp = engine.renderSprites([
    { k: 'a', i: 39, s: 'left' },
    { k: 'b', i: 40, s: 'right' },
    { k: 'c', i: 41, s: 'c' },
    { k: 'd', i: 42, s: 'center' },
  ])
  assert(sp.left === '/common/img/s/001.png', 'left 槽异常')
  assert(sp.center === '/common/img/s/004.png', 'center 槽应取最后一个（42）')
  assert(sp.right === '/common/img/s/002.png', 'right 槽异常')
  const empty = engine.renderSprites([])
  assert(empty.left === '' && empty.center === '' && empty.right === '', '空立绘应为空串')
  return 'ok'
})

check('chapterIndex / chapterProgress', () => {
  index.chapters.forEach((chapter, i) => {
    assert(chapterIndexOf(chapter.start) === i, `章节 ${i}(${chapter.id}) start=${chapter.start} 的 chapterIndex 应为 ${i}，实际 ${chapterIndexOf(chapter.start)}`)
  })
  const progress = engine.chapterProgress(story, 0)
  assert(progress.title === index.chapters[0].title, 'chapterProgress(0).title 异常')
  assert(progress.percent >= 0 && progress.percent <= 99, `progress 百分比越界: ${progress.percent}`)
  index.chapters.forEach((chapter, i) => {
    const end = index.chapters[i + 1] ? index.chapters[i + 1].start : index.nodeCount
    const p = engine.chapterProgress(story, end - 1)
    assert(p.index === i, `章节 ${i} 末节点 progress.index 应为 ${i}，实际 ${p.index}`)
    assert(p.percent <= 99 && p.percent >= 0, `章节 ${i} percent 越界`)
  })
  return 'ok'
})

check('visibleChapters / nextVisibleChapter（未通关 14 / 通关 15）', () => {
  const notCleared = engine.visibleChapters(story, false, 0)
  const cleared = engine.visibleChapters(story, true, 0)
  stats.visibleNotCleared = notCleared.length
  stats.visibleCleared = cleared.length
  assert(notCleared.length === 14, `未通关可见章节应 14，实际 ${notCleared.length}`)
  assert(cleared.length === 15, `通关后可见章节应 15，实际 ${cleared.length}`)
  const hiddenIds = ['end_te', 'end_ne1', 'end_ne2']
  for (const id of hiddenIds) {
    const chapter = index.chapters.find((item) => item.id === id)
    assert(!notCleared.some((item) => item.start === chapter.start), `隐藏结局章 ${id} 不应出现在未通关列表`)
    assert(!cleared.some((item) => item.start === chapter.start), `隐藏结局章 ${id} 不应出现在通关列表`)
  }
  const needChapter = index.chapters.find((item) => item.need)
  assert(!notCleared.some((item) => item.start === needChapter.start), '后日谈不应在未通关列表')
  assert(cleared.some((item) => item.start === needChapter.start), '后日谈应在通关列表')
  assert(cleared[cleared.length - 1].title === needChapter.title, '通关列表最后一项应为后日谈')
  // no 从 1 开始递增
  cleared.forEach((item, i) => assert(item.no === i + 1, `可见章节 no 应从 1 递增（第 ${i} 项为 ${item.no}）`))
  // nextVisibleChapter：第 13 章（3_4）之后没有可跳过章节（14/15/16 隐藏、17 需通关）
  assert(engine.nextVisibleChapter(story, false, index.chapters[13].start) === null, '未通关时 3_4 之后应无下一章')
  const nextChapter = engine.nextVisibleChapter(story, false, index.chapters[0].start)
  assert(nextChapter && nextChapter.start === index.chapters[1].start, '第 1 章之后应跳到第 2 章')
  const nextFromTe = engine.nextVisibleChapter(story, true, index.chapters[13].start)
  assert(nextFromTe && nextFromTe.start === needChapter.start, '通关后 3_4 之后应跳后日谈')
  return `notCleared=${notCleared.length} cleared=${cleared.length}`
})

check('存档 normalize/apply/describe 边界', () => {
  assert(engine.normalizeSave(null) === null, 'null 存档应为 null')
  assert(engine.normalizeSave({}) === null, '缺 magic 应为 null')
  assert(engine.normalizeSave({ magic: 'wrong' }) === null, '错误 magic 应为 null')
  const state = engine.createState()
  assert(engine.applySave(state, { magic: 'wrong' }) === false, 'applySave 应拒绝错误存档')
  const save = engine.collectSave(state, story, '第一行\n第二行')
  assert(save.magic === engine.SAVE_MAGIC, 'collectSave magic 异常')
  assert(save.text === '第一行', 'collectSave 只取第一行')
  assert(engine.describeSave(save).indexOf('第1章') === 0, `describeSave 异常: ${engine.describeSave(save)}`)
  assert(engine.describeSave(null) === '（空）', '空存档描述应为（空）')
  const longText = '一'.repeat(40)
  assert(engine.collectSave(state, story, longText).text.length === 25, '长文本截断应为 24+… = 25 字符')
  return 'ok'
})

// ---------------------------------------------------------------- 2. 全节点顺序执行
check('全 5569 节点顺序执行不越界', () => {
  const actions = { say: 0, choice: 0, end: 0, next: 0 }
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const state = engine.createState()
    state.pc = i
    const res = engine.executeNode(state, node, story)
    assert(state.pc >= 0 && state.pc <= nodes.length, `节点 ${i} 执行后 pc 越界：${state.pc}`)
    if (node.t === 's' || node.t === 'o' || node.t === 'e') {
      assert(state.pc === i, `节点 ${i}(${node.t}) 不应改变 pc（实际 ${state.pc}）`)
    }
    if (node.t === 'j') assert(state.pc === node.j, `节点 ${i} j 执行后 pc 应为 ${node.j}`)
    if (node.t === 'cj') assert(state.pc === node.j || state.pc === i + 1, `节点 ${i} cj 执行后 pc 非法：${state.pc}`)
    if (node.t === 'f' || node.t === 'sf') assert(state.pc === i + 1, `节点 ${i} ${node.t} 后 pc 应为 ${i + 1}`)
    actions[res.action] = (actions[res.action] || 0) + 1
    if (res.action === 'choice') {
      assert(res.choices.length > 0, `选项节点 ${i} 过滤后没有任何选项`)
      for (const choice of res.choices) assert(choice.j >= 0 && choice.j < nodes.length, `节点 ${i} 选项目标越界 ${choice.j}`)
    }
  }
  stats.nodeActionCounts = actions
  return `say=${actions.say} choice=${actions.choice} end=${actions.end} next=${actions.next}`
})

// ---------------------------------------------------------------- 3. 策略模拟
function simulate(choose) {
  const state = engine.createState()
  state.pc = 0
  const visitedChapters = new Set()
  const choiceLog = []
  const afterStoryStart = index.chapters.find((chapter) => chapter.id === 'after_story_noctella').start
  let enteredAfterStory = false
  let steps = 0
  let result = null
  while (steps < STEP_LIMIT) {
    steps += 1
    if (state.pc < 0 || state.pc >= nodes.length) {
      return { result: 'out-of-bounds', steps, state, choiceLog, visitedChapters, enteredAfterStory, pc: state.pc }
    }
    if (state.pc >= afterStoryStart && state.pc < nodes.length - 1) enteredAfterStory = true
    const node = nodes[state.pc]
    if (node.t !== 'e') visitedChapters.add(chapterIndexOf(state.pc))
    if (node.t === 'o') {
      const choices = engine.choicesOf(state.flags, node)
      if (!choices.length) return { result: 'no-choices', steps, state, choiceLog, visitedChapters, enteredAfterStory, pc: state.pc }
      const chosenIndex = Math.max(0, Math.min(choices.length - 1, choose({ node, choices, state, pc: state.pc, steps })))
      const chosen = choices[chosenIndex]
      choiceLog.push({ pc: state.pc, index: chosenIndex, x: chosen.x, j: chosen.j })
      state.pc = chosen.j
      continue
    }
    const res = engine.executeNode(state, node, story)
    if (res.action === 'say') {
      state.pc += 1
      continue
    }
    if (res.action === 'end') {
      result = { result: 'end', steps, state, choiceLog, visitedChapters, enteredAfterStory, pc: state.pc, endNode: node }
      break
    }
  }
  if (!result) return { result: 'step-limit', steps, state, choiceLog, visitedChapters, enteredAfterStory, pc: state.pc }
  return result
}

function gainPreference(choices, flag) {
  return choices.map((choice) => flagGainAt(choice.j, flag))
}

function pickByGain(choices, gains, mode) {
  let best = 0
  for (let i = 1; i < choices.length; i += 1) {
    if (mode === 'max' ? gains[i] > gains[best] : gains[i] < gains[best]) best = i
  }
  return best
}

const strategies = [
  {
    name: 'S1 总选第一个',
    choose: () => 0,
    expect: { badEnd: true },
  },
  {
    name: 'S2 总选最后一个',
    choose: ({ choices }) => choices.length - 1,
    expect: { badEnd: true },
  },
  {
    name: 'S3 全 flag 拉满 + 真结局',
    choose: ({ node, choices, pc }) => {
      // 结局选择处（4797）：第 3 个选项带 true_end_flag>=4 条件，即真结局
      if (node === nodes[4797] && choices.length === 3) return 2
      const teGains = gainPreference(choices, 'true_end_flag')
      const badGains = gainPreference(choices, 'bad_end_flag')
      let idx = pickByGain(choices, teGains, 'max')
      if (teGains[idx] === 0) idx = pickByGain(choices, badGains, 'max')
      void pc
      return idx
    },
    expect: { chapterId: 'end_te', trueEndFinish: true, visitsAfterStory: true, finalEndPc: 5568 },
  },
  {
    name: 'S4 只拉真结局 flag（bad_end_flag<7）',
    choose: ({ choices }) => {
      const teGains = gainPreference(choices, 'true_end_flag')
      let idx = pickByGain(choices, teGains, 'max')
      if (teGains[idx] === 0) {
        const badGains = gainPreference(choices, 'bad_end_flag')
        idx = pickByGain(choices, badGains, 'min')
      }
      return idx
    },
    expect: { badEnd: true },
  },
  {
    name: 'S5 bad_end_flag 拉满 + 放手（NE2）',
    choose: ({ choices }) => {
      const badGains = gainPreference(choices, 'bad_end_flag')
      let idx = pickByGain(choices, badGains, 'max')
      if (badGains[idx] === 0) {
        const teGains = gainPreference(choices, 'true_end_flag')
        idx = pickByGain(choices, teGains, 'min')
      }
      return idx
    },
    expect: { chapterId: 'end_ne2', noAfterStory: true },
  },
  {
    name: 'S6 bad_end_flag 拉满 + 诞生（NE1）',
    choose: ({ choices, pc }) => {
      const badGains = gainPreference(choices, 'bad_end_flag')
      let idx = pickByGain(choices, badGains, 'max')
      if (badGains[idx] === 0) {
        const teGains = gainPreference(choices, 'true_end_flag')
        idx = pickByGain(choices, teGains, 'min')
      }
      if (pc === 4797) idx = 1 // 「要让小涟诞生」→ NE1
      return idx
    },
    expect: { chapterId: 'end_ne1', noAfterStory: true },
  },
  {
    name: 'S7 条件选项过滤（flag=3 时第 3 个选项不可见 → 回落第一个）',
    choose: ({ choices, pc }) => {
      if (pc === 4797) {
        // 第三个选项需要 true_end_flag>=4；flag 不足时应只剩 2 个，选第一个（放手 → NE2）
        return 0
      }
      const badGains = gainPreference(choices, 'bad_end_flag')
      let idx = pickByGain(choices, badGains, 'max')
      if (badGains[idx] === 0) {
        const teGains = gainPreference(choices, 'true_end_flag')
        // 3_4 选择处（4146）故意不拿真结局 flag，保持 flag=3
        if (pc === 4146) idx = pickByGain(choices, teGains, 'min')
        else idx = pickByGain(choices, teGains, 'max')
      }
      return idx
    },
    expect: { chapterId: 'end_ne2', noAfterStory: true },
  },
  {
    name: 'S8 确定性伪随机',
    choose: ({ choices, pc, steps }) => (pc * 31 + steps * 7) % choices.length,
    expect: {},
  },
]

const strategyResults = []
check('8 条策略跑全剧本并到达结局', () => {
  for (const strategy of strategies) {
    const run = simulate(strategy.choose)
    const visitedChapterIds = Array.from(run.visitedChapters).sort((a, b) => a - b).map((i) => (index.chapters[i] ? index.chapters[i].id : '?'))
    const record = {
      name: strategy.name,
      result: run.result,
      steps: run.steps,
      endPc: run.pc,
      endText: run.endNode ? run.endNode.x : '',
      visitedChapters: visitedChapterIds,
      choices: run.choiceLog.length,
      badEnd: run.pc === 4345,
      enteredAfterStory: run.enteredAfterStory,
      trueEndFinish: !!(run.state && run.state.flags && run.state.flags.true_end_finish === 1),
      finalFlags: run.state ? run.state.flags : {},
    }
    strategyResults.push(record)
    assert(run.result === 'end', `策略 "${strategy.name}" 未正常到达结局（result=${run.result}, pc=${run.pc}, steps=${run.steps}）`)
    if (strategy.expect.badEnd) {
      assert(record.badEnd, `策略 "${strategy.name}" 应到达 Bad End（4345），实际 endPc=${run.pc}`)
    }
    if (strategy.expect.chapterId) {
      assert(visitedChapterIds.includes(strategy.expect.chapterId), `策略 "${strategy.name}" 应经过 ${strategy.expect.chapterId}，实际经过 ${visitedChapterIds.join(',')}`)
    }
    if (strategy.expect.trueEndFinish) {
      assert(record.trueEndFinish, `策略 "${strategy.name}" 应设置 true_end_finish`)
    }
    if (strategy.expect.visitsAfterStory) {
      const after = index.chapters.find((c) => c.id === 'after_story_noctella')
      assert(visitedChapterIds.includes('after_story_noctella'), `真结局后应进入后日谈（节点 ${after.start}）`)
      assert(run.enteredAfterStory, `真结局应真正遍历后日谈节点 ${after.start}..${nodes.length - 2}`)
      assert(run.pc === 5568, `真结局最终应到达剧终节点 5568，实际 ${run.pc}`)
      assert(run.state.flags.true_end_finish === 1, '真结局应设置 true_end_finish=1')
      assert(run.state.flags.bad_end_flag === 7, `真结局应 bad_end_flag=7（实际 ${run.state.flags.bad_end_flag}）`)
      assert(run.state.flags.true_end_flag === 4, `真结局应 true_end_flag=4（实际 ${run.state.flags.true_end_flag}）`)
    }
    if (strategy.expect.noAfterStory) {
      assert(!run.enteredAfterStory, `策略 "${strategy.name}" 非真结局不应进入后日谈节点`)
    }
  }
  stats.strategies = strategyResults.map((item) => ({
    name: item.name,
    result: item.result,
    steps: item.steps,
    endPc: item.endPc,
    badEnd: item.badEnd,
    trueEndFinish: item.trueEndFinish,
    chapters: item.visitedChapters,
  }))
  return `${strategyResults.length} 条策略全部到达结局`
})

check('3 结局 + Bad End 均可达', () => {
  const reached = new Set()
  for (const item of strategyResults) {
    if (item.badEnd) reached.add('bad_end')
    for (const id of item.visitedChapters) {
      if (['end_te', 'end_ne1', 'end_ne2'].includes(id)) reached.add(id)
    }
  }
  stats.reachedEndings = Array.from(reached).sort()
  for (const id of ['bad_end', 'end_te', 'end_ne1', 'end_ne2']) {
    assert(reached.has(id), `结局 ${id} 未被任一策略到达（实际 ${stats.reachedEndings.join(',')}）`)
  }
  return stats.reachedEndings.join(', ')
})

check('true_end_finish 通关判定（cleared 与后日谈）', () => {
  const teRun = strategyResults.find((item) => item.trueEndFinish)
  assert(teRun, '没有找到设置 true_end_finish 的策略')
  // 通关后：可见 15 章、含后日谈；未通关：14 章、不含后日谈；结局章（hide）永不出现
  const cleared = engine.visibleChapters(story, true, 5568)
  const notCleared = engine.visibleChapters(story, false, 5568)
  assert(cleared.length === 15 && notCleared.length === 14, `通关/未通关可见章节数异常：${cleared.length}/${notCleared.length}`)
  const needChapter = index.chapters.find((item) => item.need)
  assert(!notCleared.some((item) => item.start === needChapter.start), '未通关不应看到后日谈')
  assert(cleared.some((item) => item.start === needChapter.start), '通关后应看到后日谈')
  for (const id of ['end_te', 'end_ne1', 'end_ne2']) {
    const chapter = index.chapters.find((item) => item.id === id)
    assert(!cleared.some((item) => item.start === chapter.start), `结局章 ${id} 不应出现在章节列表`)
  }
  return `cleared=${cleared.length} notCleared=${notCleared.length}`
})

// ---------------------------------------------------------------- 4. 存档往返（每个 say 节点）
check('每个 say 节点存档 collect→JSON→normalize→apply 往返一致', () => {
  let count = 0
  const state = engine.createState()
  // 顺序扫描维护“继承后的画面状态”，得到更真实的存档快照
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.bg !== undefined) {
      state.bgSrc = node.bg >= 0 ? ASSET_URI[node.bg] || '' : ''
      state.showBlack = node.bg === -1
      state.showWhite = node.bg === -2
      if (node.cs === undefined) state.cs = []
    }
    if (node.cs !== undefined) state.cs = node.cs.slice()
    if (node.cg !== undefined) state.cgSrc = node.cg >= 0 ? ASSET_URI[node.cg] || '' : ''
    if (node.tint !== undefined) state.tint = node.tint
    if ((node.t === 'f' || node.t === 'sf') && node.v) {
      if (node.t === 'sf') state.flags[node.v] = node.n || 0
      else state.flags[node.v] = (state.flags[node.v] || 0) + (node.n || 0)
    }
    if (node.t !== 's') continue
    state.pc = i
    const save = engine.collectSave(state, story, node.x)
    const roundTrip = JSON.parse(JSON.stringify(save))
    const normalized = engine.normalizeSave(roundTrip)
    assert(normalized !== null, `say 节点 ${i} 存档 normalize 失败`)
    const target = engine.createState()
    assert(engine.applySave(target, roundTrip) === true, `say 节点 ${i} applySave 失败`)
    const expected = engine.normalizeSave(save)
    const actual = {
      magic: engine.SAVE_MAGIC,
      pc: target.pc,
      chapter: chapterIndexOf(target.pc),
      flags: target.flags,
      bgSrc: target.bgSrc,
      showBlack: target.showBlack,
      showWhite: target.showWhite,
      cs: target.cs,
      cgSrc: target.cgSrc,
      tint: target.tint,
      text: expected.text,
      at: expected.at,
    }
    assert(deepEqual(actual, expected), `say 节点 ${i} 存档往返不一致：${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
    assert(engine.describeSave(roundTrip).indexOf('第') === 0, `say 节点 ${i} describeSave 异常`)
    count += 1
  }
  stats.saveRoundTripCount = count
  assert(count === 5457, `say 节点数 ${count}，期望 5457`)
  return `${count} 个 say 节点全部一致`
})

// ---------------------------------------------------------------- 5. loader（story.js）
check('readStoryIndex 读取索引', () => {
  fileStub.reset()
  let received = null
  let errorMessage = ''
  storyModule.readStoryIndex((idx, err) => {
    received = idx
    errorMessage = err
  })
  assert(received !== null, `readStoryIndex 失败：${errorMessage}`)
  assert(received.nodeCount === EXPECTED_NODES, 'readStoryIndex nodeCount 异常')
  assert(received.chunks.length === 44, 'readStoryIndex chunks 数异常')
  assert(fileStub.state.reads.length === 1, `readStoryIndex 应读 1 次盘，实际 ${fileStub.state.reads.length}`)
  return 'ok'
})

check('loader 读取全部 44 分块 + 缓存命中不重复读盘', () => {
  fileStub.reset()
  const loader = storyModule.createStoryLoader()
  let loaded = 0
  let totalNodes = 0
  for (const chunk of index.chunks) {
    loader.readChunk(chunk, (chunkNodes) => {
      assert(chunkNodes !== null, `读取分块 ${chunk.file} 失败`)
      assert(chunkNodes.length === chunk.count, `分块 ${chunk.file} 节点数 ${chunkNodes ? chunkNodes.length : 0} != ${chunk.count}`)
      loaded += 1
      totalNodes += chunkNodes.length
    })
  }
  assert(loaded === 44, `应加载 44 个分块，实际 ${loaded}`)
  assert(totalNodes === EXPECTED_NODES, `分块节点总数 ${totalNodes} != ${EXPECTED_NODES}`)
  const firstReads = fileStub.state.reads.length
  assert(firstReads === 44, `首次读取应读盘 44 次，实际 ${firstReads}`)
  // 再读一遍全部命中缓存
  for (const chunk of index.chunks) loader.readChunk(chunk, () => {})
  assert(fileStub.state.reads.length === firstReads, `缓存未命中（读盘 ${fileStub.state.reads.length} 次）`)
  return `44 分块 / ${totalNodes} 节点`
})

check('loader trim 淘汰 + prefetch 预读', () => {
  fileStub.reset()
  const loader = storyModule.createStoryLoader()
  const chunk0 = index.chunks[0]
  const chunk1 = index.chunks[1]
  const chunk2 = index.chunks[2]
  loader.readChunk(chunk0, () => {})
  loader.readChunk(chunk1, () => {})
  // trim 到 chunk0 位置：保留 chunk0/chunk1
  loader.trim(chunk0.start, index.chunks)
  const before = fileStub.state.reads.length
  loader.readChunk(chunk0, () => {})
  loader.readChunk(chunk1, () => {})
  assert(fileStub.state.reads.length === before, 'trim 后当前块/下一块应仍在缓存')
  // prefetch：当前位置 chunk0，下一块 chunk1 已缓存不重复读; 构造位置 chunk1 -> prefetch chunk2
  loader.prefetch(chunk1.start, index.chunks)
  assert(fileStub.state.reads.length === before + 1, `prefetch 应预读 1 块，实际新增 ${fileStub.state.reads.length - before}`)
  // 读 chunk5 后 trim 到 chunk5，chunk0 被淘汰
  loader.readChunk(index.chunks[5], () => {})
  loader.trim(index.chunks[5].start, index.chunks)
  const beforeReload = fileStub.state.reads.length
  loader.readChunk(chunk0, () => {})
  assert(fileStub.state.reads.length === beforeReload + 1, 'trim 后远端块应被淘汰并重新读盘')
  return 'ok'
})

check('loader 坏分块 / 空 chunk 回调 null', () => {
  fileStub.reset()
  const loader = storyModule.createStoryLoader()
  let got = 'unset'
  loader.readChunk(null, (chunkNodes) => {
    got = chunkNodes
  })
  assert(got === null, `空 chunk 应回调 null，实际 ${got}`)
  let bad = 'unset'
  loader.readChunk({ file: '/common/story/chunk-999.json', start: 9999, count: 1 }, (chunkNodes) => {
    bad = chunkNodes
  })
  assert(bad === null, '坏分块应回调 null')
  return 'ok'
})

check('chunkOf / chunkPosition 边界', () => {
  assert(storyModule.chunkOf(0, index.chunks).start === 0, '节点 0 应在 chunk 0')
  assert(storyModule.chunkOf(127, index.chunks).start === 0, '节点 127 应在 chunk 0')
  assert(storyModule.chunkOf(128, index.chunks).start === 128, '节点 128 应在 chunk 1')
  assert(storyModule.chunkOf(5568, index.chunks).start === 5504, '节点 5568 应在最后一个分块')
  assert(storyModule.chunkOf(5569, index.chunks) === null, '节点 5569 应越界返回 null')
  assert(storyModule.chunkOf(-1, index.chunks) === null, '节点 -1 应越界返回 null')
  assert(storyModule.chunkPosition(5568, index.chunks) === 43, '节点 5568 分块下标应为 43')
  return 'ok'
})

check('storage 设置读写（readJSON/writeJSON/loadSettings 走 stub）', () => {
  storageStub.reset()
  let settings = null
  reader.loadSettings((value) => {
    settings = value
  })
  assert(settings && settings.size === reader.DEFAULT_SETTINGS.size, 'loadSettings 默认值异常')
  reader.saveSettings(Object.assign({}, reader.DEFAULT_SETTINGS, { size: 26, speed: 0 }), (ok) => {
    assert(ok === true, 'saveSettings 回调失败')
  })
  let reloaded = null
  reader.loadSettings((value) => {
    reloaded = value
  })
  assert(reloaded.size === 26 && reloaded.speed === 0, `loadSettings 读回异常: ${JSON.stringify(reloaded)}`)
  assert(reloaded.fast === false, 'saveSettings 不应持久化 fast')
  // 坏 JSON -> fallback
  storageStub.state.map.set('settings', '{bad json')
  let fallback = null
  reader.loadSettings((value) => {
    fallback = value
  })
  assert(fallback && fallback.size === reader.DEFAULT_SETTINGS.size, '坏 JSON 应回退默认设置')
  return 'ok'
})

// ---------------------------------------------------------------- 输出
const pass = failures.length === 0
const report = {
  tool: 'tools/test-engine.mjs',
  generatedAt: new Date().toISOString(),
  pass,
  failures,
  checks,
  stats,
}
console.log('==== 引擎/剧本逻辑测试 (tools/test-engine.mjs) ====')
console.log(`剧本: ${stats.nodeCount} 节点 / ${stats.chunkCount} 分块 / ${stats.chapterCount} 章节`)
if (stats.reachedEndings) console.log(`可达结局: ${stats.reachedEndings.join(', ')}`)
console.log('')
for (const item of checks) {
  console.log(`  [${item.pass ? 'PASS' : 'FAIL'}] ${item.name}${item.detail ? '  → ' + item.detail : ''}`)
}
if (strategyResults.length) {
  console.log('')
  console.log('策略结果：')
  for (const item of strategyResults) {
    console.log(
      `  ${item.name}: ${item.result}（steps=${item.steps}, endPc=${item.endPc}, badEnd=${item.badEnd}, trueEndFinish=${item.trueEndFinish}）`
    )
    console.log(`      经过章节: ${item.visitedChapters.join(' → ')}`)
  }
}
if (failures.length) {
  console.log('')
  console.log(`失败 ${failures.length} 条：`)
  failures.slice(0, 40).forEach((message) => console.log(`  [fail] ${message}`))
}
console.log('')
console.log(`[test-engine] 结果: ${pass ? 'PASS' : 'FAIL'}  checks=${checks.length} failures=${failures.length}`)

try {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'test-engine.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('[test-engine] JSON 报告: scripts/reports/test-engine.json')
} catch (error) {
  console.error(`[test-engine] 写 JSON 报告失败：${error.message}`)
}

try {
  fs.rmSync(tempDir, { recursive: true, force: true })
} catch (error) {
  /* ignore */
}

process.exit(pass ? 0 : 1)
