# GalGod · vivo BlueOS 移植实现规范（页面/工具链协作基准）

> 工程根目录：`C:\Users\Administrator\BlueOSProjects\galgad`
> 目标：把 `C:\Users\Administrator\BlueOSProjects\_galgod_band_src\galgod-band-main`（小米手环 9 Pro / Vela 快应用版 GalGod 2.5.2）**完整移植**为 vivo 蓝河（BlueOS）手表应用。
> 平台依据：`BlueOS开发文档.md` + `docs/refs/blueos-platform.md`（只读参考）。原工程行为依据：`docs/refs/source-galgod.md` + 源工程源码（只读）。
> 目标设备：`watch-round` 466×466（designWidth=466，主目标）与 `watch-square`（vivo WATCH GT 2 432×514，设计高度约 554）。一套源码、双设备构建。

## 0. 硬性规则（违反会被 validate-pages / 构建 / 实机检查拦下）

1. **页面文件**：`src/pages/<Name>/index.ux`，必须包含 `<script>`、`<template>`、`<style>` 三段（顺序：script → template → style，与参考工程一致）。
2. **API**：只允许 `@blueos.*`。禁止任何 `@system.*`（Vela 残留）。用到接口必须在 `src/manifest.json` 的 `features` 里声明：`blueos.storage.storage`、`blueos.storage.file`、`blueos.window.prompt`、`blueos.hardware.display.brightness`、`blueos.app.app`。
3. **页面数据**：只用 `data`；禁止 `protected`/`public`/`private`（Vela 概念）。路由参数在 `data` 里声明同名属性（`at/load/auto/mode`…），值一律是 String；`onRefresh(query)` 在 singleTask 页面被再次打开时收到参数（onShow 之前执行）。
4. **事件**：只用 `@click`、`@longpress`、`@touchstart`、`@touchmove`、`@touchend`、`@touchcancel`。**没有 `onswipe`**；`<image>` 不支持事件（要点击/拖动就套 `div` 手势层，并给它 `background-color: rgba(…, 0.02)` 保证能命中）。`list`/`list-item` 用 `@click`/`@longpress`。
5. **定时器**：禁止直接 `setTimeout/setInterval`；统一用 `common/reader.js` 的 `armTimer/disarmTimer/armInterval/disarmInterval`（IDE 的 feature-api 规则按字面 token 配对，页面里手写很容易误报；统一收口后 lint 0 错）。所有定时器在 `onHide`/`onDestroy` 清理。
6. **布局**：只用 Flex；禁止 `flex: 1`；禁止 `position` 用在 list-item 内部（list-item 不支持 position）；`scroll` 不支持 margin/padding；**不用百分比宽度**（实机上会被二次换算），所有定位元素用显式 px、`bottom` 锚定；`opacity` 只允许给**空 div**（带子节点的容器用 `rgba()` 背景色，否则实机会渲染成条纹）。
7. **图片**：`<image>` 必须显式写宽高 + `object-fit`（默认是 cover，但显式写清楚）。资源规格（`tools/gen_assets.py` 已生成，勿手改图片）：
   - 背景 `img/b/*.png` 466×466、CG `img/c/*.png` 466×466、立绘 `img/s/*.png` 139×369、鉴赏宽图 `img/w/*.png` 640×360、缩略图 `img/t/g*.png` 120×68、主页画 `assets/images/home.png` 466×666、图标 `assets/images/icon.png` 114×114。
   - 图片路径通过 `common/asset.js` 的 `imageUri(index)` / `wideUri(index)` 取，不要在页面里手写 `/common/img/...`（除缩略图直接用 `cglist.js` 的 `th` 字段）。
