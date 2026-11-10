/**
 * 图片资源路径。
 *
 * assets.js 由源工程 tools/gen_story.py 生成：IMG 数组下标 = 剧本节点里的资源号
 * （0~37 背景 / 38~92 立绘 / 93~126 CG）。图片文件名与源工程一致，
 * gen_assets.py 只重裁尺寸、不改路径。
 *
 * 鉴赏宽图放在 /common/img/w/ 下：640x360 完整 16:9，仅 CG 鉴赏的大图查看使用。
 */
import { IMG } from './assets.js'

/** 资源号 -> 图片 URI（-1/-2 是纯黑/纯白，返回空串由页面画纯色层） */
export function imageUri(index) {
  const i = Number(index)
  if (!(i >= 0) || i >= IMG.length) return ''
  return IMG[i] || ''
}

/** 资源号 -> 鉴赏宽图 URI（/common/img/c/x.png -> /common/img/w/x.png） */
export function wideUri(index) {
  const uri = imageUri(index)
  if (!uri) return ''
  return uri.replace('/common/img/c/', '/common/img/w/')
}

export function imageCount() {
  return IMG.length
}

export default { imageUri, wideUri, imageCount }
