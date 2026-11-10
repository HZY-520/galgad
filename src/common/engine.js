/**
 * 剧本引擎（纯函数，可在 Node 里直接测试，见 tools/test-engine.mjs）。
 *
 * 从 galgod-band（Vela 版）pages/game/game.ux 里抽出来的无 UI 逻辑：
 *  - 节点执行（画面状态继承、bg/cs/cg/tint、flags、条件跳转）
 *  - 选项过滤、条件求值
 *  - 章节索引 / 进度 / 可见章节列表（结局隐藏、后日谈需要通关）
 *  - 存档快照 collectSave / applySave（字段与源工程保存格式一致）
 *
 * state 的字段（UI 无关，Game 页把它绑到 data 上）：
 *   pc      当前节点下标
 *   flags   好感/答题计数等标记
 *   bgSrc   背景 URI（'' 表示无背景；showBlack/showWhite 为纯色层）
 *   cs      立绘数组 [{i: 图片下标, s: 'left'|'center'|'right'}]
 *   cgSrc   CG URI（'' 表示无）
 *   tint    回忆滤镜标记（'memory' 或 ''）
 */
import { imageUri } from './asset.js'

export const SAVE_MAGIC = 'galgod-band-1'

export function createState() {
  return {
    pc: 0,
    flags: {},
    bgSrc: '',
    showBlack: true,
    showWhite: false,
    cs: [],
    cgSrc: '',
    tint: '',
  }
}

// ---------------------------------------------------------------- 条件与选项
/** cond 支持 {v,op,n} 或 [v,op,n]（选项条件） */
export function testCond(flags, cond) {
  if (!cond) return true
  const v = flags[cond.v] || 0
  const n = cond.n
  if (cond.op === '>=') return v >= n
  if (cond.op === '<=') return v <= n
  if (cond.op === '>') return v > n
  if (cond.op === '<') return v < n
  return v === n
}

/** 过滤出当前可显示的选项：[{x, j}] */
export function choicesOf(flags, node) {
  const out = []
  const opts = (node && node.o) || []
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i]
    if (o.c && !testCond(flags, { v: o.c[0], op: o.c[1], n: o.c[2] })) continue
    out.push({ x: o.x, j: o.j })
  }
  return out
}

// ---------------------------------------------------------------- 节点执行
/**
 * 执行一个节点里的所有「非交互」内容，并返回下一步动作：
 *   { action: 'say', node }     台词：需要 UI 展示，pc 停在当前节点
 *   { action: 'choice', choices } 选项：需要 UI 展示，pc 停在当前节点
 *   { action: 'end', node }     结局：需要 UI 展示
 *   { action: 'next' }          已推进 pc，调用方继续循环
 * 注意：画面状态（bg/cs/cg/tint）在本函数里统一继承，与源工程语义一致：
 *   `bg` 对应 Ren'Py 的 scene，会清空所有立绘；只有同一步带 cs 才会重新出现人物。
 */
export function executeNode(state, node, story) {
  if (!node) return { action: 'end', node: { x: '—— 全剧终 ——' } }

  if (node.bg !== undefined) {
    state.bgSrc = imageUri(node.bg)
    state.showBlack = node.bg === -1
    state.showWhite = node.bg === -2
    if (node.cs === undefined) state.cs = []
  }
  if (node.cs !== undefined) state.cs = node.cs.slice()
  if (node.cg !== undefined) {
    state.cgSrc = node.cg >= 0 ? imageUri(node.cg) : ''
    state.cgIndex = node.cg
  }
  if (node.tint !== undefined) state.tint = node.tint

  const t = node.t
  if (t === 's') return { action: 'say', node: node }
  if (t === 'o') return { action: 'choice', choices: choicesOf(state.flags, node) }
  if (t === 'e') return { action: 'end', node: node }

  if (t === 'f') {
    state.flags[node.v] = (state.flags[node.v] || 0) + node.n
    state.pc += 1
  } else if (t === 'sf') {
    state.flags[node.v] = node.n
    state.pc += 1
  } else if (t === 'j') {
    state.pc = node.j
  } else if (t === 'cj') {
    state.pc = testCond(state.flags, node) ? node.j : state.pc + 1
  } else {
    state.pc += 1
  }
  return { action: 'next' }
}

/** 立绘三槽位：只保留最后一个占据该槽位的人 */
export function renderSprites(cs) {
  let left = ''
  let center = ''
  let right = ''
  const list = cs || []
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    const src = imageUri(ch.i)
    if (ch.s === 'left') left = src
    else if (ch.s === 'right') right = src
    else center = src
  }
  return { left: left, center: center, right: right }
}