8. **禁止组件**：`scrollview`、`swiper`、`image-animator`；设置页不用 `slider`（改用 −/＋ 步进，参考工程实机验证过）。
9. **样式**：不用后代选择器（性能规范），只用 class；不用 `#id` 写样式。圆屏安全区：内容尽量落在以 (233,233) 为圆心、半径 215 的圆内。
10. **版本号**：`src/manifest.json` 的 `versionName` = `1.0.0`；About 页 `APP_VER` 必须同值（validate-pages 会核对）。
11. 不改动公共文件（`src/manifest.json`、`src/app.ux`、`src/common/*`、`src/assets/*`、`package.json`、`tools/gen_assets.py`、`tools/import_story.mjs`）——这些由 Lead 维护。页面工程师只写自己负责的 `src/pages/<Name>/index.ux`。
12. 验证：页面完成后至少用 `node -e` 做括号/引号粗检，并等 Lead 跑 `tools/validate-pages.mjs` + 官方构建。不要自行运行 blueos-pack（避免并发构建冲突）。

## 1. 公共模块 API（已实现，直接 import）

### `src/common/layout.js`
```js
import {
  DESIGN_WIDTH,            // 466
  MAX_LINES,               // 6
  SIZE_MIN, SIZE_MAX,      // 14 / 30
  PANEL, NAME, TEXT, NEXT_HINT, HUD, VIEWPORT, SPRITE,  // {round:{...}, square:{...}} 几何
  normalizeShape, detectShape, viewportHeight,
  paginationMetrics,       // (size, shape) -> {shape,fontSize,lineHeight,charsPerLine,linesPerPage,textWidth,textHeight}
  textStyle,               // (size) -> 'font-size: 20px; line-height: 24px;'
} from '../../common/layout.js'
```
几何（页面 CSS 必须一致）：
- 对白面板 round：left 63 / bottom 66 / 340×186 / 圆角 30；square：left 28 / bottom 20 / 410×186 / 圆角 30。
  （圆屏占屏高 40%，可在 `layout.js` 里 `PANEL.round.height` 一处调整；validate-pages 会拦 >55%）
- 说话人 round：left 83 / bottom 216 / 300×30；square：left 63 / bottom 172 / 340×32。
- 正文 round：left 83 / bottom 84 / 300×126；square：left 63 / bottom 26 / 340×140。
- ▼ round：left 316 / bottom 74；square：left 396 / bottom 34。
- HUD round：left 104 / top 62 / 208×30；square：left 20 / top 12 / 300×34。
- 「≡」阅读菜单按钮 round：left 312 / top 58 / 42×42；square：left 410 / top 8 / 44×44
  （DOM 顺序必须在 `.tap-layer` 之后，否则点击被点击层吃掉；绑定 `@click="openMenu"`）。
- 立绘三槽：139×369、bottom 0、left 14 / 164 / 313。
- 屏幕设计高度：round 466，square 554。
- 圆屏安全区：validate-pages 会校验正文块四角、面板上沿、菜单按钮右上角到 (233,233) 的距离 ≤215。

### `src/common/reader.js`
设置/分页/storage/定时器（见文件头注释）。关键导出：
`SAVE_MAGIC('galgod-band-1')`、`MAX_SLOTS(6)`、`DEFAULT_SETTINGS`、`normalizeSettings`、`longpressMode`、`autoDelay`、`wrapText`、`paginateText(text,cpl,lpp)`、`readJSON/writeJSON`、`loadSettings/saveSettings`、`loadSaves/saveSaves`、`loadAutoSave/saveAutoSave`、`loadSeen/saveSeen`、`loadCleared/markCleared`、`armTimer/disarmTimer/armInterval/disarmInterval`。
storage 键：`settings`、`saves`（长度 6 数组，槽位可 null）、`autoSave`、`pendingSave`、`cgSeen`（图片下标数组）、`cleared`（{ok:1,at}）。

### `src/common/engine.js`
纯逻辑，页面只调用：
```js
import {
  SAVE_MAGIC, createState, testCond, choicesOf, executeNode, renderSprites,
  chapterIndex, chapterProgress, visibleChapters, nextVisibleChapter,
  collectSave, normalizeSave, applySave, describeSave,
} from '../../common/engine.js'
```
- `executeNode(state, node, story)` → `{action:'say',node}` / `{action:'choice',choices}` / `{action:'end',node}` / `{action:'next'}`；内部完成 bg/cs/cg/tint 继承与 flags/跳转。
- `visibleChapters(story, cleared, pc)` → `[{title,start,no,current}]`（已过滤 hide/need）。
- `describeSave(save)` → `'第N章 · 台词预览'`；`normalizeSave` 校验。
- 存档快照字段：`{magic,pc,chapter,flags,bgSrc,showBlack,showWhite,cs,cgSrc,tint,text,at}`。

