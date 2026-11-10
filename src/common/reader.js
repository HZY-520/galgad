/**
 * 阅读器公共逻辑：设置项、换行分页、storage 存档、定时器收口。
 *
 * 从 galgod-band（Vela 版）的 src/common/reader.js 移植：
 *  - @system.storage -> @blueos.storage.storage
 *  - 新增 armTimer/disarmTimer：BlueOS IDE 的 feature-api 检查按「字面 token」配对
 *    setTimeout/clearTimeout（与参考工程 galgame/galgaoshou 的规则一致），
 *    统一用局部变量持有句柄再清理，既满足静态检查也避免页面销毁后残留回调。
 */
import storage from '@blueos.storage.storage'

export const SAVE_MAGIC = 'galgod-band-1'
export const MAX_SLOTS = 6

import { SIZE_MIN, SIZE_MAX } from './layout.js'

/** 打字机速度：每字毫秒，0 = 整句立即显示 */
export const SPEED_MIN = 0
export const SPEED_MAX = 120

/** 自动播放：每字停留毫秒，0 = 关闭 */
export const AUTO_MIN = 0
export const AUTO_MAX = 200

export const DEFAULT_SETTINGS = {
  size: 20,       // 正文字号 px
  speed: 28,      // 打字机 每字毫秒
  autoMs: 0,      // 自动播放 每字停留毫秒（0 = 关）
  fast: false,    // 快速播放（瞬间出字 + 连播，遇到选项/结局自动停）
  keepOn: true,   // 阅读时屏幕常亮（@blueos.hardware.display.brightness）
  // 长按画面的行为：'hide' 隐藏界面 / 'fast' 按住快进 / 'off' 什么都不做
  longpress: 'off',
}

export const LONGPRESS_MODES = ['hide', 'fast', 'off']

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  if (!isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {})
  s.size = clampInt(s.size, SIZE_MIN, SIZE_MAX, DEFAULT_SETTINGS.size)
  s.speed = clampInt(s.speed, SPEED_MIN, SPEED_MAX, DEFAULT_SETTINGS.speed)
  s.autoMs = clampInt(s.autoMs, AUTO_MIN, AUTO_MAX, DEFAULT_SETTINGS.autoMs)
  // fast 不持久化，读回来一律关
  s.fast = false
  // keepOn 默认 true：老存档没有这个键时不能被压成 false
  s.keepOn = (s.keepOn === undefined || s.keepOn === null)
    ? DEFAULT_SETTINGS.keepOn
    : !!s.keepOn
  if (s.longpress === true) s.longpress = 'hide'
  else if (s.longpress === false) s.longpress = 'off'
  else if (LONGPRESS_MODES.indexOf(s.longpress) < 0) s.longpress = DEFAULT_SETTINGS.longpress
  delete s.auto
  delete s.autoSpeed
  return s
}

export function longpressMode(settings) {
  const v = (settings || {}).longpress
  if (v === true) return 'hide'
  if (v === false) return 'off'
  return (v === 'fast' || v === 'off') ? v : 'hide'
}

/** 自动播放停留：基础 700ms + 每字 autoMs，夹在 1.2~12 秒 */
export function autoDelay(text, autoMs) {
  const n = String(text || '').replace(/\s/g, '').length
  return Math.max(1200, Math.min(12000, Math.round(700 + n * autoMs)))
}

// ---------------------------------------------------------------- 换行与分页
// 断行优先落在标点之后，避免标点跑到行首。
const BREAK_AFTER = '，。！？；：、）」』…—'

export function wrapText(text, cpl) {
  const limit = Math.max(1, Math.floor(cpl) || 1)
  const lines = []
  const raws = String(text || '').split('\n')
  for (let i = 0; i < raws.length; i++) {
    let s = raws[i]
    if (s === '') { lines.push(''); continue }
    while (s.length > limit) {
      let cut = limit
      const lo = Math.max(2, limit - 8)
      for (let k = limit; k > lo; k--) {
        if (BREAK_AFTER.indexOf(s.charAt(k - 1)) >= 0) { cut = k; break }
      }
      lines.push(s.slice(0, cut))
      s = s.slice(cut)
    }
    lines.push(s)
  }
  return lines.length ? lines : ['']
}

