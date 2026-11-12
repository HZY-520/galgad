/**
 * 版面几何与分页度量（设计 px，designWidth = 466）。
 *
 * 本文件是「运行时几何」的唯一来源：页面 CSS 的静态数值必须与这里一致
 * （tools/validate-pages.mjs 会逐项核对），而字号相关的实时数值由
 * readerLayout(size, shape) 直接算出来绑到行内 style 上。
 *
 * 设计要点（2026-11 真机回归）：字号相关的高度全部由 JS 算，不再写死在 CSS 里，
 * 因为「分页用一套行高、渲染用另一套行高」就是实机字幕显示不全的根因：
 * 分页算出 N 行、CSS 框只够 N-1.5 行，末行就被裁掉了。
 * 现在 textHeight = lines × lineHeight，面板高度 = 上留白 + textHeight + 下留白，
 * 分页与渲染共用同一组数字，任何字号下都不会裁字。
 *
 * 圆屏 watch-round 466x466：
 *   以 (233,233) 为圆心、半径 215 的安全圆内放对白与控件。
 *   正文块 300 宽 / left 83，底边距 84（角距圆心 211 < 215，再往下就会被圆边裁字，
 *   所以圆屏的正文底边已经是物理极限，面板底边只往下压到 72）。
 *   面板 340x198（占屏高 42.5%），上沿 y=196；说话人条骑在面板上沿。
 * 方屏 watch-square（vivo WATCH GT 2 432x514，设计高度 554）：
 *   面板 410x198、bottom 8（贴底），正文 340x168、bottom 20；顶部信息条 top 8（贴顶）。
 *
 * 顶部信息条：圆屏放在安全圆上沿能完整显示 200 宽的位置（top 44），
 *   方屏直接贴顶（top 8）。原「≡」菜单按钮按真机反馈移除，菜单改为下滑手势 /
 *   返回手势打开（页面内所有定位元素都是 .page 的直接子节点，无嵌套定位容器）。
 */
export const DESIGN_WIDTH = 466

/** 单页最多行数（与源工程 6 个固定文本槽位保持一致） */
export const MAX_LINES = 6

/** 正文字号范围（设计 px，无级调节） */
export const SIZE_MIN = 14
export const SIZE_MAX = 30

/**
 * 行高系数：lineHeight = round(fontSize × 1.4)。
 * 与参考工程 galgame / galgaoshou 的 1.38~1.4 一致（22→30、26→36、30→41）。
 * 平台按行高排版，系数取小（如 size+4）会让实机末行被行框吃掉。
 */
export const LINE_FACTOR = 1.4

/**
 * 对白面板（只做背景；说话人/正文/继续提示是它的兄弟节点）。
 * height 是「最大正文高度下的整块高度」＝ padTop + TEXT.height + padBottom，
 * 运行时按实际行数由 readerLayout() 算，再绑到行内 style 上覆盖。
 */
export const PANEL = {
  round: { left: 63, width: 340, height: 198, bottom: 72, radius: 30, padTop: 18, padBottom: 12 },
  square: { left: 28, width: 410, height: 230, bottom: 8, radius: 30, padTop: 18, padBottom: 12 },
}

/** 说话人底板的几何（骑在面板上沿；bottom 由 readerLayout 按面板高度算） */
export const NAME = {
  round: { left: 83, width: 300, height: 30, bottom: 255 },
  square: { left: 63, width: 340, height: 32, bottom: 190 },
}

/** 正文文字块几何：width / left 固定，height 是「可用最大高度」，bottom 是底边距 */
export const TEXT = {
  round: { width: 300, height: 168, left: 83, bottom: 84 },
  square: { width: 340, height: 200, left: 63, bottom: 20 },
}

/** ▼ 继续提示（贴在面板右侧留白里，不压正文） */
export const NEXT_HINT = {
  round: { left: 385, bottom: 76, size: 15 },
  square: { left: 410, bottom: 26, size: 15 },
}

/** 顶部章节/进度条（贴顶；圆屏受安全圆限制只能到 top 44） */
export const HUD = {
  round: { left: 133, top: 44, width: 200, height: 28, size: 15 },
  square: { left: 23, top: 8, width: 420, height: 34, size: 19 },
}

/** 屏幕设计高度：圆屏 466，方屏 432x514 按 designWidth 466 换算约 554 */
export const VIEWPORT = {
  round: 466,
  square: 554,
}

/** 圆屏安全圆（圆心与半径），validate-pages 用它校验正文/面板/顶栏不越界 */
export const SAFE_CIRCLE = { cx: 233, cy: 233, r: 215 }

/** 立绘三槽位（139x369，底边对齐屏幕底部） */
export const SPRITE = {
  width: 139,
  height: 369,
  left: 14,
  center: 164,
  right: 313,
}

/** 阅读菜单：全屏 scrim + 滚动列表（滚动列表容器是 .page 的直接子节点） */
export const MENU = {
  round: { titleTop: 34, subTop: 66, left: 73, top: 96, width: 320, height: 262, itemHeight: 52, gap: 8 },
  square: { titleTop: 40, subTop: 74, left: 73, top: 108, width: 320, height: 380, itemHeight: 52, gap: 8 },
}

export function normalizeShape(shape) {
  return shape === 'square' ? 'square' : 'round'
}