### `src/common/story.js`
```js
import { readStoryIndex, createStoryLoader, chunkOf } from '../../common/story.js'
readStoryIndex((idx, err) => {})
const loader = createStoryLoader()   // 每个页面实例一个
loader.readChunk(chunk, (nodes)=>{}) // 节点数组或 null
```
索引 `idx = {nodeCount:5569, chunkSize:128, chapters:[{id,title,start,hide?,need?}], chunks:[{file,start,count}]}`。

### `src/common/asset.js`
`imageUri(index)`、`wideUri(index)`、`imageCount()`；`assets.js` 的 `IMG` 共 127 项（0-37 背景 / 38-92 立绘 / 93-126 CG）；`cglist.js` 的 `CGG` 共 9 组：`{n:组名, th:缩略图 URI, u:解锁所需图片下标, im:[该组图片下标…]}`。

## 2. 视觉规范（统一风格）

- 页面根：`width: 466px; height: 100%; background-color: #14101a;`，所有定位元素都是根节点**直接子节点**。
- 颜色：主背景 `#14101a`、卡片 `#241c2c`、按钮 `#32243a`、强调 `#b95079`、危险 `#a8355a`、主文字 `#ffe6ef`、次文字 `#9c8f9b`、高亮 `#cf9ec0`、青 `#7ee8e0`、禁用 `#7d757f`。
- 标题：`font-size: 26~28px; font-weight: bold; color:#ffd8e6; text-align:center;`。
- 通用返回按钮：`width:240px; height:52px; left:113px; bottom:24px; border-radius:26px; background:#32243a;` 内 `<text class="btn-t">返回</text>`（font 22，白）。
- 卡片列表：`<list class="lst" bounces="true" scrollbar="false">` + `<list-item type="row" class="item" for="{{rows}}" tid="key" @click=…>`；item 高度固定，card 用 `flex-direction: row; align-items: center; padding-left/right`。
- 所有 `<text>` 多行容器写 `lines` / `text-overflow: ellipsis`；不要依赖自动折行。

## 3. 页面规格

### 3.1 Saves（`/pages/Saves`，Lead 已留路由，`data.mode` 路由参数）
- 行为（源 `pages/saves/saves.ux`）：自动存档 1 行 + 6 个手动槽。`mode='save'` 时点按槽位写入 `pendingSave`；`mode='load'` 时读取并 `router.replace('/pages/Game',{params:{load:String(slot)}})`；自动存档行在 load 模式读档（`params:{auto:'1'}`）。
- `onInit`：`st.slots=[]`、`st.auto=null`、`st.pending=null`、`st.suppress=false`；`loadSaves`、`loadAutoSave`、`readJSON('pendingSave', null, …)` 后 `writeJSON('pendingSave', null)` 清空并 `render()`。
- `render()`：7 行，行数据 `{name, info, tag, slot}`：自动存档（tag 自动/读取）、存档 1..6（覆盖/读取/空）。`info` 用 `describeSave`（engine）或 `（空）`。
- 长按删除：`confirmIdx>=0` 时显示 scrim+dialog（“删除存档？”/“此操作无法撤销”/取消/删除）；自动存档不可删除、不可覆盖（toast）。
- 布局：标题 top 50、副标题 top 90、list top 126、height round 250 / square 338（`.lst.square`）；item 高 82；card 420×76（left 23，圆角 18）；返回按钮 bottom 24。
- 数据 `rows` 用 tid 唯一（如 `"slot" + slot`，自动行 `"auto"`）。list-item `type` 统一 `"row"`（相同 DOM）。

