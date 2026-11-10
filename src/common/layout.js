/**
 * 版面几何与分页度量（设计 px，designWidth = 466）。
 *
 * 本文件是「运行时几何」的唯一来源：页面 CSS 的数值必须与这里一致，
 * tools/validate-pages.mjs 会逐项核对（改一半会直接报错）。
 *
 * 圆屏 watch-round 466x466：
 *   以 (233,233) 为圆心、半径 215 的安全圆内放对白与控件。
 *   对白面板 340x186（占屏高约 40%，上一版 406x290 占 62% 太压画面），
 *   bottom 66 → 面板 y 214..400；正文块 300x126（y 256..382）。
 *   正文块左 83..右 383，最末一行左端到圆心的最大距离约 155 < 215，不会贴到圆边。
 * 方屏 watch-square（vivo WATCH GT 2 432x514，设计高度约 554）：
 *   对白面板 410x186（bottom 20）、正文区 340x140，全部用 bottom 锚定。
 *
 * 顶部：左侧章节/进度条 + 右侧「≡」阅读菜单按钮（都在圆屏安全圆内；
 * 圆屏 y≈60 处的安全横向范围约 103..363，方屏为整宽 466）。
 */
export const DESIGN_WIDTH = 466

/** 正文最多行数（字号 14 时 6 行） */
export const MAX_LINES = 6

/** 正文字号范围（设计 px，无级调节） */
export const SIZE_MIN = 14
export const SIZE_MAX = 30

/** 对白面板（只做背景；说话人/正文/继续提示是它的兄弟节点） */
export const PANEL = {
  round: { left: 63, width: 340, height: 186, bottom: 66, radius: 30 },
  square: { left: 28, width: 410, height: 186, bottom: 20, radius: 30 },
}

/** 说话人底板的几何（压在正文上方、面板内） */
export const NAME = {
  round: { left: 83, width: 300, height: 30, bottom: 216 },
  square: { left: 63, width: 340, height: 32, bottom: 172 },
}

/** 正文文字块几何：宽度、高度、left、bottom */
export const TEXT = {
  round: { width: 300, height: 126, left: 83, bottom: 84 },
  square: { width: 340, height: 140, left: 63, bottom: 26 },
}

/** ▼ 继续提示的位置（正文区下方居中 / 方屏放正文右侧，避免压到末行） */
export const NEXT_HINT = {
  round: { left: 224, bottom: 68, size: 16 },
  square: { left: 406, bottom: 40, size: 18 },
}

/** 顶部章节/进度条 */
export const HUD = {
  round: { left: 104, top: 62, width: 208, height: 30, size: 17 },
  square: { left: 20, top: 12, width: 300, height: 34, size: 20 },
}

/** 顶部右侧「≡」阅读菜单按钮（圆屏安全圆内；点击锁定 400ms 防误触翻页） */
export const MENU_BTN = {
  round: { left: 312, top: 58, width: 42, height: 42, radius: 21, size: 24 },
  square: { left: 410, top: 8, width: 44, height: 44, radius: 22, size: 26 },
}

/** 屏幕设计高度：圆屏 466，方屏 432x514 按 designWidth 466 换算约 554 */
export const VIEWPORT = {
  round: 466,
  square: 554,
}

/** 立绘三槽位（139x369，底边对齐屏幕底部） */
export const SPRITE = {
  width: 139,
  height: 369,
  left: 14,
  center: 164,
  right: 313,
}

export function normalizeShape(shape) {
  return shape === 'square' ? 'square' : 'round'
}

/**
 * 设备形状：只有明确是 watch-square 才用方屏布局，其余（含取不到 $device 的
 * 模拟器/旧引擎）一律按圆屏保守处理，保证字幕不会被圆边裁掉。
 */
export function detectShape(device) {
  const type = device && device.deviceType !== undefined && device.deviceType !== null
    ? String(device.deviceType)
    : ''
  return type === 'watch-square' ? 'square' : 'round'
}

export function viewportHeight(shape) {
  return VIEWPORT[normalizeShape(shape)]
}

/**
 * 分页度量：行高 = 字号 + 4；每行字数 = floor((文字块宽 - 12) / 字号)；
 * 每页行数 = min(MAX_LINES, floor(文字块高 / 行高))。
 * 12px 是粗体中文字形的安全余量，避免行尾多挤一个字导致整段多出一行。
 */
export function paginationMetrics(size, shape) {
  const s = normalizeShape(shape)
  const fontSize = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(Number(size) || 20)))
  const box = TEXT[s]
  const lineHeight = fontSize + 4
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

/** 正文行内 style（字号/行高，位置由 .line / .line.square 的 CSS 决定） */
export function textStyle(size) {
  const m = paginationMetrics(size, 'round')
  return 'font-size: ' + m.fontSize + 'px; line-height: ' + m.lineHeight + 'px;'
}


export default {
  DESIGN_WIDTH,
  MAX_LINES,
  SIZE_MIN,
  SIZE_MAX,
  PANEL,
  NAME,
  TEXT,
  NEXT_HINT,
  HUD,
  MENU_BTN,
  VIEWPORT,
  SPRITE,
  normalizeShape,
  detectShape,
  viewportHeight,
  paginationMetrics,
  textStyle,
}