/**
 * 设备形状：只有明确是 watch-square 才用方屏布局，其余（含取不到 $device 的
 * 模拟器/旧引擎）一律按圆屏保守处理，保证字幕不会被圆边裁掉。
 * 页面还会用 getBoundingClientRect 实测视口宽高比再校正一次（见 Game 页 measureViewport）。
 */
export function detectShape(device) {
  const type = device && device.deviceType !== undefined && device.deviceType !== null
    ? String(device.deviceType)
    : ''
  return type === 'watch-square' ? 'square' : 'round'
}

/** 由实测视口宽高比推断屏型：设计高度 ≥ 505 视为方屏（round 466 / square 554） */
export function shapeFromViewport(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!(w > 0) || !(h > 0)) return 'round'
  const designHeight = (DESIGN_WIDTH * h) / w
  if (designHeight >= 505) return 'square'
  if (designHeight <= 480) return 'round'
  return 'round'
}

export function viewportHeight(shape) {
  return VIEWPORT[normalizeShape(shape)]
}

/** 行高（设计 px）：字号 × LINE_FACTOR，四舍五入 */
export function lineHeightOf(size) {
  const fontSize = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(size) || 20)))
  return Math.max(fontSize + 4, Math.round(fontSize * LINE_FACTOR))
}

/**
 * 分页度量：行高 = lineHeightOf(字号)；
 * 每行字数 = floor((文字块宽 - 12) / 字号)（12px 是粗体中文字形的安全余量）；
 * 每页行数 = min(MAX_LINES, floor(文字块可用高 / 行高))。
 */
export function paginationMetrics(size, shape) {
  const s = normalizeShape(shape)
  const fontSize = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(size) || 20)))
  const box = TEXT[s]
  const lineHeight = lineHeightOf(fontSize)
  const charsPerLine = Math.max(4, Math.floor((box.width - 12) / fontSize))
  const linesPerPage = Math.max(1, Math.min(MAX_LINES, Math.floor(box.height / lineHeight)))
  return {
    shape: s,
    fontSize,
    lineHeight,
    charsPerLine,
    linesPerPage,
    textWidth: box.width,
    textHeight: box.height,
  }
}

/**
 * 阅读器实时版面：把「字号 + 屏型」换算成一组行内 style。
 *
 * 不变量（validate-pages / test-reader 会核对）：
 *   textHeight  = linesPerPage × lineHeight ≤ TEXT[shape].height
 *   panelHeight = padTop + textHeight + padBottom
 *   panelTop    = VIEWPORT - PANEL.bottom - panelHeight
 *   nameBottom  = VIEWPORT - panelTop - NAME.height/2（说话人条骑在面板上沿）
 * 所有纵向都用 bottom 锚定，屏幕变矮只会让面板更矮，不会把正文顶出屏幕。
 */
export function readerLayout(size, shape) {
  const s = normalizeShape(shape)
  const m = paginationMetrics(size, s)
  const panel = PANEL[s]
  const text = TEXT[s]
  const name = NAME[s]
  const vh = VIEWPORT[s]
  const lines = Math.max(1, Math.min(MAX_LINES, m.linesPerPage))
  const textHeight = lines * m.lineHeight
  const panelHeight = panel.padTop + textHeight + panel.padBottom
  const panelTop = vh - panel.bottom - panelHeight
  const nameBottom = vh - panelTop - Math.round(name.height / 2)
  const fontCss = 'font-size: ' + m.fontSize + 'px; line-height: ' + m.lineHeight + 'px;'
  return {
    shape: s,
    fontSize: m.fontSize,
    lineHeight: m.lineHeight,
    charsPerLine: m.charsPerLine,
    linesPerPage: lines,
    textWidth: text.width,
    textMaxHeight: text.height,
    textHeight,
    textLeft: text.left,
    textBottom: text.bottom,
    panelLeft: panel.left,
    panelWidth: panel.width,
    panelBottom: panel.bottom,
    panelHeight,
    panelTop,
    panelRadius: panel.radius,
    padTop: panel.padTop,
    padBottom: panel.padBottom,
    nameLeft: name.left,
    nameWidth: name.width,
    nameHeight: name.height,
    nameBottom,
    fontCss,
    /** 正文（含行数/高度上限，行数写在最后：旧引擎丢弃未知属性时不影响字号/行高） */
    lineStyle: fontCss + ' height: ' + textHeight + 'px; lines: ' + lines + ';',
    panelStyle: 'height: ' + panelHeight + 'px;',
    nameStyle: 'bottom: ' + nameBottom + 'px;',
  }
}

/** 正文行内 style（字号/行高，位置由 .line / .line.square 的 CSS 决定） */
export function textStyle(size, shape) {
  const m = paginationMetrics(size, shape === undefined ? 'round' : shape)
  return 'font-size: ' + m.fontSize + 'px; line-height: ' + m.lineHeight + 'px;'
}

export default {
  DESIGN_WIDTH,
  MAX_LINES,
  SIZE_MIN,
  SIZE_MAX,
  LINE_FACTOR,
  PANEL,
  NAME,
  TEXT,
  NEXT_HINT,
  HUD,
  MENU,
  VIEWPORT,
  SAFE_CIRCLE,
  SPRITE,
  normalizeShape,
  detectShape,
  shapeFromViewport,
  viewportHeight,
  lineHeightOf,
  paginationMetrics,
  readerLayout,
  textStyle,
}