### 3.2 Chapters（`/pages/Chapters`）
- `onInit`：`loadAutoSave` 得当前 `pc`（`d.pc`，兼容 null）→ `loadCleared` → `readStoryIndex` → `visibleChapters(story, cleared, pc)` → 行数据 `{no,title,mark,start,key}`（mark='▶' 表示上次读到）。
- 行为：点按 `router.replace('/pages/Game',{params:{at:String(start)}})`；返回 `router.back()`；标题下显示“共 N 章 · 上下滑动 · 点按开始”。
- 布局：标题 top 50、副标题 top 90、list top 126、height round 250 / square 338；item 高 82；card 420×76；`no` 宽 44 / 字号 18 色 #cf9ec0；`title` 宽 300 / 字号 23 白色、lines 1；`mark` 宽 20 / 字号 18 青色。返回按钮同上。

### 3.3 About（`/pages/About`）
- 内容：把源 `about.ux` 的 `ABOUT` 数组（故事梗概 / 四种结局 / 版权信息 / 开源协议）与 `FISH_LINES`（小鱼干彩蛋，30 句）**完整移植**；副标题改为 `GalGod · vivo 蓝河手表移植版 · v{{ver}}`，`APP_VER='1.0.0'`。
- 正文排版：`wrapText(text, CPL=15)`，字号 20、行高 30、可用宽 300（15×20=300）；行类型 `r-p`（正文 #d9cdd6）/ `r-s`（小节 #ffb3cd）/ `r-g`（空行 height 30，不显示文字）。list top 108、height round 278 / square 368；item 高 30，card 内 `padding-left: 80px`（行宽 300 居中）。
- 彩蛋：副标题上方的“关于”标题 2 秒内连点 7 次 → 隐藏菜单（解锁后日谈 / 解锁全部 CG / 小鱼干 / 关闭）；第 4 次起标题右侧显示 `·`/`··`/`···` 提示。菜单为全屏 scrim + 卡片（宽 300，四个按钮）。解锁后日谈 = `markCleared`；解锁全部 CG = 收集 `CGG` 所有 `im` 去重后 `saveSeen`。
- 小鱼干剧场：全屏黑底卡片，显示 `fishName`（可空）/`fishText`/`fishHint`（`n / total`），点一下走一句；走完回彩蛋菜单。
- 返回按钮 bottom 24。标题点击用 `<text class="title" @click="tapTitle">关于</text>`。

### 3.4 Settings（`/pages/Settings`）
- 设置项与源工程一致：字号 `size` 14–30（−/＋ 1）；播放速度 `speed` 0–120 毫秒/字（−/＋ 2，0 显示“瞬间”）；自动播放 `autoMs` 0–200 毫秒/字（−/＋ 10，0 显示“关闭”）；屏幕常亮 `keepOn`（关/开）；长按行为 `longpress`（隐藏/快进/关闭）。
- 交互：`apply(patch)` = `normalizeSettings(Object.assign({}, settings, patch))` → 刷新文案/预览 → 300ms 防抖 `saveSettings`；返回/onDestroy 时 `flush()` 立即写盘。重置 = `normalizeSettings(DEFAULT_SETTINGS)` + toast「已恢复默认设置」。
- 布局：标题 top 44；`<scroll class="scroll" scroll-y="true" bounces="true">` 容器 top 100、left 53、宽 360、height round 250 / square 338；内容列 flex column 宽 360。每行 62 高：label 宽 150（字号 22 加粗 #f5e1e8）、− 按钮 46×46、数值宽 64 居中（字号 24 #ffd8e6）、＋ 按钮 46×46；灰色提示行字号 16。开关行：标签 + 2/3 个药丸按钮（74×40，选中 #b95079）。预览卡片 360×104（rgba(18,13,19,0.9)，圆角 14，说话人字号 18，正文用 `textStyle(size)` 动态 style，宽 320）。
- 底部：重置/返回两个 152×50 按钮（left 113 / 241，bottom 24）。
- **不用 slider**（源工程有 slider，但 BlueOS 参考工程实机验证改用步进；在 `docs/PORT-NOTES.md` 记录为优化项）。