// ---------------------------------------------------------------- 章节
export function chapterIndex(story, pc) {
  if (!story || !story.chapters || !story.chapters.length) return 0
  const list = story.chapters
  let cur = 0
  for (let i = 0; i < list.length; i++) {
    if (pc >= list[i].start) cur = i
  }
  return cur
}

/** { title, percent, index } */
export function chapterProgress(story, pc) {
  if (!story || !story.chapters) return { title: '——', percent: 0, index: 0 }
  const list = story.chapters
  const i = chapterIndex(story, pc)
  const ch = list[i]
  if (!ch) return { title: '——', percent: 0, index: 0 }
  const end = list[i + 1] ? list[i + 1].start : story.nodeCount
  const span = Math.max(1, end - ch.start)
  const done = Math.max(0, Math.min(span, pc - ch.start))
  return {
    title: ch.title,
    percent: Math.min(99, Math.round(done * 100 / span)),
    index: i,
  }
}

/**
 * 章节选择里可见的章节：hide（3 个结局）永不显示；need（后日谈）只有通关后显示。
 * 返回 [{ title, start, no, current }]，no 从 1 开始。
 */
export function visibleChapters(story, cleared, pc) {
  const out = []
  if (!story || !story.chapters) return out
  const cur = chapterIndex(story, pc)
  const list = story.chapters
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c.hide) continue
    if (c.need && !cleared) continue
    out.push({ title: c.title, start: c.start, no: out.length + 1, current: i === cur })
  }
  return out
}

/** 「跳到下一章」：跳过结局章与未解锁的后日谈；没有下一章返回 null */
export function nextVisibleChapter(story, cleared, pc) {
  if (!story || !story.chapters) return null
  const list = story.chapters
  let i = chapterIndex(story, pc) + 1
  while (i < list.length && (list[i].hide || (list[i].need && !cleared))) i++
  return i < list.length ? list[i] : null
}

// ---------------------------------------------------------------- 存档
/** 生成与源工程一致的存档快照；text 用于存档列表预览 */
export function collectSave(state, story, pageText) {
  const ch = chapterIndex(story, state.pc)
  const text = String(pageText || '').split('\n')[0]
  return {
    magic: SAVE_MAGIC,
    pc: state.pc,
    chapter: ch,
    flags: Object.assign({}, state.flags),
    bgSrc: state.bgSrc || '',
    showBlack: !!state.showBlack,
    showWhite: !!state.showWhite,
    cs: (state.cs || []).slice(),
    cgSrc: state.cgSrc || '',
    tint: state.tint || '',
    text: text.length > 24 ? text.slice(0, 24) + '…' : text,
    at: Date.now(),
  }
}

/** 校验并归一化存档；无效返回 null */
export function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.magic !== SAVE_MAGIC) return null
  const pc = Math.max(0, parseInt(raw.pc, 10) || 0)
  return {
    magic: SAVE_MAGIC,
    pc: pc,
    chapter: Math.max(0, parseInt(raw.chapter, 10) || 0),
    flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
    bgSrc: String(raw.bgSrc || ''),
    showBlack: !!raw.showBlack,
    showWhite: !!raw.showWhite,
    cs: Array.isArray(raw.cs) ? raw.cs : [],
    cgSrc: String(raw.cgSrc || ''),
    tint: String(raw.tint || ''),
    text: String(raw.text || ''),
    at: Number(raw.at) || 0,
  }
}

/** 把存档写回 state；返回是否成功 */
export function applySave(state, save) {
  const data = normalizeSave(save)
  if (!data) return false
  state.flags = Object.assign({}, data.flags)
  state.bgSrc = data.bgSrc
  state.showBlack = data.showBlack
  state.showWhite = data.showWhite
  state.cs = data.cs.slice()
  state.cgSrc = data.cgSrc
  state.tint = data.tint
  state.pc = data.pc
  return true
}

/** 存档列表里的描述：第 N 章 · 台词预览 */
export function describeSave(save) {
  const data = normalizeSave(save)
  if (!data) return '（空）'
  const t = data.text || ''
  return '第' + (data.chapter + 1) + '章 · ' + (t.length > 12 ? t.slice(0, 12) + '…' : t)
}

export default {
  SAVE_MAGIC,
  createState,
  testCond,
  choicesOf,
  executeNode,
  renderSprites,
  chapterIndex,
  chapterProgress,
  visibleChapters,
  nextVisibleChapter,
  collectSave,
  normalizeSave,
  applySave,
  describeSave,
}
