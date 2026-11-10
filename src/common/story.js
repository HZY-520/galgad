/**
 * 剧本加载：索引 + 分块（44 块 / 5569 节点）。
 *
 * 从 galgod-band（Vela 版）移植：
 *  - @system.file -> @blueos.storage.file，资源路径 /common/story/*.json
 *  - 一次只读一个分块（约 12 KB）；缓存只保留「当前块 + 下一块」，进入新块后
 *    预读下一块并强制淘汰更远的块（低性能手表上避免常驻整本 0.5 MB 文本）。
 *  - 同块并发请求合并等待者，避免重复读盘。
 */
import file from '@blueos.storage.file'

export const STORY_INDEX_URI = '/common/story/index.json'

function parseJSON(text) {
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

/** 读取剧本索引；成功回调 (index) / 失败 (null, message) */
export function readStoryIndex(done) {
  file.readText({
    uri: STORY_INDEX_URI,
    success: (data) => {
      const idx = parseJSON(data && data.text)
      if (!idx || !idx.chunks || !idx.chapters) {
        done(null, '剧本索引损坏')
        return
      }
      done(idx, '')
    },
    fail: (data, code) => {
      done(null, '读不到剧本索引 (code ' + code + ')')
    },
  })
}

/**
 * 创建分块加载器（每个页面实例一个，不要放模块级共享，避免页面销毁后仍被引用）。
 * 返回：{ readChunk, trim, prefetch, reset }
 */
export function createStoryLoader() {
  const state = {
    cache: {},     // chunk.start -> nodes
    pending: {},   // chunk.start -> [callback]
  }

  function finish(chunk, nodes, err) {
    const list = state.pending[chunk.start] || []
    delete state.pending[chunk.start]
    if (err || !nodes) {
      for (let i = 0; i < list.length; i++) {
        try { list[i](null) } catch (e) {}
      }
      return
    }
    state.cache[chunk.start] = nodes
    for (let i = 0; i < list.length; i++) {
      try { list[i](nodes) } catch (e) {}
    }
  }

  function readChunk(chunk, done) {
    if (!chunk) { done(null); return }
    const cached = state.cache[chunk.start]
    if (cached) { done(cached); return }
    const wait = state.pending[chunk.start]
    if (wait) { wait.push(done); return }
    state.pending[chunk.start] = [done]
    file.readText({
      uri: chunk.file,
      success: (data) => {
        const nodes = parseJSON(data && data.text)
        if (!nodes || nodes.length !== chunk.count) {
          finish(chunk, null, true)
          return
        }
        finish(chunk, nodes, false)
      },
      fail: () => finish(chunk, null, true),
    })
  }

  /** 只保留当前块与下一块，其余淘汰（低内存设备的硬约束） */
  function trim(index, chunks) {
    if (!chunks || !chunks.length) return
    const pos = chunkPosition(index, chunks)
    const keep = {}
    if (pos < 0) return
    keep[chunks[pos].start] = 1
    if (chunks[pos + 1]) keep[chunks[pos + 1].start] = 1
    for (const key in state.cache) {
      if (!keep[key]) delete state.cache[key]
    }
  }

  /** 后台预读下一块（已有缓存则跳过） */
  function prefetch(index, chunks) {
    if (!chunks || !chunks.length) return
    const pos = chunkPosition(index, chunks)
    const next = pos >= 0 ? chunks[pos + 1] : null
    if (!next || state.cache[next.start]) return
    readChunk(next, () => {})
  }

  function reset() {
    state.cache = {}
    state.pending = {}
  }

  return { readChunk, trim, prefetch, reset }
}

/** 某个节点下标所属的分块下标；找不到返回 -1 */
export function chunkPosition(index, chunks) {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    if (index >= c.start && index < c.start + c.count) return i
  }
  return -1
}

/** 某个节点下标所属的分块；找不到返回 null */
export function chunkOf(index, chunks) {
  const pos = chunkPosition(index, chunks)
  return pos >= 0 ? chunks[pos] : null
}

export default { STORY_INDEX_URI, readStoryIndex, createStoryLoader, chunkPosition, chunkOf }