export function paginateText(text, cpl, lpp) {
  const lines = wrapText(text, cpl)
  const per = Math.max(1, Math.floor(lpp) || 1)
  const pages = []
  for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per))
  return pages.length ? pages : [['']]
}

// ---------------------------------------------------------------- storage
export function readJSON(key, fallback, done) {
  storage.get({
    key: key,
    default: '',
    success: (v) => {
      if (!v) { done(fallback); return }
      try {
        done(JSON.parse(v))
      } catch (e) {
        done(fallback)
      }
    },
    fail: () => done(fallback),
  })
}

export function writeJSON(key, value, done) {
  storage.set({
    key: key,
    value: JSON.stringify(value),
    success: () => { if (done) done(true) },
    fail: () => { if (done) done(false) },
  })
}

export function loadSettings(done) {
  readJSON('settings', null, (v) => done(normalizeSettings(v)))
}

export function saveSettings(s, done) {
  // fast（快进）是临时状态，不持久化
  const t = Object.assign({}, s)
  delete t.fast
  writeJSON('settings', t, done)
}

export function loadSaves(done) {
  readJSON('saves', [], (v) => done(Array.isArray(v) ? v : []))
}

export function saveSaves(list, done) {
  writeJSON('saves', list, done)
}

/** 删除一个 storage key（storage.delete 封装；写空串在 BlueOS 里也是删除，但语义更明确） */
export function deleteKey(key, done) {
  storage.delete({
    key: key,
    success: () => { if (done) done(true) },
    fail: () => { if (done) done(false) },
  })
}

export function loadAutoSave(done) {
  readJSON('autoSave', null, done)
}

export function saveAutoSave(data, done) {
  writeJSON('autoSave', data, done)
}

// ---------------------------------------------------------------- CG 鉴赏解锁
export function loadSeen(done) {
  readJSON('cgSeen', [], (v) => done(Array.isArray(v) ? v : []))
}

export function saveSeen(list, done) {
  writeJSON('cgSeen', list, done)
}

// ---------------------------------------------------------------- 通关记录
export function loadCleared(done) {
  readJSON('cleared', null, (v) => done(!!(v && v.ok)))
}

export function markCleared(done) {
  writeJSON('cleared', { ok: 1, at: Date.now() }, done)
}

// ---------------------------------------------------------------- 定时器收口
// 说明：BlueOS IDE 的 feature-api 校验按字面 token 配对（参照参考工程的实机经验），
//   st.typingTimer = setTimeout(...)  → 句柄名被解析成 typingTimer
//   clearTimeout(st.typingTimer)      → 参数被解析成 st.typingTimer
// 两者不相等会误报「未正确使用 clearTimeout 关闭」。因此统一由下面两个函数持有
// 局部变量，清理时从同一个 holder 取出同一引用再 clear，静态检查与运行时都正确。
export function armTimer(holder, key, handler, delay) {
  const timer = setTimeout(handler, delay)
  holder[key] = timer
  return timer
}

export function disarmTimer(holder, key) {
  const timer = holder[key]
  holder[key] = 0
  if (timer) clearTimeout(timer)
}

export function armInterval(holder, key, handler, delay) {
  const timer = setInterval(handler, delay)
  holder[key] = timer
  return timer
}

export function disarmInterval(holder, key) {
  const timer = holder[key]
  holder[key] = 0
  if (timer) clearInterval(timer)
}

export default {
  SAVE_MAGIC,
  MAX_SLOTS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  longpressMode,
  autoDelay,
  wrapText,
  paginateText,
  readJSON,
  writeJSON,
  loadSettings,
  saveSettings,
  loadSaves,
  saveSaves,
  loadAutoSave,
  saveAutoSave,
  loadSeen,
  saveSeen,
  loadCleared,
  markCleared,
  armTimer,
  disarmTimer,
  armInterval,
  disarmInterval,
}