### 3.5 Gallery（`/pages/Gallery`，`manifest` 已设 followHand disable）
- 列表：`CGG` 9 组，`onInit` 里 `loadSeen` → `seen` map → `rows=[{th,n,ok,st,gi,key}]`，`openCount/total`。未解锁组显示“?”方块 + “未解锁”，点按 toast「还没在剧情里看到这一组」。
- 布局：标题 top 40、副标题 top 78、list top 110、height round 280 / square 368；item 高 92；card 416×84（left 25，圆角 18，flex row，padding 左右 14）；缩略图 112×63 圆角 8；锁定块 112×63 背景 #191320 居中“?”字号 26；组名宽 170 字号 21 白、lines 1；状态宽 70 字号 15 右对齐。
- 大图查看（`viewing` 全屏覆盖）：宽图 640×360 以 **828×466 显式尺寸**显示（`src="{{bigSrc}}"`，`style="{{cgStyle}}"`，`class="big"`），初始 `left=-181`（看到中间），可左右拖动看全图：手势层 `<div class="gesture" @touchstart/@touchmove/@touchend>` 读 `touches[0].clientX/pageX/clientX/offsetX` 兜底；`left = clamp(pressLeft + (x-pressX), -362, 0)`；顶部信息条显示组名 + `n / m` + 关闭；底部 `‹ 换一张差分 ›`（循环）；提示“按住画面左右拖动，看被裁掉的部分” + 位置条（轨道 240×5，滑块 135×5，left = (240-135)*ratio）；左右点按热区（宽 60）兜底步进 ±121。切图自动回中间。
- 圆方屏：`top = (vh - 466) / 2`（round 0 / square 44），用 `style` 绑定；`VH = $device.deviceType === 'watch-square' ? 554 : 466`。
- `onBackPress`：`viewing` 时关闭查看并 return true；否则 `router.back()` 并 return true。

## 4. 工具链（另一名队友负责，其他人不要动 `tools/`）

- `tools/build.mjs`：复用参考工程 galgaoshou 的官方 blueos-pack 包装器（定位 `D:\BlueOSStudio\...\blueos-pack\bin\index.js`；`--debug/--release/--device watch-round|watch-square`；成功判定 `[INFO] finish compile` + dist 下新 rpk；日志写 `scripts/reports/build/<device>-<mode>.log`）。
- `tools/lint-timers.js`：复刻 IDE feature-api 定时器配对规则（参考 `galgaoshou/tools/lint-timers.js`，它 `require` IDE 的 apiParser.js）。
- `tools/validate-story.mjs`：44 分块 / 5569 节点 / 18 章节 / 图片下标与文件存在 / 跳转目标合法 / CGG 下标合法 / 版本号一致。
- `tools/validate-pages.mjs`：页面三段式、路由与 manifest 一致、无 @system / onswipe / scrollview / flex:1 / 百分比宽度、image 有 object-fit、features 声明、data 字段、CSS 几何常量与 layout.js 一致、版本号一致。
- `tools/test-engine.mjs`：用 Node 直接跑 `src/common/engine.js` + 全部剧本（需要处理 .js ESM 加载技巧，参考 `galgaoshou/tools/test-engine.mjs`）；覆盖 8 条策略/全部选项/结局可达/存档往返/章节过滤。
- `tools/test-reader.mjs`：全剧本 5457 句 × 字号 14–30 × 圆/方屏的分页不变量（不丢字、不超行、不超页、行宽不超文本框）+ 设置归一化 + autoDelay。
- 构建产物：`dist/<device>/debug/`（debug 侧载无需签名）。

## 5. 验收（Lead 最终执行）

`npm run check`（lint + validate-story + validate-pages + test-engine + test-reader）全 PASS；官方 blueos-pack `watch-round`/`watch-square` 两次 debug 构建 `[INFO] finish compile` 且无 `[ERROR]`，rpk 内含 manifest 页面、features、44 个剧本 JSON、127 张图片 + 32 张宽图 + 9 缩略图 + home/icon；报告写 `docs/VERIFICATION.md`。
