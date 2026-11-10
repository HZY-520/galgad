# GalGod 手环版（小米手环 9 Pro / Vela 快应用）源码行为与数据结构全景分析

> 本文是「把 `galgod-band` 的全部功能与内容零信息损失移植到 vivo BlueOS 蓝河手表」的**唯一行为依据**。
> 只记录**事实**：字段名/类型/取值、真实样例、UI 几何数值、状态机与方法名/行号、storage 键、路由参数、定时器与去抖/锁。
> 结论全部来自原文件逐行阅读与对 5569 个剧情节点的程序化统计；不含推测（推测一律标注「未验证」）。
>
> 生成方式：静态阅读 + Python/Node 脚本对 `src/common/story/*.txt`、`src/common/assets.js`、`src/common/cglist.js`、
> `src/common/img/**` 做统计。**未修改源工程任何文件**，未运行构建、未安装依赖。

---

## 0. 约定与分析对象

### 0.1 分析对象

| 项 | 值 |
|---|---|
| 源工程根目录 | `C:\Users\Administrator\BlueOSProjects\_galgod_band_src\galgod-band-main` |
| 应用名 / 包名 | `GalGod` / `com.galgod.band` |
| 版本 | `versionName: 2.5.2`，`versionCode: 50` |
| 平台 | Vela 快应用（小米手环 9 Pro，**336×480 物理像素，`designWidth: 336`，1px = 1 物理像素**） |
| 页面数 | 7（index / game / saves / chapters / cg / settings / about） |
| 剧本规模 | 5569 节点 / 44 分块 / 18 章（章节表项） |
| 图片 | `IMG` 索引 127 项（背景 38 + 立绘 55 + CG 34）；另 home.png、icon.png、鉴赏缩略图 9 |
| 存储键 | `settings` / `saves` / `autoSave` / `cgSeen` / `cleared` / `pendingSave` |

### 0.2 行号引用约定

- 形如 `game.ux:1234` 的行号 = 分析时该文件的实际行号（`read` 工具编号）。
- 方法引用形如 `game.ux:1140 rewind()` 表示方法起始行；“L1140-1165”表示范围。
- 目标工程（`galgad`）行号同样以 `read` 工具编号为准。

### 0.3 源工程关键文件清单

| 文件 | 行数 | 字节 | 作用 |
|---|---|---|---|
| `src/manifest.json` | 61 | 1055 | 应用清单 |
| `src/app.ux` | 7 | 88 | 应用入口（空实现） |
| `src/common/reader.js` | 177 | 6157 | 设置/换行分页/storage 封装（7 页共用） |
| `src/common/assets.js` | 234 | 6196 | **生成**：图片索引表 `IMG` / `BG` / `SP` |
| `src/common/cglist.js` | 3 | 827 | **生成**：CG 鉴赏 9 组 |
| `src/common/home.png` | — | 35967 | 主页标题画 336×480 |
| `src/common/icon.png` | — | 51084 | 应用图标 192×192（RGBA） |
| `src/common/story/index.txt` | 1 | 4010 | 剧本索引（JSON 内容，`.txt` 扩展名） |
| `src/common/story/chunk-000.txt` … `chunk-043.txt` | 各 1 | 5058–15243 | 44 个分块（每块 ≤128 节点） |
| `src/pages/index/index.ux` | 93 | 4109 | 主页 |
| `src/pages/game/game.ux` | 1315 | 51743 | **引擎核心：阅读器** |
| `src/pages/saves/saves.ux` | 178 | 6763 | 存档页 |
| `src/pages/chapters/chapters.ux` | 131 | 4459 | 章节选择 |
| `src/pages/cg/cg.ux` | 333 | 12944 | CG 鉴赏 |
| `src/pages/settings/settings.ux` | 302 | 11305 | 设置 |
| `src/pages/about/about.ux` | 289 | 11875 | 关于（含彩蛋） |
| `tools/gen_story.py` | 884 | 34986 | 剧本编译器（Ren'Py → 分块节点） |
| `tools/gen_assets.py` | 257 | 11898 | 美术生成器（大图 → 手环 PNG） |
| `tools/validate_story.py` | 133 | 4880 | 剧本校验器 |
| `tools/simulate.py` | 233 | 8377 | 剧情流程模拟器 |
| `tools/test_paginate.js` | 477 | 21791 | 排版/几何/跨文件一致性测试 |
| `tools/build.js` | 180 | 7287 | 构建前静态检查 + 构建包装 + 产物校验 |
| `tools/assets.json` | 764 | 16204 | **生成**：源图 → 输出图映射表（`kind/key/src/out`） |
| `README.md` | 796 | 46864 | 设计说明 + 已知坑 |

### 0.4 目标端基线（`galgad` 工程）

> ⚠️ **时效说明**：本节记录的是**分析开工时（2026-11-09 19:25）**的目标工程状态。
> 本分析与移植是并行的：分析结束时目标端已完成首轮落地（`src/manifest.json` 已含全部 5 个 `blueos.*` feature、
> `router` 已改为 `Home/Game/Saves/Chapters/Gallery/Settings/About` 且 `pages/Game` 配了 `followHand:"disable"`、
> `designWidth:466`、`deviceTypeList` 含 `watch-round`）。**实际以目标工程当前文件为准**，本节只用于理解“起点差异”。

| 项 | 开工时的值 | 出处 |
|---|---|---|
| 目标包名 | `galgad.lico` | `galgad/src/manifest.json` |
| designWidth | **466** | 同上 |
| deviceTypeList | `["watch","watch-square"]`（开工时**无 round**） | 同上 |
| 开工时 features | 仅 `blueos.app.appmanager.router` | 同上 |
| 开工时页面 | `pages/Demo`、`pages/DemoDetail`（`component: index`，文件 `pages/<Name>/index.ux`） | 同上 |
| 样式单位 | `$size-factor: 5px`（`src/assets/styles/variables.scss:9`），如 `font-size: 7 * $size-factor` | `galgad/src/pages/Demo/index.ux:38` |
| 事件写法 | 模板里用 `onclick="onDetailBtnClick"`（Vela 风格） | `galgad/src/pages/Demo/index.ux:27` |

> **几何换算的硬事实**：源端画布 336×480（宽高比 0.7），目标端 designWidth 466 且设备类型含 `watch`/`watch-square`/`watch-round`。
> 源端所有坐标/字号/图片像素（背景 672×480、CG 854×480、立绘 143×380、正文区 316×122 等）**不能直接照搬**，
> 必须整体重排或按目标画布重新出图；源端的“1px = 1 物理像素”前提在目标端不成立（466 设计宽 ≠ 336）。
> 参考工程 `galgaoshou`（同样是 466 设计宽）的做法见 §17.16。

---

## 1. `src/manifest.json` 逐字段

完整原文（61 行）：

```json
{
  "package": "com.galgod.band",
  "name": "GalGod",
  "icon": "/common/icon.png",
  "versionName": "2.5.2",
  "versionCode": 50,
  "minPlatformVersion": 1100,
  "deviceTypeList": ["watch"],
  "features": [
    { "name": "system.router" },
    { "name": "system.storage" },
    { "name": "system.file" },
    { "name": "system.prompt" },
    { "name": "system.brightness" }
  ],
  "config": { "designWidth": 336, "logLevel": "log" },
  "router": {
    "entry": "pages/index",
    "pages": {
      "pages/index":    { "component": "index" },
      "pages/game":     { "component": "game" },
      "pages/saves":    { "component": "saves" },
      "pages/chapters": { "component": "chapters" },
      "pages/cg":       { "component": "cg" },
      "pages/settings": { "component": "settings" },
      "pages/about":    { "component": "about" }
    }
  },
  "display": { "backgroundColor": "#000000" }
}
```

逐字段说明与 BlueOS 对应（详见 §17）：

| 字段 | 值 | 语义/运行时作用 | BlueOS 对应 |
|---|---|---|---|
| `package` | `com.galgod.band` | 包名 | 同名保留（目标为 `galgad.lico`，按目标工程） |
| `icon` | `/common/icon.png` | 应用图标 192×192 | BlueOS 图标放 `src/assets/images/`，manifest 写 `/assets/images/xxx.png`（`galgad/src/manifest.json`:5） |
| `versionName/Code` | `2.5.2` / `50` | 版本。**与 `about.ux` 的 `APP_VER` 常量被 `tools/build.js` 强制核对**（build.js:91-103） | 保留两条，改版本须同步 |
| `minPlatformVersion` | `1100` | Vela 最低平台版本 | BlueOS 用 `distrubuteRules.minAPILevel` |
| `deviceTypeList` | `["watch"]` | 设备类型 | BlueOS 可选 `watch`/`watch-square`/`watch-round`（参考工程 `galgaoshou/src/manifest.json`） |
| `features` | 5 项 `system.*` | **能力声明**：`system.router`(页面跳转)、`system.storage`(键值)、`system.file`(读剧本资源)、`system.prompt`(toast)、`system.brightness`(屏幕常亮)。未声明的能力调用会失败（README 第 460-470 行明确说 brightness 必须在 features 里声明） | 换成 `blueos.app.appmanager.router`、`blueos.storage.storage`、`blueos.storage.file`、`blueos.window.prompt`、`blueos.hardware.display.brightness`（见 §17.9 / §17.8） |
| `config.designWidth` | `336` | 设计宽度 = 物理宽 → 所有 CSS 数值即物理像素，无换算（README 190-193） | 目标 `466` |
| `config.logLevel` | `log` | 保留 `log` 才能在固件日志看到 `[GalGod]` 诊断（README 第 663-666 行强调这是定位 bug 的关键） | BlueOS 无此字段；诊断改用 `console.log` |
| `router.entry` | `pages/index` | 启动页 | BlueOS 同样字段，但 uri 需前导斜杠 `/pages/X`（参考工程 `galgaoshou/src/pages/Home/index.ux:89`） |
| `router.pages.<path>.component` | `index/game/...` | 页面组件名 = 目录同名文件 | BlueOS 页面为 `pages/<目录>/index.ux` 且 manifest 里写 `"component": "index"`（目标工程现状） |
| `display.backgroundColor` | `#000000` | 窗口底色（黑） | 同名保留 |

### 1.1 `src/app.ux`（全文 7 行）

```js
<script>
export default {
  /**manifest**/
  onCreate() {},
  onError(e) {}
}
</script>
```

- **无全局生命周期、无全局状态**。所有初始化都在各页 `onInit()` 里做。
- 注释 `/**manifest**/` 是 Vela 工具链的清单注入占位标记。

---

## 2. 全局结构：页面图、路由参数、storage 键

### 2.1 页面跳转图（`router.push` / `router.replace` / `router.back`）

```
pages/index ──push──> pages/game            (无参数：从序章开始)          index.ux:84
pages/index ──push──> pages/game?auto=1     (继续上次自动存档)             index.ux:85
pages/index ──push──> pages/saves?mode=load                                index.ux:86
pages/index ──push──> pages/chapters                                       index.ux:87
pages/index ──push──> pages/cg                                             index.ux:88
pages/index ──push──> pages/settings                                       index.ux:89
pages/index ──push──> pages/about                                          index.ux:90
pages/index ──$app.exit() -> 退出应用                                       index.ux:91

pages/game  ──push──> pages/saves?mode=save （先写 storage.pendingSave）     game.ux:1242
pages/game  ──push──> pages/saves?mode=load                                game.ux:1246
pages/game  ──push──> pages/chapters                                       game.ux:1247
pages/game  ──push──> pages/cg                                             game.ux:1248
pages/game  ──push──> pages/settings                                       game.ux:1249
pages/game  ──replace──> pages/index （结局后轻触返回标题 / 菜单“主页”）     game.ux:1019,1250
pages/game  ──$app.exit() （菜单“退出”）                                    game.ux:1251

pages/saves ──replace──> pages/game?auto=1                                  saves.ux:138
pages/saves ──replace──> pages/game?load=<slot>                             saves.ux:155
pages/saves ──router.back()                                                saves.ux:176
pages/chapters ──replace──> pages/game?at=<start>                           chapters.ux:126
pages/chapters ──router.back()                                             chapters.ux:129
pages/cg ──router.back()                                                   cg.ux:331
pages/settings ──router.back()                                             settings.ux:299
pages/about ──router.back()                                                about.ux:287
```

### 2.2 `pages/game` 路由参数（在 `protected` 里声明才会被注入，game.ux:302-305）

| 参数 | 类型（字符串） | 语义 | 优先级/分支 |
|---|---|---|---|
| `at` | string，十进制节点下标 | 从该节点直接开始（章节跳转） | `afterIndex()` 里**最先判断**；`parseInt` 失败或 <0 → 0（game.ux:507-513） |
| `load` | string，存档槽位 0-5 | 读取 `saves[slot]` | 其次判断；`restoreFromSlot(parseInt(load))`（game.ux:516-517） |
| `auto` | string `'1'` | 读取 `autoSave` | 再次；要求 `autoData.magic === SAVE_MAGIC`（game.ux:518-520） |
| （都没有） | — | 从节点 0（序章）开始 | game.ux:522-523 |

> 三个参数都是**字符串**；`at`/`load` 需 `parseInt`，且 `''` 与 `undefined` 都按“未传”处理（game.ux:503-505）。
> 目标端同样必须能接受字符串路由参数并做空值/`'null'`/布尔兜底（参考工程 `galgaoshou/src/common/story/loader.js:53-60` 有专门注释说明 `Number()` 会把 `null/''/true` 变成 0）。

### 2.3 storage 键总表（**全部**持久化状态）

| 键 | 类型（JSON 后） | 写入点 | 读取点 | 说明 |
|---|---|---|---|---|
| `settings` | object | `reader.js:140`（`saveSettings`，会先 `delete fast`）、`game.ux:1205/1218`、`settings.ux:191/197` | `reader.js:131`（`loadSettings`） | 见 §3.2 |
| `saves` | array[6]，元素为存档对象或 `null` | `reader.js:148`（`saveSaves`）、`saves.ux:147/173` | `reader.js:144`、`game.ux:535`（`restoreFromSlot` 直读）、`saves.ux:93` | 手动存档 6 槽（`MAX_SLOTS=6`） |
| `autoSave` | 存档对象 | `reader.js:156`、`game.ux:1265/1312` | `reader.js:152`、`game.ux:514`、`index.ux:72`、`chapters.ux:64`、`saves.ux:94` | 自动存档（单份） |
| `cgSeen` | number[]（IMG 下标数组） | `reader.js:166`、`game.ux:808`（去抖 500ms）、`about.ux:282`（全解锁） | `reader.js:162`、`game.ux:376`、`cg.ux:212` | CG 鉴赏解锁记录，对应原作 `renpy.seen_image` |
| `cleared` | object `{ok:1, at:<ms>}` | `reader.js:176`（`markCleared`）、`game.ux:1263`、`about.ux:266` | `reader.js:172`（`loadCleared` → 返回 `!!v.ok`）、`game.ux:375`、`chapters.ux:68` | 真结局通关标记；后日谈章节 `need:1` 依赖它 |
| `pendingSave` | 存档对象（JSON 字符串） | `game.ux:1239`（`goSave` 写） | `saves.ux:95-104`（读到后**立即 `storage.delete`**） | 跨页传“待保存进度”的临时键；只用于 `mode=save` |

### 2.4 存档对象（`collectSave()`，game.ux:568-583；`SAVE_MAGIC = 'galgod-band-1'`，game.ux:210）

```js
{
  magic: 'galgod-band-1',   // 校验用；所有读档处都要比对
  pc: <number>,             // 当前节点下标
  chapter: <number>,        // 章节索引（chapterIndex() 0 起）
  flags: { ... },           // 全部 flag 快照
  bgSrc: '<图片路径或空串>',
  showBlack: <bool>, showWhite: <bool>,
  cs: [ {k,i,s}, ... ],     // 立绘原始数组（不是渲染后的 spL/spC/spR）
  cgSrc: '<图片路径或空串>',
  tint: '<"memory" | 空串>',
  text: '<预览文本，≤24 字 + 省略号>',   // previewText()，game.ux:585-588
  at: <Date.now()>
}
```

> 存档**不含** `hist`（快退快照栈）、`pages/pageIdx`（分页位置）、`seenSeen` 等运行时态——
> 读档后一律从该节点第一页重新显示（`applySave()` → `goto(pc)`）。

---

## 3. `src/common/reader.js`（177 行）

### 3.1 常量

| 常量 | 值 | 行号 | 用途 |
|---|---|---|---|
| `SIZE_MIN` / `SIZE_MAX` | 14 / 30 | 8-9 | 正文字号 px 范围 |
| `SPEED_MIN` / `SPEED_MAX` | 0 / 120 | 12-13 | 打字机 毫秒/字 |
| `AUTO_MIN` / `AUTO_MAX` | 0 / 200 | 16-17 | 自动播放 毫秒/字 |
| `MAX_SLOTS` | 6 | 31 | 手动存档槽数 |

### 3.2 `DEFAULT_SETTINGS`（reader.js:19-29）——设置对象的**唯一**字段定义

| 字段 | 类型 | 默认 | 范围/取值 | 语义 |
|---|---|---|---|---|
| `size` | number int | `20` | 14–30 | 正文字号 px |
| `speed` | number int | `28` | 0–120 | 打字机每字毫秒；0 = 整句立即显示 |
| `autoMs` | number int | `0` | 0–200 | 自动播放每字停留毫秒；0 = 关闭 |
| `fast` | boolean | `false` | true/false | 快进（**临时态，不持久化**） |
| `keepOn` | boolean | `true` | true/false | 阅读时屏幕常亮 |
| `longpress` | string | `'off'` | `'hide'` / `'fast'` / `'off'` | 长按画面行为 |

`normalizeSettings(raw)`（reader.js:39-61）的**全部**兼容规则（移植时必须逐条保留，否则老存档行为变化）：

1. `Object.assign({}, DEFAULT_SETTINGS, raw || {})` 合并。
2. `size/speed/autoMs` 经 `clampInt(v, lo, hi, default)`：`Math.round(Number(v))`，非有限数回落默认值，再夹取范围（reader.js:33-37）。
3. **`fast` 一律强制 `false`**（reader.js:45）：不持久化；老存档里残留的 `true` 会被丢弃。
4. **`keepOn` 不能用 `!!`**（reader.js:48-49）：`undefined/null` → 默认 `true`，其它值 `!!`。原因：老存档没有这个键时 `!!undefined` 会变成 `false`，与默认行为不一致。
5. `longpress` 三态 + 两种老格式兼容（reader.js:52-56）：`true`→`'hide'`；`false`→`'off'`；其它非三态值→默认 `'off'`。
6. 删除历史字段 `s.auto`、`s.autoSpeed`（reader.js:58-59，2.4 版旧格式）。

`autoDelay(text, autoMs)`（reader.js:64-67）：

```
n = text.replace(/\s/g,'').length      // 去掉所有空白后的字数
delay = clamp(round(700 + n * autoMs), 1200, 12000)   // 毫秒
```

### 3.3 换行与分页（正文页与关于页共用）

`BREAK_AFTER = '，。！？；：、）」』…—'`（reader.js:74，14 个字符，用于“断行优先落在标点之后”）。

`wrapText(text, cpl)`（reader.js:76-94）——**必须逐字复刻**的算法：

```js
export function wrapText(text, cpl) {
  const lines = []
  const raws = String(text || '').split('\n')     // 原始文本里的 \n 是“硬换行”
  for (let i = 0; i < raws.length; i++) {
    let s = raws[i]
    if (s === '') { lines.push(''); continue }
    while (s.length > cpl) {
      let cut = cpl
      const lo = Math.max(2, cpl - 8)             // 最多向前回退 8 个字符找标点
      for (let k = cpl; k > lo; k--) {
        if (BREAK_AFTER.indexOf(s.charAt(k - 1)) >= 0) { cut = k; break }
      }
      lines.push(s.slice(0, cut))
      s = s.slice(cut)
    }
    lines.push(s)
  }
  return lines.length ? lines : ['']
}
```

- 每行**尽量不超过 `cpl`**；只有在 `s` 剩余长度仍 > cpl 时才切。
- 切点搜索区间是 `(cpl-8, cpl]`，命中第一个标点即切（从 `cpl` 往前找）。
- 硬换行 `\n` 产生空行时 push `''`；末尾一定 push 剩余串（可能为空串）。
- 全空输入返回 `['']`。

`paginateText(text, cpl, lpp)`（reader.js:96-101）：按 `lpp` 行一页切片，返回 `pages[page][line]`；空输入返回 `[['']]`。

> 设计动因（reader.js:6-7、69-72 注释）：剧本存**原始文本**，分页在运行时按当前字号现算，
> 所以字号可以无级调节而不会“预先切好的行随字号失效”。

### 3.4 storage 封装（所有页面只用这 6+ 个函数，不直接碰 storage 的 JSON 逻辑）

| 函数 | 行号 | 行为 |
|---|---|---|
| `readJSON(key, fallback, done)` | 105-119 | `storage.get({key, default:'', success, fail})`；空串/`JSON.parse` 异常/`fail` **都回调 fallback** |
| `writeJSON(key, value, done)` | 121-128 | `storage.set({key, value: JSON.stringify(value), success:()=>done(true), fail:()=>done(false)})` |
| `loadSettings(done)` | 130-132 | `readJSON('settings', null)` → `normalizeSettings` |
| `saveSettings(s, done)` | 134-141 | 拷贝后 **`delete t.fast`** 再写 `settings`（fast 是临时态，见 §17.18 的菜单开关） |
| `loadSaves(done)` / `saveSaves(list, done)` | 143-149 | `saves` 键，非数组回落 `[]` |
| `loadAutoSave(done)` / `saveAutoSave(data, done)` | 151-157 | `autoSave` 键，无默认值（`null`） |
| `loadSeen(done)` / `saveSeen(list, done)` | 161-167 | `cgSeen` 键，非数组回落 `[]` |
| `loadCleared(done)` | 171-173 | `cleared` 键 → `!!(v && v.ok)`，回调 **boolean** |
| `markCleared(done)` | 175-177 | 写 `{ok:1, at:Date.now()}` |

> 注释（reader.js:1-2）：手环只跑单页，这里**不做缓存**，避免页面销毁后仍被全局引用。

---

## 4. `src/common/assets.js`（234 行，**由 tools/gen_story.py 生成，勿手改**）

结构：三张表，`IMG` 是唯一路径来源（剧本节点里只存整数下标）。

### 4.1 `IMG` 数组：共 **127** 项（下标即剧本里的资源号）

| 下标区间 | 类别 | 项数 | 路径形态 | 尺寸 |
|---|---|---|---|---|
| `0` – `37` | 背景 `bg` | 38 | `/common/img/b/<代号>.png` | **672×480**（PNG 调色板，80 色） |
| `38` – `92` | 立绘 `sp` | 55 | `/common/img/s/<三位序号>.png`（`000`…`054`） | **143×380**（带透明通道，128 色） |
| `93` – `126` | CG / SDCG | 34 | `/common/img/c/<代号>.png` | **854×480**（56 色） |

- 立绘序号 = 在该类别内的序号（`%03d`），与 `SP` 表的 key 无关；**同一角色不同表情按 `"角色码|表情"` 字典序排序**后依次编号（gen_story.py:637-641）。
- CG 代号：`cg_001`…`cg_013`、`cg_noctella_descend`、`cg_noctella_descend_full`、`sd_001`…`sd_019`。

`IMG` 前 4 项与末 2 项原文（用于核对顺序与大小写）：

```js
export const IMG = [
  "/common/img/b/box_seat.png",
  "/common/img/b/classroom1.png",
  "/common/img/b/classroom2.png",
  "/common/img/b/classroom3.png",
  ...
  "/common/img/c/sd_018.png",
  "/common/img/c/sd_019.png",
]
```

背景 38 项顺序（下标 → 代号）：

```
0 box_seat        1 classroom1      2 classroom2     3 classroom3
4 classroom_floor 5 computer_desk   6 elevator       7 heavenly_altar
8 heavenly_altar_focus 9 hotel_corridor 10 hotel_entrance 11 hotel_livingroom
12 hotel_restaurant 13 kitchen      14 living_room1  15 living_room2
16 moon           17 moon_all        18 neighborhood  19 neighborhood_vague
20 noctella_background 21 pavilion   22 riverside_road 23 riverside_road2
24 room1_4        25 school1         26 school2       27 shopping_mall
28 sportsroom     29 stair_landing   30 street1_1     31 street1_2
32 street2_1      33 street2_2       34 street3_1     35 tearoom
36 test_paper     37 urban_skies
```

### 4.2 `BG` 表：代号 → 下标（**40** 项 = 38 背景 + 2 特殊值）

```js
export const BG = {
  "black": -1,   // 纯黑：运行时用 <div class="solid"> 画，不用图片
  "white": -2,   // 纯白：用 <div class="solid-white"> 画
  "box_seat": 0, ..., "urban_skies": 37
}
```

> `-1` / `-2` 是**哨兵值**，不是 IMG 下标；`applyBg()` 对它们分别置 `showBlack/showWhite`。
> `BG` 表在运行时**并未被任何页面 import**（`game.ux` 只 import `IMG`，game.ux:204）。
> 它的实际用途是给人看/给工具核对；移植时可直接由 `IMG` 前缀推出。

### 4.3 `SP` 表：`"角色码|表情"` → 下标（**55** 项）

完整原文（assets.js:178-234，全部 55 项）：

```js
export const SP = {
  "father|shadow": 38, "jwq|叹气": 39, "jwq|坚定": 40, "jwq|嫌弃": 41,
  "jwq|尴尬": 42, "jwq|平静": 43, "jwq|微笑": 44, "jwq|恐惧": 45,
  "jwq|指摘": 46, "jwq|挺好颜": 47, "jwq|游刃有余": 48, "jwq|痛苦": 49,
  "jwq|眯眼": 50, "jwq|空洞": 51, "jwq|空洞2": 52, "jwq|落寞": 53,
  "jwq|计划通": 54,
  "lx|发情": 55, "lx|叹气": 56, "lx|哭哭": 57, "lx|害羞": 58,
  "lx|平静": 59, "lx|平静带怒": 60, "lx|开心": 61, "lx|微笑": 62,
  "lx|忧伤": 63, "lx|惊讶": 64, "lx|无语": 65, "lx|欲言又止": 66,
  "lx|白眼": 67, "lx|萌怒": 68, "lx|闭眼微笑": 69, "lx|鼓嘴气气": 70,
  "mother|shadow": 71,
  "noctella|微笑": 72, "noctella|无口": 73, "noctella|神之笑": 74,
  "other|renchao": 75,
  "ty_a|shadow": 76,
  "xl_l|卖萌叹气": 77, "xl_l|卖萌哭哭": 78, "xl_l|卖萌惊讶": 79,
  "xl_l|卖萌气气": 80, "xl_l|卖萌疑惑": 81, "xl_l|害羞": 82,
  "xl_l|抽泣": 83, "xl_l|温柔": 84,
  "xl|卖萌叹气": 85, "xl|卖萌哭哭": 86, "xl|卖萌惊讶": 87,
  "xl|卖萌气气": 88, "xl|卖萌疑惑": 89, "xl|害羞": 90,
  "xl|抽泣": 91, "xl|温柔": 92,
}
```

> 角色码含义（gen_story.py:32-40 `SPEAKER_NAMES`）：`cz`=陈舟、`me`=我、`jwq`=江晚晴、`lx`=林曦、
> `xl`/`xl_l`=小涟（`xl_l` 是幼年/另一套）、`noctella`/`nt`=诺提拉、`father`/`mother`=父母（剪影）、
> `ty_a`=健壮男生、`other`=杂鱼（renchao）。
> **`SP` 表同样不被页面 import**（运行时只用 `IMG`）。真实使用的立绘下标是 `cs[].i`。
> 实测 53/55 被剧本使用，**下标 77、78（`xl_l|卖萌叹气`、`xl_l|卖萌哭哭`）从未使用**。

---

## 5. `src/common/cglist.js`（3 行，由 `gen_story.py` 生成）

```js
export const CGG = [{"n":"政客","th":"/common/img/t/g0.png","u":108,"im":[108,109]}, …]
```

字段：`n` 组名、`th` 缩略图路径（`/common/img/t/g<组序>.png`，96×54）、`u` **解锁所需的 IMG 下标**（原作 `renpy.seen_image` 语义）、`im` 该组包含的 IMG 下标数组（鉴赏时可左右翻差分）。

9 组全部数据（按数组顺序即 UI 列表顺序）：

| # | `n` 组名 | `th` | `u` 解锁图下标 | `im` 本组图片下标 | 张数 |
|---|---|---|---|---|---|
| 0 | 政客 | `/common/img/t/g0.png` | 108 | `[108,109]` | 2 |
| 1 | 林曦 · 教室 | `/common/img/t/g1.png` | 111 | `[111,112,113,114,115,116,117,118,119,120]` | 10 |
| 2 | 小涟 | `/common/img/t/g2.png` | 93 | `[93,94,95]` | 3 |
| 3 | 球场 | `/common/img/t/g3.png` | 126 | `[126]` | 1 |
| 4 | 林曦 · 冰激凌 | `/common/img/t/g4.png` | 121 | `[121,122,123,124,125]` | 5 |
| 5 | 林曦 · 推倒 | `/common/img/t/g5.png` | 96 | `[96,97]` | 2 |
| 6 | 江晚晴 · 雨 | `/common/img/t/g6.png` | 98 | `[98]` | 1 |
| 7 | 林曦 · 告白 | `/common/img/t/g7.png` | 99 | `[99,100,101,102,103,104,105]` | 7 |
| 8 | 诺提拉 | `/common/img/t/g8.png` | 106 | `[106]` | 1 |

- 合计 **9 组 / 32 张** 不同差分（README 第 15 行）。
- 分组与解锁条件对应原作 `screens/gallery.rpy` 的 9 个 `g.button`（gen_story.py:597-611 `GALLERY`）。
- 解锁规则：**`seen` 集合里含 `u` 即整组解锁**（cg.ux:223、244）；不是逐张解锁。
- 全解锁彩蛋（about.ux:272-285）：把 9 组 `im` 去重合并（= 32 个下标）一次性写进 `cgSeen`。

---

## 6. 剧本数据格式（`src/common/story/`）

### 6.1 `index.txt`（1 行 JSON）

顶层键（实测顺序）：`ver, title, nodeCount, chunkSize, entry, chapters, chunks`。

```json
{
  "ver": 1,
  "title": "GalGod",
  "nodeCount": 5569,
  "chunkSize": 128,
  "entry": 0,
  "chapters": [ …18 项… ],
  "chunks": [ …44 项… ]
}
```

### 6.2 章节表（18 项，**顺序即数组序**；`start` 为节点下标）

| # | `id` | `title` | `start` | 标志 | 节点数 | 节点类型分布 |
|---|---|---|---|---|---|---|
| 0 | `1_1` | 第一幕 · 月幕 | 0 | — | 207 | s 203, sf 4 |
| 1 | `1_2` | 第一幕 · 教室 | 207 | — | 301 | s 301 |
| 2 | `1_3` | 第一幕 · 夜谈 | 508 | — | 213 | s 213 |
| 3 | `1_4` | 第一幕 · 霁光 | 721 | — | 188 | s 188 |
| 4 | `2_1` | 第二幕 · 校园 | 909 | — | 371 | s 371 |
| 5 | `interlude1` | 间章 · 小涟的日常 | 1280 | — | 147 | s 147 |
| 6 | `interlude2` | 间章 · 回到学校 | 1427 | — | 180 | s 180 |
| 7 | `2_2` | 第二幕 · 茶餐厅 | 1607 | — | 496 | s 484, o 2, j 8, f 2 |
| 8 | `2_3` | 第二幕 · 街道 | 2103 | — | 402 | s 402 |
| 9 | `2_4` | 第二幕 · 雨夜 | 2505 | — | 420 | s 412, sf 4, o 1, j 2, f 1 |
| 10 | `3_1` | 第三幕 · 抉择 | 2925 | — | 176 | s 176 |
| 11 | `3_2` | 第三幕 · 河畔 | 3101 | — | 385 | s 385 |
| 12 | `3_3` | 第三幕 · 心意 | 3486 | — | 539 | s 539 |
| 13 | `3_4` | 第三幕 · 天选试 | 4025 | — | 776 | s 713, o 11, f 10, j 40, cj 1, e 1 |
| 14 | `end_te` | 真结局 · 这片月幕 | 4801 | **`hide:1`** | 181 | j 8, s 168, o 1, sf 3, cj 1 |
| 15 | `end_ne1` | 结局 · 二人的世界 | 4982 | **`hide:1`** | 109 | j 3, s 105, cj 1 |
| 16 | `end_ne2` | 结局 · 回归日常 | 5091 | **`hide:1`** | 67 | j 3, s 63, cj 1 |
| 17 | `after_story_noctella` | 后日谈 · 诺提拉 | 5158 | **`need:1`** | 411 | sf 2, s 407, j 1, e 1 |

章节字段语义（`gen_story.py:462-468` `chapter_rec()` 是唯一产生点）：

| 字段 | 类型 | 何时出现 | 语义 |
|---|---|---|---|
| `id` | string | 总有 | 章节标识（`tools/gen_story.py` 的 `LABEL_FILE`/`CHAPTER_TITLES` 的键） |
| `title` | string | 总有 | HUD 与章节列表显示名 |
| `start` | number | 总有 | 起始节点下标；**章节区间 = [start, 下一章 start)**，末章到 `nodeCount` |
| `hide` | `1` | 仅 `end_te/end_ne1/end_ne2` | 章节选择里**永不显示**，也**不可**被“下一章”跳入 |
| `need` | `1` | 仅 `after_story_noctella` | 需 `cleared` 为真才显示/可跳（通关真结局后） |

**过滤规则的两处实现必须一致**：
- 章节列表页：`chapters.ux:88-101` —— `if (c.hide) continue;` 然后 `if (c.need && !this.cleared) continue;`
- 阅读菜单“下一章”：`game.ux:1228-1233` —— `while (i < list.length && (list[i].hide || (list[i].need && !this.cleared))) i++`

> 结果：未通关 = 14 章（#0–#13）；通关真结局后 = 15 章（多出后日谈）。
> 注意：后日谈**不是**“第 15 章”意义上的接续，它的 `start=5158` 在三个结局之后。

### 6.3 分块表（`chunks`，44 项）

```json
{"file":"/common/story/chunk-000.txt","start":0,"count":128}
…
{"file":"/common/story/chunk-043.txt","start":5504,"count":65}
```

- 全部 44 块：前 43 块 `count:128`，末块 `count:65`；`start` 严格连续（0,128,256,…,5504），合计 5569 = `nodeCount`。
- 每块文件是**一个 JSON 数组**，长度必须等于 `count`（`game.ux:651` 与 `validate_story.py:42-43` 都强校验）。
- 加载粒度：一次 1 块（约 5–15 KB）；缓存只留“当前块 + 下一块”（`trimCache`，game.ux:671-680）。

### 6.4 节点类型总表（实测计数，全 5569 节点）

| `t` | 类型 | 数量 | 必含字段 | 可选字段 |
|---|---|---|---|---|
| `s` | 台词（say） | **5457** | `n`(说话人，可为空串)、`x`(原始文本) | `bg`、`cs`、`cg`、`tint` |
| `o` | 选项组（menu） | **15** | `o`: 选项数组 | （节点级无 bg/cs/cg——实测 15 个 o 节点均无） |
| `j` | 无条件跳转 | **65** | `j`: 目标下标 | — |
| `cj` | 条件跳转 | **4** | `v`、`op`、`n`、`j` | — |
| `f` | flag 累加 | **13** | `v`、`n` | — |
| `sf` | flag 赋值（set flag） | **13** | `v`、`n` | — |
| `e` | 结局（end） | **2** | `x`: 结局标题 | `bg`（实测 1 个 e 带 `bg:-1`） |

> `t` 之外**没有任何其它字段组合**（字段集合经穷举统计，见 §6.5 的分布表）。
> 节点里**没有** `bg:null`/`cs:null` 这类显式 null——只有“键不存在”或真实值。
> `sf` 与 `f` 的区别：`f` 是**累加**（`flags[v] = (flags[v]||0) + n`），`sf` 是**直接赋值**（`flags[v] = n`）。

### 6.5 `s` 节点：字段与分布

`s` 字段组合分布（`n`/`x`/`t` 必有）：

| 组合 | 数量 | 说明 |
|---|---|---|
| `n,x` | 4657 | 纯台词（继承上一状态） |
| `cs,n,x` | 609 | 台词 + 换立绘 |
| `bg,n,x` | 84 | 台词 + 换背景（**并隐式清空立绘**，见 §6.8） |
| `cg,n,x` | 60 | 台词 + 显示 CG |
| `bg,cs,n,x` | 34 | 换景 + 立绘 |
| `cg,cs,n,x` | 6 | CG + 立绘 |
| `bg,cg,cs,n,x` | 2 | 三者同时 |
| `cg,n,tint,x` | 1 | CG + 滤镜 |
| `cg,cs,n,tint,x` | 1 | CG + 立绘 + 滤镜 |
| `bg,cg,cs,n,tint,x` | 1 | 全字段（1027 号附近） |
| `bg,cs,n,tint,x` | 1 | 背景 + 立绘 + 滤镜 |
| `bg,cg,n,x` | 1 | 背景 + CG（无立绘） |

真实样例（`chunk-000.txt` 内，节点下标为全局下标）：

```json
{"t":"s","n":"","x":"月幕下，清辉洒落。","bg":16}
{"t":"s","n":"林曦","x":"哟，舟子，早上好~","cs":[{"k":"lx","i":62,"s":"center"}]}
{"t":"s","n":"林曦","x":"哎，孩子脑子被撞傻了。","cs":[{"k":"lx","i":65,"s":"c"}]}
{"t":"s","n":"","x":"我牵着她来到房间，愉快地开始了Galgame。","bg":24,"cg":-1,"cs":[{"k":"xl","i":92,"s":"c"}]}
{"t":"s","n":"","x":"一瞬间，我又回想起了那时曦曦的样子。","tint":"memory","cg":97}
{"t":"s","n":"","x":"三年前。","cg":-1,"tint":"","cs":[{"k":"lx","i":60,"s":"c"}]}
{"t":"s","n":"","x":"………………","bg":33}
{"t":"s","n":"","x":"遗世独立的天空分外从容，全然不见欲与他者比高的俗念，\n今晚依旧如故，清丽，澄澈。"}
```

`x` 文本统计：**短句最少 1 字，最长 117 字，平均 21.88 字**；**172 句含 `\n`**（最多 2 个换行，即 3 段）。
说话人 `n` 全集与出现次数（24 种，`''` 为旁白）：

```
'' 3301, 陈舟 728, 林曦 498, 江晚晴 425, 小涟 173, 我 101, 诺提拉 84,
成熟男士 25, 班主任 22, 同学A 17, 贵气妇人 17, 健壮男生 15, 政客 13,
同学B 10, ??? 9, 工作人员 6, 校友A 3, 校友B 3, 远处的声音 2, 众人 1,
校友C 1, 记者A 1, 记者B 1, 记者C 1
```

### 6.6 `o` 节点：选项与条件

结构：

```json
{"t":"o","o":[
  {"x":"选项文本","j":<目标节点下标>,"c":null},
  {"x":"选项文本","j":<目标节点下标>,"c":["flag名",">=",4]}
]}
```

- `c` 是**显示条件**：`null` 或 `[flag名, 运算符, 整数]` 三元组。为 `null` 时恒显示。
- 运算符全集实测只有 **`>=`** 与 `==`**（cj 同）；`testCond` 支持 `>= <= > < ==`（未知运算符按 `==` 处理）。
- 选项数量分布：2 项×3、3 项×3、4 项×7、5 项×2（共 15 个选择点）。
- **全部 15 个 `o` 节点**（下标、选项、目标、条件）：

| 节点 | 选项（文本 → 目标 `j`；`c` 非空单独标注） |
|---|---|
| 1752 | 先进江晚晴个人线→1753；先进林曦个人线→1757；我全想要，所以安抚→1761 |
| 1809 | 东→1810；南→1812；西→1814；北→1816；全走一遍→1818 |
| 2908 | 废萌有白毛真女主是祖宗章法→2909；废萌不该有真女主哪怕是白毛→2914 |
| 4146 | 平衡好感度→4147；优先青梅，安抚天降→4149；优先天降，安抚青梅→4150 |
| 4254 | 雪饼→4255；泡芙→4256 |
| 4258 | 时间机器理论→4259；世界线收束理论→4260；平行宇宙理论→4262；量子隐形理论→4263 |
| 4265 | 樱→4266；绫→4267；枫→4269；丛→4270 |
| 4272 | 15块→4273；16块→4274；17块→4275；21块→4277 |
| 4279 | 可最喜欢你→4280；你有罪，都是你的错→4281 |
| 4283 | 衣笠老贼→4284；丸户老贼→4285；三排狂魔伞哥哥→4286；暖人心田岛哥哥→4287 |
| 4290 | 主角移情别恋→4291；被窥视内心→4292；家庭反对→4294；性格不合，日常矛盾太多→4295 |
| 4297 | 主打人体美学视觉冲击→4298；是推动剧情的战场→4300；一刀切转向高级审美→4302；公式化哦齁齁齁齁→4303 |
| 4306 | 15→4307；21→4308；30→4310；39→4311 |
| 4797 | 要对小涟放手→4798；要让小涟诞生→4799；**交给小涟选择→4800，`c:["true_end_flag",">=",4]`** |
| 4909 | 全选→4910；全都要→4911；三个都要→4912；要创造全员幸福的结局！→4913；我说我他妈要全选你耳朵聋吗？→4914 |

**唯一一个带条件的选项**是 4797 的第 3 项；`playChoice()` 里若过滤后为空会得到空选项列表
（源码没有兜底，`simulate.py:108-110` 把“选项全被条件过滤”当成失败情况）。

### 6.7 `j` / `cj` / `f` / `sf` / `e`

`j`（65 个）——全部目标（去重后）与语义：跳转用于“分支体汇合”“章节 `return` 落点”“结局回填”。
样例：

```json
{"t":"j","j":1764}
{"t":"j","j":4346}
{"t":"j","j":5568}
```

`cj`（4 个，**全部**）：

```json
{"t":"cj","v":"bad_end_flag","op":">=","n":7,"j":4319}     // 4317
{"t":"cj","v":"true_end_finish","op":"==","n":1,"j":5158}  // 4980
{"t":"cj","v":"true_end_finish","op":"==","n":1,"j":5158}  // 5089
{"t":"cj","v":"true_end_finish","op":"==","n":1,"j":5158}  // 5156
```

> 三条 `true_end_finish == 1 → 5158`（跳到后日谈）出现在**每个结局章末尾**；
> `bad_end_flag >= 7 → 4319` 决定 3_4 章是否走 Bad End。

`f`（13 个，**全部**）：

```json
{"t":"f","v":"true_end_flag","n":1}   // 1761, 1818, 2914, 4147
{"t":"f","v":"bad_end_flag","n":1}    // 4260, 4267, 4275, 4287, 4292, 4298, 4300, 4303, 4308
```

`sf`（13 个，**全部**）：

```json
{"t":"sf","v":"quick_menu","n":0}   // 0
{"t":"sf","v":"custom_ui","n":0}    // 1
{"t":"sf","v":"quick_menu","n":1}   // 28, 2707, 5158
{"t":"sf","v":"custom_ui","n":1}    // 29, 2708, 5159
{"t":"sf","v":"true_end_finish","n":1}  // 4978
{"t":"sf","v":"quick_menu","n":0}   // 2705, 4940
{"t":"sf","v":"custom_ui","n":0}    // 2706, 4941
```

> `quick_menu`/`custom_ui` 是原作 Ren'Py 的 UI 开关（`$ quick_menu = 0/1`），
> **手环版不消费这两个 flag**（没有 UI 依赖它们）；它们只被当作普通 flag 存/读。
> 真正驱动剧情分支的 flag 只有 3 个：`true_end_flag`、`bad_end_flag`、`true_end_finish`。

`e`（2 个，**全部**）：

```json
{"t":"e","x":"Bad End · 未能触碰的世界"}            // 4345（无 bg，沿用当前背景）
{"t":"e","x":"—— 全剧终 ——","bg":-1}               // 5568（黑屏）
```

### 6.8 图片引用字段的语义与继承规则（**移植最关键的一节**）

引擎按**增量**方式应用节点字段（`step()`，game.ux:717-764），字段缺省 = **沿用当前状态**；
但 `bg` 有一个**隐式副作用**：

| 字段 | 类型 | 取值 | 应用逻辑（行号） | 缺省语义 |
|---|---|---|---|---|
| `bg` | number | `-1` 黑 / `-2` 白 / `0..37` 背景下标 | `applyBg()`（game.ux:776-782）：`bgSrc = idx>=0 ? IMG[idx] : ''`；`showBlack = idx===-1`；`showWhite = idx===-2`；并**重置全景平移**（`startBgPan()`） | 沿用 |
| `cs` | array | `[]` 或 `[{k,i,s}]` | `renderSprites()`（game.ux:784-794）：按 `s` 分到左/中/右三槽 | 沿用 |
| `cg` | number | `-1` 隐藏 / `93..126` 显示 | `cgSrc = cg>=0 ? IMG[cg] : ''`（game.ux:736-739）；`cg>=0` 时同时 `markSeen(cg)` | 沿用 |
| `tint` | string | `'memory'` 或 `''` | **直接赋值**（game.ux:740）：`this.tint = node.tint`；`''` 即关闭 | 沿用 |

**`bg` 的隐式清空立绘规则**（game.ux:731-734，注释在 727-730）：

```js
// `bg` 对应 Ren'Py 的 `scene`（换景），而 scene 会清空所有立绘。
if (node.bg !== undefined) {
  this.applyBg(node.bg)
  if (node.cs === undefined) { this.csRaw = []; this.renderSprites([]) }
}
```

- 即：**带 `bg` 且不带 `cs` 的节点 → 立绘全部消失**。
- 实测这类节点 **86 个**（例：2, 30, 85, 207, 376, 495, 508, 721, 827, 909 …）。
- 这是 Ren'Py `scene` 语义的忠实还原；若移植时只当“换背景”，会出现“本该没人的场景站着上一位人物”的 bug（README 第 728 行说数据里有 61 处，实测按“bg 无 cs”口径为 86 处）。
- 反向：`cs` 单独出现 = 换立绘但保留背景与 CG。

**`cs` 数组元素**（三字段固定，640 个元素全部同构）：

| 字段 | 类型 | 取值 | 语义 |
|---|---|---|---|
| `k` | string | 角色码：`jwq`/`lx`/`xl`/`xl_l`/`noctella`/`father`/`mother`/`other`/`ty_a` | 仅用于“同一角色替换表情”时的身份匹配（`gen_story.py:494-502`）与生成阶段，运行时**不参与渲染** |
| `i` | number | `38..92` | `IMG` 下标 = 图片路径 |
| `s` | string | `"c"`(543) / `"center"`(45) / `"right"`(30) / `"left"`(22) | 位置槽位 |

渲染规则（game.ux:784-794）：`s === 'left' → spL`；`s === 'right' → spR`；**其它一切值（含 `c`、`center`）→ spC**。
同槽位后写覆盖前写（循环按数组顺序），所以 `cs` 数组里**同一槽位出现多次时，最后一个生效**。
`cs` 长度分布：**1 个 608 次、2 个 16 次、0 个 30 次**；**从未出现 3 个**（三槽位不会同屏满员）。
`cs: []`（30 处）语义 = **清空所有立绘**。位置：158, 333, 1015, 1042, 1068, 2002, 2159, 2255, 2261, 2313, 2482, 2528, 2550, 2733, 2920, 2985, 3170, 3265, 4205, 4227, 4390, 4449, 4494, 4853, 4925, 4942, 5040, 5236, 5391, 5415。

**`cg` 的使用**：34 张 CG 全部被使用（下标 93–126 全覆盖）；`cg:-1` 出现 **6 次**（187, 294, 814, 1086, 2218, 2440），语义 = 隐藏 CG 层、回到背景。
CG 首次出现在 158 号节点（`cg:108`，政客演讲），最后一次 4772（`cg:107`）。

**`tint`**：全剧 **4 次**，只在 2438–2440 与 2709、3870：

```
2438  tint:"memory"  "一瞬间，我又回想起了那时曦曦的样子。" cg:97
2440  tint:""        "三年前。"                          cg:-1  cs:[{k:"lx",i:60,s:"c"}]
2709  tint:""        "……"                               cg:97  bg:21  cs:[{k:"jwq",i:45,s:"c"}]
3870  tint:""        "她捏着裙角…"                        bg:24  cs:[{k:"xl",i:92,s:"center"}]
```

即：**开启一次回忆滤镜（2438），两个节点后关闭（2440）**；后两次是清空（防止滤镜状态残留）。
渲染：`tint` 非空 → 显示一块全屏 `rgba(240, 222, 176, 0.22)` 色块（game.ux:135-136，`<div class="tint" if="{{tint}}">`）。

**背景 / CG / 立绘的绘制几何**（详见 §8.2）：

| 元素 | 元素尺寸 | 绘制规则 | 说明 |
|---|---|---|---|
| 背景 `bgwide` | 672×480 | `object-fit: fill`，`left` 由定时器在 `[-336, 0]` 间平移 | 素材比屏幕宽 2 倍 → 全景平移；裁切靠 `.bgclip{overflow:hidden}` |
| 立绘 `sp` | 143×380 | `object-fit: contain`，`top: 100px` | 三槽 `left: 10 / 96 / 182` |
| CG `layer` | 336×480 | `object-fit: cover`（满屏填满，裁两侧） | 覆盖背景与立绘之上 |
| CG 鉴赏大图 `big` | 854×480 | `object-fit: fill`，`left` 跟随手指（0 ～ -518） | 裁切靠 `.viewer{overflow:hidden}` |
| 回忆滤镜 `tint` | 336×480 | 纯色块 | 覆盖在 CG 之上、UI 之下 |

### 6.9 flags 全集（运行时 `this.flags` 对象）

| flag | 初始 | 产生节点 | 最大值 | 消费点 |
|---|---|---|---|---|
| `true_end_flag` | 不存在（读作 0） | `f` ×4（1761/1818/2914/4147） | 4 | 选项 4797 第 3 项的显示条件 `>=4` |
| `bad_end_flag` | 不存在（读作 0） | `f` ×9（3_4 章的答题错选） | 9 | `cj` 4317 `>=7` → 跳 4319（Bad End 线） |
| `true_end_finish` | 不存在 | `sf` 4978 = 1 | 1 | 三个结局章末尾的 `cj`（==1 → 后日谈）；`playEnd` 通关判定 |
| `quick_menu` | 不存在 | `sf`（0/1 交替） | 1 | **无**（仅存储，原作 UI 开关） |
| `custom_ui` | 不存在 | `sf`（0/1 交替） | 1 | **无** |

`testCond(node)`（game.ux:766-774）：

```js
const v = this.flags[node.v] || 0
if (node.op === '>=') return v >= node.n
if (node.op === '<=') return v <= node.n
if (node.op === '>')  return v >  node.n
if (node.op === '<')  return v <  node.n
return v === node.n      // '==' 及未知运算符都走这里
```

> `flags` **不写进 settings**，只进存档/自动存档（`collectSave().flags`）。
> `playEnd()` 判定通关的条件是 `flags.true_end_finish === 1`（game.ux:1261）——即只有真结局线会置位。

### 6.10 可核对的统计数字（移植后应完全一致）

| 指标 | 值 |
|---|---|
| 节点总数 | 5569 |
| 分块数 / 每块 | 44 / 128（末块 65） |
| 章节表项 | 18（正片 14 + 结局 3 + 后日谈 1） |
| 台词节点 | 5457 |
| 台词总字数（`x` 长度和） | **119,410**（去换行 119,227） |
| 含 `\n` 台词 | 172 |
| 最长台词 | 117 字 |
| 选择点 | 15（选项总数 **53**：2 项×3、3 项×3、4 项×7、5 项×2） |
| 带条件选项 | 1 |
| `j` / `cj` / `f` / `sf` / `e` | 65 / 4 / 13 / 13 / 2 |
| 使用到的背景图 | 37/38（未用 `19 neighborhood_vague`）；另 `-1`×15、`-2`×5 |
| 使用到的立绘 | 53/55（未用 77、78） |
| 使用到的 CG | 34/34；`cg:-1`×6 |
| `tint` | 4（`memory` 1 次 + 清空 3 次） |
| `bg` 无 `cs`（隐式清立绘） | 86 |
| `cs: []` 显式清立绘 | 30 |

---

## 7. `src/pages/index/index.ux`（93 行，主页）

### 7.1 模板结构（DOM 顺序即 z 序，无 z-index）

```html
<div class="page" onswipe="ban">                  <!-- L2 根：全屏 336×480 -->
  <image class="bg" src="/common/home.png"/>       <!-- L3 标题画（336×480，cover） -->
  <div class="shade"></div>                        <!-- L4 压暗层 rgba(13,9,16,0.34) -->
  <div class="panel">                              <!-- L6 按钮面板 top:240 高 240 -->
    <text class="resume" if="{{hasAuto}}">最近进度 · {{autoText}}</text>   <!-- L7 -->
    <text class="resume" if="{{!hasAuto}}">还没有存档，从序章开始吧</text>   <!-- L8 -->
    <div class="btn btn-main" onclick="start">开始阅读</div>               <!-- L10 -->
    <div class="btn" if="{{hasAuto}}" onclick="resume">继续阅读</div>       <!-- L11 -->
    <div class="row">  <!-- L13 5 个 46px 小按钮 -->
      存档 / 章节 / CG / 设置 / 关于                                        <!-- L14-18 -->
    </div>
    <div class="btn btn-quit" onclick="quit">退出</div>                     <!-- L20 -->
  </div>
</div>
```

主页**没有标题文字**：`home.png` 里已含“logo 在左、女孩在右”的完整构图，再叠字会盖住（注释 index.ux:33-35）。

### 7.2 样式几何（全部数值）

| 选择器 | 属性 |
|---|---|
| `.page` | `336×480`；`background-color:#0d0910`；`position:relative` |
| `.bg` | `absolute; top:0; left:0; 336×480; object-fit:cover` |
| `.shade` | `absolute; 0,0; 336×480; background-color:rgba(13,9,16,0.34)`（**不用 opacity**，注释 28-29） |
| `.panel` | `absolute; top:240; left:0; 336×240; background-color:rgba(21,15,25,0.94)`；`flex-direction:column; align-items:center; padding-top:12` |
| `.resume` | `font-size:15; color:#b9a7b3; margin-bottom:8` |
| `.btn` | `236×40; border-radius:20; background-color:#32243a`；居中；`margin-bottom:8` |
| `.btn-main` | `background-color:#b95079` |
| `.btn-quit` | `background-color:#241a2b` |
| `.btn-t` | `font-size:19; color:#fff`（主按钮文字） |
| `.btn-ts` | `font-size:16; color:#fff`（5 个小按钮文字，因 46px 宽必须缩字号，注释 47-49） |
| `.row` | `236 宽; flex-direction:row; justify-content:space-between` |
| `.btn-5` | `width:46`（`236/5≈46`）；另有未使用的 `.btn-half 114 / .btn-third 74 / .btn-quarter 54` |

面板垂直预算：`padding-top 12 + resume(≈21+8) + 主按钮 40+8 + 继续按钮 40+8 + 小按钮行 40+8 + 退出 40+8 ≈ 233 ≤ 240`。

### 7.3 数据与行为

`protected: { hasAuto:false, autoText:'' }`（index.ux:63-66）——**只暴露两个绑定字段**。

| 方法 | 行号 | 行为 |
|---|---|---|
| `onInit()` | 68 | `this.refresh()` |
| `onShow()` | 69 | `this.refresh()`（从 game 返回后刷新“继续阅读”状态） |
| `refresh()` | 71-81 | `loadAutoSave(d)`；若 `!d || d.magic !== 'galgod-band-1' || !d.pc` → `hasAuto=false, autoText=''`；否则 `autoText = '第' + ((d.chapter||0)+1) + '章'`，`hasAuto=true` |
| `ban()` | 83 | 空实现，只为吃掉 swipe 手势（防页面被滑走） |
| `start()` | 84 | `router.push({uri:'pages/game'})` |
| `resume()` | 85 | `router.push({uri:'pages/game', params:{auto:'1'}})` |
| `openSaves()` | 86 | `router.push({uri:'pages/saves', params:{mode:'load'}})` |
| `openChapters()` / `openCg()` / `openSettings()` / `openAbout()` | 87-90 | 对应页面，无参数 |
| `quit()` | 91 | `this.$app.exit()` |

> 注意：`refresh()` 用 `!d.pc` 判定——**`pc===0`（序章第一个节点）会被当成“没有进度”**，
> 也就是说刚开局就退出不会出现“继续阅读”。这是既有行为，移植时若想“零信息损失”应保留；
> 若要修正需明确记录为行为变更。

---

## 8. `src/pages/game/game.ux`（1315 行，引擎核心）

### 8.1 模板结构与 z 序（DOM 顺序 = 绘制顺序，**无 z-index**）

| 序 | 元素 | 行号 | 条件 `if` | 说明 |
|---|---|---|---|---|
| 1 | `.bgclip` > `<image class="bgwide" style="{{bgStyle}}">` | 15-17 | `bgSrc` 非空 | 全景背景；外层裁切容器 |
| 2 | `.solid` | 18 | `showBlack` | 纯黑遮罩（bg=-1） |
| 3 | `.solid-white` | 19 | `showWhite` | 纯白遮罩（bg=-2） |
| 4 | `<image class="sp sp-l" src="{{spL}}">` | 22 | `spL` | 立绘左槽 |
| 5 | `<image class="sp sp-c" src="{{spC}}">` | 23 | `spC` | 立绘中槽 |
| 6 | `<image class="sp sp-r" src="{{spR}}">` | 24 | `spR` | 立绘右槽 |
| 7 | `<image class="layer" src="{{cgSrc}}">` | 27 | `cgSrc` | CG 满屏层 |
| 8 | `.tint` | 30 | `tint` | 回忆滤镜色块 |
| 9 | `.hud`（章节名 + 进度） | 33-36 | `!uiHidden && !endText` | 顶部信息条 |
| — | `.menu-btn` | 40-42 | `if="{{false}}"` | **已禁用**（按钮隐藏，代码保留；改成 `{{!uiHidden && !endText}}` 即恢复） |
| 10 | `.panel` | 46 | `!uiHidden && !endText && !choices.length && !cgSrc` | 普通对话底板 |
| 11 | `.panel-cg` | 47 | `…&& cgSrc` | 看 CG 时更透的底板（同位置，只改透明度） |
| 12 | `<text class="name">` | 48 | `…&& speaker` | 说话人名牌 |
| 13-18 | `<text class="ln" style="{{s0..s5}}">` ×6 | 50-55 | `!uiHidden && !endText && !choices.length` | **6 个固定正文槽位** |
| 19 | `<text class="more">▼` | 58 | `…&& canTap` | 继续提示 |
| 20 | `<text class="badge">` | 61 | `badge` | 运行状态徽标（小色块，不挡画面） |
| 21 | `.choices` > `.choice` | 64-66 | `choices.length` | 选项（`for="{{choices}}" tid="cid"`，`onclick="pickChoice($idx)"`） |
| 22 | `.ending` | 69-72 | `endText` | 结局全屏 |
| 23 | `.menu` | 75-96 | `menu` | 阅读菜单 |

根节点事件（game.ux:2-4）：

```html
<div class="page" onclick="onTap" onlongpress="toggleImmersive"
     ontouchstart="onHoldStart" ontouchend="onHoldEnd" ontouchcancel="onHoldEnd"
     onswipe="blockSwipe">
```

几乎所有子元素都额外挂 `onswipe="blockSwipe"`（L15,16,22,23,24,27,30,40,46,47,48,65,78-95），
目的：**吃掉 swipe 手势、防止页面被横向拖走**，同时兼职“下滑开菜单”（`blockSwipe` 见 §8.15）。

### 8.2 样式几何（全部数值，含注释里的设计意图）

| 选择器 | 属性 | 备注（源码注释） |
|---|---|---|
| `.page` | `336×480; background-color:#000; flex-direction:column; position:relative; **overflow:hidden**` | 必须裁：背景图 672 宽，否则运行时会当横向可滚动区（L102-104） |
| `.layer` | `absolute; 0,0; 336×480; object-fit:cover` | CG 满屏 |
| `.bgclip` | `absolute; 0,0; 336×480; **overflow:hidden**` | 裁 672 宽背景 |
| `.bgwide` | `absolute; 0,0; **672×480**; object-fit:fill` | 宽图；**禁止 transition**（真机出竖向接缝） |
| `.solid` | `absolute; 0,0; 336×480; background-color:#000` | |
| `.solid-white` | `absolute; 0,0; 336×480; background-color:#fff` | |
| `.sp` | `absolute; **143×380**; object-fit:contain; **top:100px**` | 三槽共用 |
| `.sp-l` / `.sp-c` / `.sp-r` | `left:10px` / `left:96px` / `left:182px` | 相邻槽间隔 86px |
| `.tint` | `absolute; 0,0; 336×480; background-color:rgba(240,222,176,0.22)` | 回忆滤镜；**不用 opacity**（L133-134） |
| `.hud` | `absolute; top:10; left:12; height:26; padding-left/right:10; border-radius:13; background-color:rgba(0,0,0,0.55); flex-row; align-items:center` | |
| `.hud-t` | `font-size:17; color:#ffe6ef` | 章节名 |
| `.hud-p` | `font-size:15; color:#b9b0b6; margin-left:8` | 进度百分比 |
| `.menu-btn` | `absolute; top:6; left:278; 52×52; border-radius:26; background-color:rgba(27,21,32,0.82)` | 已禁用 |
| `.menu-ico` | `font-size:30; color:#ffd8e6` | |
| `.panel` | `absolute; **top:330; left:0; 336×150**; background-color:rgba(18,13,19,0.80)` | 普通底板 |
| `.panel-cg` | `absolute; top:330; left:0; 336×150; background-color:rgba(10,8,12,0.58)` | 看 CG 更透，**位置与普通底板完全一致** |
| `.name` | `absolute; **top:292; left:12**; font-size:20; color:#ffd8e6; font-weight:bold; background-color:rgba(16,11,18,0.74); padding:4/10; border-radius:9; text-shadow:0 1px 3px rgba(0,0,0,0.9)` | 名牌自带底板随文字宽度走（靠 padding+background） |
| `.ln` | `absolute; **left:10; width:316**; color:#fff; font-size:20; line-height:24; lines:1` | 位置/字号/行高由 `s0..s5` 动态覆盖 |
| `.more` | `absolute; **top:462; left:308**; font-size:16; color:#ff9ec4` | ▼ 继续提示 |
| `.badge` | `absolute; top:44; left:12; width:312; font-size:15; line-height:20; color:#ffd166; lines:3` | 状态徽标 |
| `.choices` | `absolute; **top:96; left:16; width:304**; flex-direction:column` | |
| `.choice` | `width:304; min-height:52; margin-bottom:8; padding:10; border-radius:12; background-color:rgba(36,26,43,0.94); color:#ffe6ef; font-size:19; line-height:26` | |
| `.ending` | `absolute; 0,0; 336×480; background-color:#07060a; flex-column; center/center` | |
| `.end-title` | `font-size:26; color:#ffe6ef; text-align:center; width:280; line-height:36` | |
| `.end-tip` | `font-size:17; color:#7d757f; margin-top:26` | “轻触返回标题” |
| `.menu` | `absolute; 0,0; 336×480; background-color:#140f17; flex-column; align-items:center; padding-top:14` | |
| `.menu-title` | `font-size:24; color:#ffd8e6; font-weight:bold` | “阅读菜单” |
| `.menu-sub` | `font-size:15; color:#a4979f; margin:4 0 10` | 章节 · 进度 |
| `.mbtn` | `**240×36**; border-radius:18; background-color:#2c2133; center/center; margin-bottom:5` | 菜单按钮 |
| `.mbtn-main` | `background-color:#b95079` | “继续阅读” |
| `.mbtn-quit` | `background-color:#241a2b; margin-top:4` | “退出” |
| `.mbtn-t` | `font-size:17; color:#fff` | |
| `.mrow` | `width:240; flex-row; justify-content:space-between` | 双按钮行 |
| `.mbtn-half` | `width:116` | 双按钮单项 |

菜单垂直预算：`14(padding) + 24 + 4+15+10 + 8 行(36+5) + quit(36+4+5) ≈ 480`（注释 L188）。

### 8.3 JS 顶层常量表（game.ux:210-294）

| 常量 | 值 | 行号 | 语义 / 跨文件约束 |
|---|---|---|---|
| `SAVE_MAGIC` | `'galgod-band-1'` | 210 | 存档格式校验串（6 处比对） |
| `TAG` | `'[GalGod] '` | 211 | 日志前缀 |
| `PANEL_TOP` | `330` | 216 | 对话底板上沿（须 == CSS `.panel{top}`，`test_paginate.js` 会核对） |
| `PANEL_H` | `150` | 217 | 底板高度 |
| `NAME_TOP` | `292` | 218 | 说话人名牌上沿 |
| `TEXT_TOP` | `338` | 219 | 正文第一行 y |
| `TEXT_BOX_W` | `316` | 220 | `.ln` 元素宽 |
| `TEXT_PAD` | `6` | 221 | 每行右侧余量（算每行字数用） |
| `TEXT_BOX_H` | `122` | 222 | 正文区高（保证末行 458 < `.more` 的 462） |
| `MAX_LINES` | `6` | 224 | 正文槽位数（必须 ≥ 字号 14 时的行数） |
| `BG_W` | `672` | 239 | 背景素材宽（须 = `gen_assets.py` 的 `BG_W` = CSS `.bgwide` 宽） |
| `BG_PAN_RANGE` | `BG_W - 336` = **336** | 240 | 可平移距离 |
| `BG_STEP_PX` | `4` | 241 | 每帧步长 |
| `BG_TICK_MS` | `100` | 242 | 帧间隔（10fps）→ 40px/s，扫完 336px 约 8.4s |
| `AUTO_DEFAULT` | `90` | 243 | 菜单打开自动播放时的默认毫秒/字 |
| `HOLD_MS` | `450` | 246 | 判定“长按”的按住时长 |
| `HOLD_MAX_MS` | `20000` | 249 | 长按快进兜底上限（防 touchend 丢失） |
| `SWIPE_MIN` | `36` | 284 | 自算滑动的最小位移（px） |
| `SWIPE_MS` | `800` | 285 | 自算滑动的最长耗时（ms） |

工具函数：

- `readY(e)`（254-266）与 `readX(e)`（269-281）：依次尝试 `e.touches[0]` → `e.changedTouches[0]` → `e`，
  再依次尝试 `clientX/clientY` → `pageX/pageY` → `x/y` → `offsetX/offsetY`。取不到返回 `null`。
- `readDir(e)`（288-294）：依次尝试 `e.direction` → `e.detail.direction` → `e.target.direction`。

### 8.4 `protected` 数据模型（game.ux:301-334，**Vela 专属写法，见 §17.2**）

```js
protected: {
  load: '', auto: '', at: '',        // 路由参数（必须在 protected 里声明才会注入）
  badge: '', chapterTitle: '——', progress: '0%',
  bgSrc: '', showBlack: true, showWhite: false,
  spL: '', spC: '', spR: '',
  cgSrc: '', tint: '', speaker: '',
  l0:''…l5:'',                       // 6 行文字
  s0:''…s5:'',                       // 6 行样式字符串（top/font-size/line-height）
  bgStyle: '', canTap: false, choices: [], menu: false,
  hist: [],                          // 快退栈（不持久化）
  rewindRepeat: null,
  uiHidden: false, endText: '',
  autoOn: false, fastOn: false, holdFast: false,
  swipeY0: null, swipeX0: null, swipeT0: 0,
}
```

> 源码注释（game.ux:297-300）：**Vela 运行时硬性规定 `data` 不能与 `public/protected/private` 共存**，
> 同时写会抛“页面VM对象中的属性data不可与public,protected,private同时存在”，页面 VM 创建失败 → 点按钮无反应。
> 本工程统一只用 `protected`（既能接路由参数，又充当数据模型）。

### 8.5 `onInit()` 状态初始化清单（game.ux:337-403）——**每个字段与初值**

非绑定实例状态（必须逐个在 onInit 里赋值，避免跨页面实例共享）：

```js
this.story = null            // index.txt 解析结果
this.pc = 0                  // 当前节点下标
this.flags = {}              // flag 表
this.chunkStart = -1         // 当前已载入块起始下标
this.chunkNodes = null       // 当前块节点数组
this.chunkCache = {}         // { chunkStart: nodes[] }
this.chunkPending = {}       // { chunkStart: [callbacks] } 并发合并
this.pages = [['']]          // 当前句的分页结果
this.rawText = ''            // 当前句原始文本
this.pageIdx = 0             // 当前页序号
this.pageText = ''           // 当前页文本（行间 \n）
this.typing = 0              // 已显示字数
this.typingToken = 0         // 打字机代次令牌（取消过期回调）
this.typingAt = 0            // 打字开始时刻
this.timer = null            // 打字机 tick 定时器
this.holdTimer = null        // 长按判定定时器
this.holdMax = null          // 长按兜底定时器
this.holdFast = false
this.swipeY0/swipeX0 = null; this.swipeT0 = 0
this.rewindRepeat = null     // 连续快退 interval
this.autoTimer = null        // 自动播放/快进定时器
this.saveTimer = null        // 自动存档去抖定时器
this.bgTimer = null          // 背景平移 interval
this.bgOffset = 0            // 当前 left 偏移（0..336）
this.bgDir = 1               // 平移方向 +1/-1
this.advanceCount = 0        // 推进计数（每 8 次触发自动存档）
this.csRaw = []              // 立绘原始 cs 数组（存档要存它）
this.settings = DEFAULT_SETTINGS
this.lockTap = 0             // 400ms 点击锁时间戳
this.seenIdx = {}            // CG 已见集合（O(1) 查询）
this.seenList = []           // CG 已见下标数组（写入 storage 用）
this.seenTimer = null        // CG 写入去抖
this.cleared = false         // 是否通关真结局
```

随后：

1. `loadCleared(ok => this.cleared = ok)`（375）
2. `loadSeen(list => { this.seenList = list.slice(); 建 seenIdx })`（376-379）
3. `this.log('onInit，参数 at=… load=… auto=…')`（381）
4. `loadSettings(s => { this.settings=s; this.autoOn = s.autoMs>0; this.fastOn = !!s.fast; this.applyFont(); this.applyScreenKeepOn(); log; this.bootstrap() })`（383-391）
5. **看门狗**：`this.watch = setTimeout(() => { if (!this.pageText && !this.endText) { this.badge = '卡在: ' + (this.dbg||'未知阶段') } }, 8000)`（397-402）

### 8.6 生命周期（注意：**源码里有两个 `onHide`**）

| 钩子 | 行号 | 内容 |
|---|---|---|
| `onShow()` | 405-420 | 重新 `loadSettings` 并 `applyFont()/applyScreenKeepOn()`；`if (this.bgSrc) this.startBgPan()`（从别的页返回要重启动画）；`if (this.pageText) { this.typingToken++; this.renderTyping(this.pageText.length) }`（直接显示整页，不等打字机） |
| `onHide()`（第一处） | 421-426 | `clearTimers()`；`setKeepScreenOn(false)`；`flushAutoSave()`；`flushSeen()` |
| `onHide()`（第二处） | 428-431 | `this.onHoldEnd()`；`this.stopRewindRepeat()` |
| `onDestroy()` | 433-445 | `onHoldEnd()`；`stopRewindRepeat()`；`clearTimers()`；`setKeepScreenOn(false)`；`flushAutoSave()`；`flushSeen()`；清 `watch`；清 `chunkCache/chunkPending/chunkNodes/story` |
| `onBackPress()` | 446-451 | `if (this.menu) { this.menu=false; return true }` `this.menu = true; this.clearAuto(); return true`（**永远返回 true，即永远吞掉返回手势**；返回键只用于开关菜单，不会退出页面） |

> **事实（移植时必须显式处理）**：JS 对象字面量中**同名键后者覆盖前者**，所以真正生效的 `onHide` 是第二处（428-431）。
> 也就是说在 Vela 上：`onHide` **不会**清定时器、**不会**关屏幕常亮、**不会**落盘自动存档与 CG 记录。
> 这是源码级缺陷（`onDestroy` 仍然做了这些，所以页面销毁时没问题；但“切后台”路径会漏）。
> 移植时若原样复制 JS 语义会继承该缺陷；正确做法是**合并两处**（先 `onHoldEnd/stopRewindRepeat`，再 `clearTimers/setKeepScreenOn(false)/flushAutoSave/flushSeen`）。

### 8.7 启动链（`bootstrap` → `readIndex` → `afterIndex`）

```
onInit → loadSettings 回调 → bootstrap()                     game.ux:391,467-473
  bootstrap → readIndex()                                    :469
    readIndex: file.readText('/common/story/index.txt')      :477-499
      success: JSON.parse(data.text)
        - 缺 chunks 或 chapters → badge='剧本索引损坏'，中止   :482-486
        - ok → this.story=idx; this.flags={}; log; afterIndex()  :487-490
      fail(d, code) → badge='读不到剧本索引 (code N)'          :495-498
afterIndex()                                                 :502-529
  at !== ''      → goto(parseInt(at)||0)   （章节跳转，最高优先级）  :507-512
  否则 loadAutoSave(autoData => …)                            :514
    load !== ''   → restoreFromSlot(parseInt(load))           :516-517
    auto === '1' && autoData.magic===SAVE_MAGIC → applySave(autoData)  :518-520
    否则          → goto(0)                                    :522-523
```

`readIndex` 只做一次；`story` 只保存索引（`chapters` + `chunks`），不带节点数据。

### 8.8 读档 / 存档数据应用

`restoreFromSlot(slot)`（531-554）：`storage.get({key:'saves'})` → `JSON.parse` → `list[slot]`；
不存在或 `magic` 不匹配 → `badge='存档不存在'` 并 `goto(0)`；解析异常 → `fail('读档')` + `goto(0)`。

`applySave(data)`（556-566）——**读档的唯一入口**：

```js
this.flags   = data.flags || {}
this.bgSrc   = data.bgSrc || ''
this.showBlack = !!data.showBlack
this.showWhite = !!data.showWhite
this.csRaw   = data.cs || []
this.renderSprites(this.csRaw)
this.cgSrc   = data.cgSrc || ''
this.tint    = data.tint || ''
this.goto(data.pc || 0)
```

> 注意顺序：**先恢复舞台视觉，再 `goto(pc)`**。`goto` 会从该节点重新执行 `step()`，
> 所以该节点自带的 bg/cs/cg 又会覆盖一次（幂等）。
> `hist`（快退栈）**不恢复**，读档后不能退到读档点之前。

`collectSave()`（568-583）见 §2.4；`previewText()`（585-588）取 `pageText` 或 `l0` 的第一行，>24 字截断加 `…`；
`chapterIndex()`（590-596）遍历 `chapters` 找最后一个 `start <= pc` 的索引（线性扫描，18 项无所谓）；
`updateHud()`（598-609）：`chapterTitle = ch.title`；`progress = min(99, round((pc-start)*100/max(1,nextStart-start))) + '%'`
（**进度上限 99%**，末章用 `nodeCount` 当结束边界）。

### 8.9 分块调度（`chunkOf` / `inChunk` / `readChunk` / `trimCache` / `prefetch` / `goto`）

| 方法 | 行号 | 行为 |
|---|---|---|
| `chunkOf(index)` | 612-619 | 线性查 `story.chunks`，返回 `index ∈ [start, start+count)` 的块；找不到返回 `null` |
| `inChunk(index)` | 621-624 | `chunkNodes && chunkStart>=0 && index ∈ [chunkStart, chunkStart+len)` |
| `readChunk(chunk, done)` | 626-669 | ① `chunkCache[start]` 命中 → `done(cached)`（零 IO）；② `chunkPending[start]` 存在 → push 回调（**并发合并**）；③ 否则 `file.readText({uri: chunk.file})`；`success` 内 `JSON.parse`，**长度必须 == chunk.count**，否则 `badge='分块长度不符 '+file` + `finish(null,true)`；`fail` → `badge='读不到分块 … (code N)'` + `finish(null,true)`；`finish` 写入缓存并按序回调所有等待者 |
| `trimCache(index)` | 671-680 | 只保留“当前块 + 下一块”的 `chunkCache`，其余 `delete` |
| `prefetch(index)` | 682-690 | 若存在下一块且未缓存 → `readChunk(next, ()=>{})`（后台预读） |
| `goto(index)` | 692-714 | 越界（`<0` 或 `>=nodeCount`）→ `badge='节点越界 N'` + `finishAll()`；`pc=index`；`inChunk` → 直接 `step()`；否则 `chunkOf` → `readChunk` → 设 `chunkNodes/chunkStart` → `step()` |

> 自愈代码（game.ux:629-630）：`if (!this.chunkCache) this.chunkCache = {}` / 同 `chunkPending`。
> 原因见 §17.5（Vela 顶层字面量状态可能不挂到实例上）。

### 8.10 `step()` 主循环（game.ux:717-764）——**精确到每一行**

```js
step() {
  if (!this.story) return
  let guard = 0
  while (guard++ < 3000) {                                   // 死循环保护上限 3000
    if (this.pc >= this.story.nodeCount) { this.finishAll(); return }
    if (!this.inChunk(this.pc)) { this.prefetch(this.pc); this.goto(this.pc); return }  // 换块：异步重入
    const node = this.chunkNodes[this.pc - this.chunkStart]
    if (!node) { this.badge = '节点为空 ' + this.pc; return }

    if (node.bg !== undefined) {                              // ① 换景
      this.applyBg(node.bg)
      if (node.cs === undefined) { this.csRaw = []; this.renderSprites([]) }   // 隐式清立绘
    }
    if (node.cs !== undefined) { this.csRaw = node.cs; this.renderSprites(node.cs) }  // ② 立绘
    if (node.cg !== undefined) {                              // ③ CG
      this.cgSrc = node.cg >= 0 ? (IMG[node.cg] || '') : ''
      if (node.cg >= 0) this.markSeen(node.cg)                // 解锁记录
    }
    if (node.tint !== undefined) this.tint = node.tint        // ④ 滤镜

    if (node.t === 's') { this.updateHud(); this.prefetch(this.pc); this.trimCache(this.pc); this.playSay(node); return }
    if (node.t === 'o') { this.updateHud(); this.prefetch(this.pc); this.trimCache(this.pc); this.playChoice(node); return }
    if (node.t === 'e') { this.updateHud(); this.playEnd(node); return }

    if (node.t === 'f')       { this.flags[node.v] = (this.flags[node.v] || 0) + node.n; this.pc++ }
    else if (node.t === 'sf') { this.flags[node.v] = node.n; this.pc++ }
    else if (node.t === 'j')  { this.pc = node.j }
    else if (node.t === 'cj') { this.pc = this.testCond(node) ? node.j : this.pc + 1 }
    else this.pc++
  }
  this.badge = '节点执行超过上限，疑似死循环'
}
```

要点（移植时必须一致）：

1. **视觉字段在“任何类型”的节点上都会先被应用**（`s/o/j/cj/f/sf/e` 都可能有 bg/cs/cg/tint；实测只有 `s` 与 1 个 `e` 带）。
2. `s`/`o`/`e` 是**终止型**节点（处理后 `return`，等用户输入/等选择/等点击返回标题）。
3. `f/sf/j` **不 updateHud、不 prefetch、不 trimCache**——它们在同一块里连续执行。
4. `prefetch`/`trimCache` 只在 `s`/`o` 上做；`e` 只 `updateHud`。
5. 每轮 `guard++`，超过 3000 次 → `badge='节点执行超过上限，疑似死循环'`（不退化成崩溃）。
6. 换块时**不是循环内等待**，而是 `goto()` 异步回调后**重新进入 step()** → 有递归重入风险，但 `goto` 只在换块时发生。

### 8.11 状态应用实现

`applyBg(idx)`（776-782）：

```js
this.bgSrc = idx >= 0 ? (IMG[idx] || '') : ''
this.showBlack = idx === -1
this.showWhite = idx === -2
this.startBgPan()        // 换背景时从最左边重新扫
```

`renderSprites(cs)`（784-794）：三槽清空后按 `s` 分配（`left→spL`，`right→spR`，**其余→spC**）。

`markSeen(i)`（797-804）：已在 `seenIdx` 则返回；否则入集合/数组，并 **500ms 去抖** `setTimeout(flushSeen, 500)`。
`flushSeen()`（806-809）：清定时器；**仅当 `seenList.length` 非空才写**（`saveSeen`）。
> 即 CG 解锁是“播放到 CG 节点即解锁”，不是“看完/退出才解锁”。

### 8.12 排版 / 分页 / 打字机

`layout()`（814-820）：

```js
const size  = (this.settings && this.settings.size) || 20
const lineH = size + 4
const cpl   = Math.max(4, Math.floor((TEXT_BOX_W - TEXT_PAD) / size))   // = floor(310/size)
const lpp   = Math.max(1, Math.min(MAX_LINES, Math.floor(TEXT_BOX_H / lineH)))  // = min(6, floor(122/(size+4)))
return { size, lineH, cpl, lpp }
```

实算表（字号 → 每行字数 / 每页行数 / 行高）：

| size | cpl = floor(310/size) | lineH | lpp = min(6, floor(122/(size+4))) |
|---|---|---|---|
| 14 | 22 | 18 | 6 |
| 15 | 20 | 19 | 6 |
| 16 | 19 | 20 | 6 |
| 18 | 17 | 22 | 5 |
| 20（默认） | 15 | 24 | 5 |
| 22 | 14 | 26 | 4 |
| 24 | 12 | 28 | 4 |
| 26 | 11 | 30 | 4 |
| 28 | 11 | 32 | 3 |
| 30 | 10 | 34 | 3 |

`applyLayout()`（822-831）：把 6 行样式算好写入 `s0..s5`。
`lineStyle(i, L)`（833-836）：`'top: ' + (TEXT_TOP + i*L.lineH) + 'px; font-size: ' + L.size + 'px; line-height: ' + L.lineH + 'px;'`。
`applyFont()`（838-841）= `applyLayout() + reflow()`。
`reflow()`（844-851）：按新字号重排 `rawText`，**回到该句第 1 页**，并把打字机代次 `typingToken++` 后整页显示。
`paginate(text)`（855-858）：`paginateText(text, L.cpl, L.lpp)`（§3.3 的纯函数）。

打字机：

`playSay(node)`（861-881）：

1. 清看门狗（`clearTimeout(this.watch)`）
2. `badge=''`；`choices=[]`；`endText=''`
3. `speaker = node.n || ''`；`rawText = node.x || ''`
4. **快退快照**（868-877）：若 `hist` 栈顶的 `pc` ≠ 当前 `pc`，`hist.push(collectSave())`，栈上限 60（超出 `shift`）；整段 `try/catch` 包住（记录失败不影响阅读）
5. `pages = paginate(rawText)`；`pageIdx = 0`；`playPage()`

`playPage()`（883-894）：

```js
this.clearAuto()
this.pageText = (this.pages[this.pageIdx] || ['']).join('\n')
this.typing = 0
this.renderTyping(0)
const speed = this.settings.fast ? 0 : this.settings.speed
if (!speed) { this.finishTyping(); return }      // speed=0 或 fast → 立即整页
this.typingToken++
this.typingAt = Date.now()
this.tickTyping(this.typingToken)
```

`tickTyping(token)`（896-907）——**50ms 时间校正循环**（不是每字一个定时器）：

```js
if (token !== this.typingToken) return            // 过期代次直接退出
const speed = this.settings.fast ? 0 : this.settings.speed
if (!speed) { this.finishTyping(); return }
const full = this.pageText.length
const elapsed = Math.max(0, Date.now() - this.typingAt)
const n = Math.max(this.typing + 1, Math.floor(elapsed / speed) + 1)   // 至少 +1，且按真实耗时追赶
if (n >= full) { this.typing = full; this.renderTyping(full); this.finishTyping(); return }
this.typing = n
this.renderTyping(n)
this.timer = setTimeout(() => this.tickTyping(token), 50)
```

`renderTyping(n)`（909-920）：`pageText.slice(0,n)` 按 `\n` 拆成 `l0..l5`（不足补 `''`）；`canTap = n >= full.length`。
`finishTyping()`（922-928）：`typingToken++`；清 `timer`；`typing = pageText.length`；`renderTyping(typing)`；`scheduleAuto()`。

> 关键语义：`canTap` 只有在**整页显示完**才为 true（`.more ▼` 也靠它）。
> `speed=0`（设置里“瞬间”）与 `fast=true` 走同一条“立即显示”路径。

### 8.13 自动播放 / 快进（互斥）

`scheduleAuto()`（930-942）：

```js
this.clearAuto()
if (this.choices.length || this.endText) return            // 选项/结局不自动推进
if (this.settings.fast) {                                   // 快进：220ms 连播
  this.autoTimer = setTimeout(() => { this.autoTimer=null; this.advance() }, 220)
  return
}
if (!this.settings.autoMs) return                           // 0 = 关闭
const wait = autoDelay(this.pageText, this.settings.autoMs) // 700 + 非空白字数*autoMs, 夹 1200..12000
this.autoTimer = setTimeout(() => { this.autoTimer=null; this.advance() }, wait)
```

`clearAuto()`（944）：清 `autoTimer`。
`clearTimers()`（945-951）：清 `timer`、`saveTimer`、`clearAuto()`、`stopBgPan()`、`typingToken++`。

> 自动/快进**调 `advance()` 而不是 `onTap()`**（源码注释 1014-1017）：因为 `toggleFast()/closeMenu()` 会先 `lock()` 打 400ms 锁，
> 而快进定时器只有 220ms，若走 `onTap()` 会被锁吞掉且不再重排，链条断掉（真机表现“开了快进还要再点一下”）。

### 8.14 全景背景平移

`setKeepScreenOn(on)`（957-963）：`try { brightness.setKeepScreenOn({keepScreenOn: !!on}) } catch`（失败只记日志）。
`applyScreenKeepOn()`（965-968）：按 `settings.keepOn` 设置。

`startBgPan()`（973-980）：

```js
this.stopBgPan()
if (!this.bgSrc) { this.bgStyle = ''; return }
this.bgOffset = 0; this.bgDir = 1; this.bgStyle = 'left: 0px;'
this.bgTimer = setInterval(() => this.bgPanTick(), BG_TICK_MS)   // 100ms
```

`bgPanTick()`（982-989）：

```js
if (!this.bgSrc) return
let off = this.bgOffset + this.bgDir * BG_STEP_PX      // ±4px
if (off >= BG_PAN_RANGE) { off = BG_PAN_RANGE; this.bgDir = -1 }   // 336 → 反向
else if (off <= 0) { off = 0; this.bgDir = 1 }
this.bgOffset = off
this.bgStyle = 'left: -' + off + 'px;'                 // 0 → -336
```

`stopBgPan()`（991）：`clearInterval(bgTimer)`。

> 行为：从左到右匀速 40px/s，走到 `-336` 后反向，来回扫；换背景时重置到 0。
> **完全不用 CSS transition**（真机 transition 会出竖向接缝，README 第 426-437 行有 4 种方案的实测对比）。

### 8.15 交互：点击 / 推进 / 长按 / 滑动 / 锁

`onTap()`（995-1012）：

```js
this.onHoldEnd()                                       // 兜底：只来 click 没来 touchend 时收快进
if (this.lockTap && Date.now() - this.lockTap < 400) return   // 400ms 防抖锁（必须在“停快退”之前）
if (this.rewindRepeat) {                               // 正在连续快退：点一下停
  this.stopRewindRepeat(); this.lockTap = Date.now()
  prompt.showToast({ message: '已停止快退' }); return
}
this.advance()
```

`advance()`（1018-1027）——**不带锁的真正推进**：

```js
if (this.endText) { router.replace({ uri: 'pages/index' }); return }   // 结局页：轻触回标题
if (this.menu || this.choices.length) return                            // 菜单/选项时不推进
this.clearAuto()
if (!this.canTap) { this.finishTyping(); return }                       // 没打完 → 立即完成
if (this.pageIdx < this.pages.length - 1) { this.pageIdx++; this.playPage(); return }  // 下一页
this.pc++; this.bumpAutoSave(); this.step()                             // 下一句
```

`lock()`（1029）：`this.lockTap = Date.now()`（400ms 锁的唯一产生点）。

`toggleImmersive()`（1031-1045，根节点 `onlongpress`）：

```js
if (this.menu || this.endText) return
const mode = this.longpressMode()      // 'hide' | 'fast' | 'off'
if (mode === 'off') return
if (mode === 'fast') return            // 由 onHoldStart/onHoldEnd 处理，这里不能再切一次
this.lock(); this.uiHidden = !this.uiHidden; this.clearAuto()
```

`onHoldStart(e)`（1050-1069）——按下时启动计时：

```js
this.swipeY0 = readY(e); this.swipeX0 = readX(e); this.swipeT0 = Date.now()   // 顺手记录滑动起点
if (this.menu || this.endText || this.choices.length) return
if (this.longpressMode() !== 'fast') return
this.holdTimer = setTimeout(() => {
  this.holdTimer = null; this.holdFast = true; this.lock(); this.setFast(true)
  this.holdMax = setTimeout(() => { this.holdMax = null; if (this.holdFast) this.onHoldEnd() }, HOLD_MAX_MS)
}, HOLD_MS)
```

`onHoldEnd(e)`（1071-1079）：清 `holdTimer/holdMax`；`checkSwipeDown(e)`；若 `holdFast` 则 `setFast(false)`。

`setFast(on)`（1082-1091）：**只改内存不写盘**；`on` 时 `s.autoMs = 0`（与自动播放互斥）；更新 `settings/fastOn/autoOn`；`on ? scheduleAuto() : clearAuto()`。

`checkSwipeDown(e)`（1096-1125）——**自己算手势**（比 onswipe 灵敏：

```js
const y0 = this.swipeY0, x0 = this.swipeX0, t0 = this.swipeT0
this.swipeY0 = null; this.swipeX0 = null; this.swipeT0 = 0
if (!t0) return
if (Date.now() - t0 > SWIPE_MS) return        // 超过 800ms 不算滑动
if (this.menu || this.endText) return
const dy = y1 - y0, dx = x1 - x0              // 任一为 null 则按 0
if (dy >= SWIPE_MIN && dy >= Math.abs(dx)) {  // 竖向优先（斜滑按下滑处理）
  this.lockTap = Date.now(); this.openMenu(); return          // 下滑 → 开菜单
}
if (dx >= SWIPE_MIN && dx > Math.abs(dy)) {   // 向右（x 变大）→ 快退一句
  this.lockTap = Date.now(); this.rewindOnce()
}
```

`longpressMode()`（1128-1133）：读 `settings.longpress`，兼容老布尔值：`true→'hide'`、`false→'off'`、其余只认 `'fast'/'off'`，其它→`'hide'`（注意与 `normalizeSettings` 的默认 `'off'` 不同，这里是防御式默认 `'hide'`）。

`blockSwipe(e)`（1138-1142）——所有元素共用：

```js
if (this.menu || this.endText) return
if (readDir(e) !== 'down') return
this.openMenu()
```

### 8.16 快退（`rewind` 系列）

快退复用存档快照（`collectSave`/`applySave`），所以背景/立绘/CG/flags 一起回退，退到分支前可重选。

| 方法 | 行号 | 行为 |
|---|---|---|
| `rewind()` | 1150-1165 | 菜单“快退”按钮：`lock()`；`menu=false`；`clearAuto()`；`stopRewindRepeat()`；`rewindStep()` 失败 → toast `'已经是最早的一句了'`；否则每 **180ms** 连续退，退不动时停 + toast `'已经退到最早的一句了'` |
| `rewindStep()` | 1168-1176 | `hist.length < 2` → false；`h.pop()`（丢当前）、`prev=h.pop()`、`h.push(prev)`（成为新栈顶）、`applySave(prev)` |
| `rewindOnce()` | 1180-1184 | 正文页右滑用：`lock()`；若在连续退先停；`rewindStep()` 失败 → toast |
| `stopRewindRepeat()` | 1186-1191 | `clearInterval(rewindRepeat)` |

> 快退栈上限 60（playSay 里 `shift`），只在“一口气读”时有意义；不进存档。

### 8.17 菜单与页面跳转

| 方法 | 行号 | 行为 |
|---|---|---|
| `openMenu()` | 1193 | `lock(); menu=true; clearAuto()` |
| `closeMenu()` | 1194 | `lock(); menu=false; scheduleAuto()`（恢复自动播放） |
| `toggleAuto()` | 1196-1208 | `lock()`；`autoMs = autoMs>0 ? 0 : AUTO_DEFAULT(90)`；打开时 `fast=false`（互斥）；更新 `autoOn/fastOn`；**`saveSettings(s)` 落盘**；`menu=false`；`scheduleAuto()` |
| `toggleFast()` | 1210-1221 | `lock()`；`fast=!fast`；打开时 `autoMs=0`；`saveSettings(s)`（`saveSettings` 内部会删掉 `fast`，所以**快进不会被持久化**）；`menu=false`；`scheduleAuto()` |
| `nextChapter()` | 1223-1234 | `lock(); menu=false`；从 `chapterIndex()+1` 起跳过 `hide`／未解锁的 `need`；无下一章 → toast `'已经是最后一章'` + `scheduleAuto()`；否则 `goto(nx.start)` |
| `goSave()` | 1236-1245 | `lock(); menu=false`；`storage.set({key:'pendingSave', value:JSON.stringify(collectSave()), success:()=>router.push({uri:'pages/saves',params:{mode:'save'}}), fail:()=>badge='无法准备存档'})` |
| `goLoad()` | 1246 | `lock(); menu=false; flushSeen(); router.push({uri:'pages/saves',params:{mode:'load'}})` |
| `goChapters()` | 1247 | 同上 → `pages/chapters` |
| `goCg()` | 1248 | 同上 → `pages/cg` |
| `goSettings()` | 1249 | `lock(); menu=false; router.push({uri:'pages/settings'})`（**不 flushSeen**） |
| `goHome()` | 1250 | `lock(); flushAutoSave(); flushSeen(); router.replace({uri:'pages/index'})` |
| `quit()` | 1251 | `lock(); flushAutoSave(); flushSeen(); this.$app.exit()` |

菜单项与文案（模板 75-96）：

```
阅读菜单
{chapterTitle} · {progress}
[继续阅读]  (closeMenu)
[保存进度]  (goSave)
[读取存档]  (goLoad)
[自动播放：开/关]  (toggleAuto)
[快进：开/关]      (toggleFast)
[下一章] [快退]
[章节]   [CG]
[设置]   [主页]
[退出]   (quit)
```

### 8.18 结局 / 分支

`playEnd(node)`（1254-1266）：

```js
this.clearTimers()
if (this.watch) { clearTimeout(this.watch); this.watch = null }
this.badge = ''; this.choices = []
this.endText = node.x || '剧终'
if (this.flags && this.flags.true_end_finish === 1) { this.cleared = true; markCleared() }  // 通关标记
saveAutoSave(this.collectSave())    // 结局即写自动存档
```

`finishAll()`（1268）：`playEnd({x:'—— 全剧终 ——'})`（越界/正常走完都走这里）。
结局页的“轻触回标题”：由 `advance()` 首行处理（`endText` 非空 → `router.replace('pages/index')`）。

`playChoice(node)`（1270-1287）：

```js
this.clearAuto()
clearTimeout(watch)
this.badge = ''
this.l0..l5 = ''            // 清空正文（避免选完还残留上一句）
this.speaker = ''
this.pageText = ''; this.rawText = ''; this.canTap = false
const out = []
for (const o of node.o || []) {
  if (o.c && !this.testCond({ v:o.c[0], op:o.c[1], n:o.c[2] })) continue   // 条件过滤
  out.push({ x: o.x, j: o.j })                                            // 只保留 x/j（丢掉 c）
}
this.choices = out
```

`pickChoice(idx)`（1289-1297）：`lock()`；`c=choices[idx]`（不存在 return）；`choices=[]`；`pc=c.j`；`bumpAutoSave()`；`step()`。

> 选项渲染：`.choices{top:96,left:16,width:304}` 纵向排列，`.choice` 每项 `min-height:52` +
> `margin-bottom:8` + `padding:10`；**5 项时总高 5*52+4*8 = 292**，从 96 起 → 到 388，仍在屏内。

### 8.19 自动存档

`bumpAutoSave()`（1300-1306）：

```js
this.advanceCount++
if (this.advanceCount < 8) return          // 每 8 次推进才触发
this.advanceCount = 0
if (this.saveTimer) clearTimeout(this.saveTimer)
this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flushAutoSave() }, 400)   // 400ms 去抖
```

`flushAutoSave()`（1308-1313）：清定时器；`if (!this.story || !this.pc) return`（**pc=0 不存**）；`advanceCount=0`；`saveAutoSave(collectSave())`。

调用点：`advance()` 翻句时（1025）、`pickChoice()` 选择后（1295）、`playEnd()` 结局时（1265）、
`onDestroy()`（438）、`goHome()`（1250）、`quit()`（1251）。
**注意**：真正生效的 `onHide`（第二处，L428-431）**没有**调用 `flushAutoSave()`，第一处 onHide（L424）的调用是死代码（见 §8.6）。

### 8.20 定时器 / 锁 / 去抖总表（移植时必须逐个重建）

| 定时器 | 类型 | 周期 | 建立点 | 清除点 |
|---|---|---|---|---|
| 打字机 `timer` | `setTimeout` 自递归 | 50ms | `tickTyping`（906） | `finishTyping`(924)、`clearTimers`(946)、`onDestroy` |
| 自动/快进 `autoTimer` | `setTimeout` | 快进 220ms；自动 `autoDelay()` | `scheduleAuto`（936/941） | `clearAuto`(944)、`clearTimers` |
| 自动存档 `saveTimer` | `setTimeout` | 400ms 去抖 | `bumpAutoSave`（1305） | `flushAutoSave`(1309)、`clearTimers` |
| CG 写入 `seenTimer` | `setTimeout` | 500ms 去抖 | `markSeen`（803） | `flushSeen`(807)、`onDestroy` |
| 背景平移 `bgTimer` | **`setInterval`** | 100ms | `startBgPan`（979） | `stopBgPan`(991)、`clearTimers` |
| 长按判定 `holdTimer` | `setTimeout` | 450ms | `onHoldStart`（1058） | `onHoldEnd`(1073)、`clearTimers` 不负责 |
| 长按兜底 `holdMax` | `setTimeout` | 20000ms | `onHoldStart`（1064） | `onHoldEnd`(1074) |
| 连退 `rewindRepeat` | **`setInterval`** | 180ms | `rewind`（1159） | `stopRewindRepeat`(1188)、`rewindOnce` |
| 看门狗 `watch` | `setTimeout` | 8000ms | `onInit`（397） | `playSay`(862)/`playChoice`(1272)/`playEnd`(1256)/`onDestroy` |

防抖/锁：

| 机制 | 值 | 位置 | 目的 |
|---|---|---|---|
| 点击锁 `lockTap` | **400ms** | `onTap`(1003)、`lock()`(1029) | 防一次触摸被识别成两下（按钮点击冒泡到根节点） |
| 快退连发间隔 | 180ms | `rewind`(1164) | 连续快退节奏 |
| 自动存档节流 | 每 8 次推进 + 400ms | `bumpAutoSave` | 减少写盘 |
| CG 写入去抖 | 500ms | `markSeen` | 减少写盘 |
| 设置页保存去抖 | 300ms | `settings.ux:189-192` | 滑滑块时不狂写 |

### 8.21 错误/状态文案表（`badge` 与 toast，全部）

`badge`（屏上小色块）：

| 文案 | 触发点 |
|---|---|
| `剧本索引损坏` | index 缺字段（486） |
| `读不到剧本索引 (code N)` | file.readText fail（496） |
| `分块长度不符 <file>` | 块长度 ≠ count（652） |
| `读不到分块 <file> (code N)` | 分块读取失败（664） |
| `节点越界 N` | goto 越界（695） |
| `找不到节点 N 所属分块` | chunkOf 返回 null（703） |
| `节点为空 N` | chunkNodes 里取不到（725） |
| `节点执行超过上限，疑似死循环` | step guard（760） |
| `卡在: <阶段>` | 看门狗 8s（399） |
| `无法准备存档` | pendingSave 写失败（1243） |
| `存档不存在` | 读档 magic 不符（542） |
| `剧本未载入` | goto 时 story 为空（694） |
| `onInit 出错` / `bootstrap 出错` / `解析索引 出错: …` / `读档 出错: …` 等 | `fail(where, e)`（460-464）统一拼 `${where} 出错: ${e.message}` |

`prompt.showToast`：

| 文案 | 位置 |
|---|---|
| `已停止快退` | onTap（1008） |
| `已经是最早的一句了` | rewind/rewindOnce（1156/1183） |
| `已经退到最早的一句了` | rewind 连退到极限（1162） |
| `已经是最后一章` | nextChapter（1232） |

---

## 9. `src/pages/saves/saves.ux`（178 行，存档/读档）

### 9.1 结构

- 标题：`{{mode === 'save' ? '保存进度' : '读取进度'}}`；副标题：`{{mode==='save' ? '点按覆盖 · 长按删除' : '点按读取 · 长按删除'}}`
- `<list class="lst" bounces="true">` + `<list-item class="item" for="{{rows}}" tid="rid" onclick="pick($idx)" onlongpress="askDelete($idx)">`
- 行内容：`.card > .card-l(.card-name 名称 / .card-info 描述) + .card-tag 标签`
- 底部 `.back` 返回
- 删除确认：`.scrim`（`if="{{confirmIdx >= 0}}"`）> `.dialog`（“删除存档？”/“此操作无法撤销”/取消·删除）

### 9.2 几何

| 选择器 | 属性 |
|---|---|
| `.page` | `336×480; #14101a; position:relative` |
| `.title` | `absolute; top:12; width:336; center; font-size:24; #ffd8e6; bold` |
| `.sub` | `absolute; top:44; font-size:14; #9c8f9b` |
| `.lst` | `absolute; top:68; 336×358` |
| `.item` | `336×86`（一屏 4 条） |
| `.card` | `312×74; margin-left:12; margin-top:6; border-radius:16; #241c2c; flex-row; center; padding:0 16` |
| `.card-l` | `flex-column; width:232` |
| `.card-name` | `font-size:21; #ffe6ef; lines:1` |
| `.card-info` | `font-size:14; #9c8f9b; margin-top:3; lines:1` |
| `.card-tag` | `font-size:15; #cf9ec0; width:44; text-align:right` |
| `.back` | `absolute; top:432; left:50; 236×40; radius:20; #32243a` |
| `.scrim` | `absolute; 0,0; 336×480; rgba(0,0,0,0.72); center/center` |
| `.dialog` | `250×170; radius:18; #241c2c; flex-column; center; padding-top:20` |
| `.dg-title` | `21; #ffe6ef; bold` |
| `.dg-sub` | `14; #9c8f9b; margin:6 0 18` |
| `.dg-row` | `width:210; flex-row; space-between` |
| `.dg-btn` | `98×40; radius:20; #32243a` |
| `.dg-danger` | `background-color:#a8355a` |
| `.dg-t` | `18; #fff` |

### 9.3 数据与行为

`protected: { mode:'load', rows:[], confirmIdx:-1 }`（81-85）；实例态：`slots=[]`、`auto=null`、`pending=null`、`suppress=false`（88-92）。

`onInit()`（88-107）：`loadSaves` → `slots`；`loadAutoSave` → `auto`；再读 `pendingSave`（成功后**立即 `storage.delete({key:'pendingSave'})`**）→ `render()`。

`render()`（109-124）：固定 7 行 —— 第 0 行“自动存档”（`tag`：save 模式 `'自动'`、load 模式 `'读取'`），第 1..6 行“存档 1..6”（save 模式 tag `'覆盖'`；load 模式 `s ? '读取' : '空'`）。
`describe(s)`（126-129）：`'第' + ((s.chapter||0)+1) + '章 · ' + text(≤12 字 + …)`；空存档显示 `（空）`。

`pick(idx)`（133-156）：

```js
if (this.suppress) { this.suppress = false; return }     // 长按删除后紧跟的 click 要吞掉
if (idx === 0) {                                          // 自动存档行
  if (mode !== 'load') { toast('自动存档不可覆盖'); return }
  if (!auto || auto.magic !== SAVE_MAGIC) { toast('暂无自动存档'); return }
  router.replace({uri:'pages/game', params:{auto:'1'}}); return
}
const slot = idx - 1
if (mode === 'save') {
  if (!pending) { toast('没有可保存的进度'); return }
  list[slot] = pending; slots = list
  saveSaves(list, ok => { toast(ok ? '已保存到存档 '+(slot+1) : '保存失败'); render() })
  return
}
const s = slots[slot]
if (!s || s.magic !== SAVE_MAGIC) { toast('该存档为空'); return }
router.replace({uri:'pages/game', params:{load:String(slot)}})
```

`askDelete(idx)`（158-162）：自动存档行 → toast `'自动存档不可删除'`；否则 `suppress=true; confirmIdx=idx`。
`cancelDelete()`（164）：`confirmIdx=-1`。`doDelete()`（166-174）：`list[idx-1]=null`；`saveSaves` → `render()`。
`back()`（176）：`router.back()`。

> `suppress` 机制：Vela 上 `longpress` 之后还会派发一次 `click`，不吞掉会误触发读档/覆盖。

---

## 10. `src/pages/chapters/chapters.ux`（131 行，章节选择）

### 10.1 结构

标题“章节选择”；副标题 `共 {{count}} 章 · 上下滑动 · 点按开始`；
`<list id="chap-list" class="lst" bounces="true">` + `<list-item for="{{rows}}" tid="cid" onclick="pick($idx)">` > `.card > .no / .nm / .mk`；
底部 `.back` 返回。

### 10.2 几何

| 选择器 | 属性 |
|---|---|
| `.page` | `336×480; #14101a` |
| `.title` | `top:12; 24px; #ffd8e6; bold; center` |
| `.sub` | `top:44; 14px; #9c8f9b; center` |
| `.lst` | `top:68; 336×358` |
| `.item` | `336×86` |
| `.card` | `312×74; ml:12; mt:6; radius:16; #241c2c; flex-row; center; padding:0 14` |
| `.no` | `17px; #cf9ec0; width:38` |
| `.nm` | `24px; #ffe6ef; width:226; lines:1` |
| `.mk` | `16px; #7ee8e0; width:18` |
| `.back` | `top:432; left:50; 236×40; radius:20; #32243a` |

### 10.3 行为

`onInit()`（59-73）：`starts=[]; curChap=-1; cleared=false`；`loadAutoSave` 取 `d.chapter`（数字且 ≥0）→ `curChap`；再 `loadCleared` → `cleared` → `loadIndex()`。

`loadIndex()`（75-108）：

```js
file.readText({ uri:'/common/story/index.txt', success: data => {
  idx = JSON.parse(data.text)
  if (!idx || !idx.chapters) { rows = [{no:'!',name:'剧本索引损坏',mark:''}]; return }
  for (i…) {
    if (c.hide) continue                       // 结局章不显示
    if (c.need && !this.cleared) continue      // 后日谈未通关不显示
    rows.push({ no: String(rows.length+1), name: c.title, mark: i === this.curChap ? '▶' : '' })
    this.starts.push(c.start)
  }
  this.rows = rows; this.count = rows.length
  if (this.curChap > 0) this.scrollToCurrent()
}, fail: () => rows = [{no:'!',name:'读取剧本索引失败',mark:''}] })
```

`scrollToCurrent()`（110-119）：

```js
this.$nextTick(() => {
  const el = this.$element('chap-list')
  if (el && typeof el.scrollTo === 'function') el.scrollTo({ index: this.curChap, behavior: 'instant' })
})
```

`pick(i)`（123-127）：`at = this.starts[i]`；`router.replace({uri:'pages/game', params:{at:String(at)}})`。
`back()`（129）：`router.back()`。

> **已知不一致（原样记录）**：`rows` 是**过滤后**的显示列表（不含 hide/need），
> 但 `mark` 判断与 `scrollTo` 用的 `curChap` 是**全量 chapters 数组下标**。
> 仅在“存在被过滤章节且其下标小于当前章”时才会错位；由于三个结局章都在末尾，正片阶段两者一致，
> 通关后多出后日谈（末尾），也不影响正片下标。所以实际未暴露 bug，但移植时不要“顺手修成显示下标”而改变行为。
> 空 `mark` 用空字符串占位（而非 `if`），是为了让每个 `list-item` 结构一致（注释 94，官方不建议在 `list-item` 里写 `if`）。

---

## 11. `src/pages/cg/cg.ux`（333 行，CG 鉴赏）

### 11.1 结构与两层 UI

第一层（列表）：

```html
<text class="title">CG 鉴赏</text>
<text class="sub">已解锁 {{openCount}} / {{total}} 组 · 点按查看</text>
<list class="lst" bounces="true">
  <list-item for="{{rows}}" tid="gid" onclick="open($idx)">
    <div class="card">
      <image class="thumb" src="{{$item.th}}" if="{{$item.ok}}"/>   <!-- 96×54 -->
      <div class="lock" if="{{!$item.ok}}"><text class="lock-t">?</text></div>
      <text class="nm">{{$item.n}}</text>
      <text class="st">{{$item.st}}</text>
    </div>
  </list-item>
</list>
<div class="back">返回</div>
```

第二层（查看器，`if="{{viewing}}"`）：

```html
<div class="viewer">
  <image class="big" style="{{cgStyle}}" src="{{bigSrc}}"
         ontouchstart="onCgTouchStart" ontouchmove="onCgTouchMove"
         ontouchend="onCgTouchEnd" ontouchcancel="onCgTouchEnd"
         onswipe="onPanSwipe"/>              <!-- 主拖动 + 兜底手势 -->
  <div class="tapzone zl" if="{{canLeft}}" onclick="panPrev"/>   <!-- 左热区 48×336 -->
  <div class="tapzone zr" if="{{canRight}}" onclick="panNext"/>  <!-- 右热区 left:288 -->
  <div class="vtop"><text class="vname">{{vName}}</text><text class="vnum">{{pageNo}} / {{pageAll}}</text></div>
  <div class="vclose" onclick="closeView">关闭</div>             <!-- 262..326, top:10, 64×34 -->
  <div class="hintplate"></div>                                  <!-- top:384 308×38 rgba(0,0,0,0.5) -->
  <text class="vhint2">按住画面左右拖动，看被裁掉的部分</text>     <!-- top:390 -->
  <div class="track"><div class="thumb2" style="{{indStyle}}"/></div>  <!-- top:412 240×5；滑块 94×5 -->
  <div class="vbar" if="{{pageAll > 1}}">                        <!-- top:428 292×42 -->
    <div class="vbtn" onclick="prev">‹</div><text class="vhint">换一张差分</text><div class="vbtn" onclick="next">›</div>
  </div>
</div>
```

> 根节点 `<div class="page">` **故意不挂 onswipe**（cg.ux:2-3 注释）：挂上会把滑动手势整个吃掉。

### 11.2 几何

| 选择器 | 属性 |
|---|---|
| `.page` | `336×480; #14101a; position:relative` |
| `.title` / `.sub` | `top:12`/`top:44`，24px/14px，同其它页 |
| `.lst` | `top:68; 336×358` |
| `.item` | `336×86` |
| `.card` | `312×74; ml:12; mt:6; radius:16; #241c2c; flex-row; center; padding:0 10/14` |
| `.thumb` | `96×54; radius:8; object-fit:cover` |
| `.lock` | `96×54; radius:8; #191320; center/center` |
| `.lock-t` | `26; #4c4055`（问号） |
| `.nm` | `21; #ffe6ef; width:154; margin-left:12; lines:1` |
| `.st` | `14; #9c8f9b; width:36; text-align:right` |
| `.back` | `top:432; left:50; 236×40; radius:20; #32243a` |
| `.viewer` | `absolute; 0,0; 336×480; #000; **overflow:hidden**` |
| `.big` | `absolute; 0,0; **854×480**; object-fit:fill`（宽度必须 = `gen_assets.CG_W`） |
| `.tapzone` | `absolute; top:56; 48×336`；`.zl{left:0}`；`.zr{left:288}` |
| `.vtop` | `top:10; 336 宽; flex-row; center; padding:0 88 0 14` |
| `.vname` | `16; #ffe6ef; lines:1` |
| `.vnum` | `15; #d8cbd2` |
| `.vclose` | `top:10; left:262; 64×34; radius:17; rgba(0,0,0,0.62)` |
| `.vclose-t` | `17; #ffe6ef` |
| `.hintplate` | `top:384; left:14; 308×38; radius:12; rgba(0,0,0,0.5)` |
| `.vhint2` | `top:390; width:336; center; 13px; rgba(232,222,230,0.92)` |
| `.track` | `top:412; left:48; 240×5; radius:3; rgba(255,255,255,0.28)` |
| `.thumb2` | `absolute; 0,0; 94×5; radius:3; #ffd8e6` |
| `.vbar` | `top:428; left:22; 292×42; radius:21; rgba(0,0,0,0.62); flex-row; center; space-between; padding:0 6` |
| `.vbtn` | `46×34; radius:17; #32243a` |
| `.vbtn-t` | `22; #fff` |
| `.vhint` | `14; rgba(226,214,224,0.8)` |

### 11.3 常量

```js
const CG_W = 854                        // 必须与 tools/gen_assets.py 的 CG_W 一致（npm run test 核对）
const CG_PAN_RANGE = CG_W - 336         // = 518，可拖动总距离
const CG_PAN_STEP = Math.round(CG_PAN_RANGE / 3)   // = 173，点击/滑动兜底一次走多远
const CG_DRAG_GAIN = 3.2                // 拖动放大倍数（分母是手指可用行程 336/2=168，518/168≈3.1）
```

### 11.4 行为

实例态（onInit 203-216）：`seen={}`、`groups=CGG||[]`、`curGroup=-1`、`curPage=0`、`cgLeft=0`、`touchX=null`、`touchLeft=0`、`lockTap=0`。
`loadSeen(list)` → 建 `seen` → `build()`。

`build()`（218-235）：遍历 9 组，`ok = !!seen[g.u]`，`rows.push({th:g.th, n:g.n, ok, st: ok ? g.im.length+' 张' : '未解锁'})`；`openCount = 已解锁组数`；`total = groups.length`。

`open(i)`（240-254）：`lock()`；`g=groups[i]`；**未解锁 → toast `'还没在剧情里看到这一组'` 并 return**；`curGroup=i; curPage=0; vName=g.n; pageAll=g.im.length; showPage(); viewing=true`。

`showPage()`（256-263）：`bigSrc = IMG[g.im[curPage]] || ''`；`pageNo = curPage+1`；`setPan(CG_PAN_RANGE / 2)`。

`setPan(v)`（265-277）：

```js
let l = v
if (l > 0) l = 0                       // 上限 0
if (l < -CG_PAN_RANGE) l = -CG_PAN_RANGE   // 下限 -518
l = Math.round(l)
this.cgLeft = l; this.cgStyle = 'left: ' + l + 'px;'
this.canLeft  = l < -2                       // 还能往右看
this.canRight = l > -CG_PAN_RANGE + 2        // 还能往左看
const ratio = CG_PAN_RANGE > 0 ? (-l / CG_PAN_RANGE) : 0
this.indStyle = 'left: ' + Math.round((240 - 94) * ratio) + 'px;'   // 0..146
```

> **实际行为与注释不一致（事实）**：`showPage()` 传 `CG_PAN_RANGE/2 = 259`，而 `setPan` 把正数夹到 **0**，
> 所以每张 CG 打开时显示的是**最左端**（`left:0`），不是注释（261）与 README（393）说的“正中间”。
> 若要保留“从中间开始看”，应传 `-CG_PAN_RANGE/2`。移植时需明确选择（见 §17.20）。

`onCgTouchStart(e)`（280-285）：`x=readX(e)`；`touchX=x; touchLeft=cgLeft`。
`onCgTouchMove(e)`（287-293）：`setPan(touchLeft + (x - touchX) * CG_DRAG_GAIN)`。
`onCgTouchEnd()`（295）：`touchX=null`。

`onPanSwipe(e)`（298-302）：`dir==='left' → setPan(cgLeft - CG_PAN_STEP)`；`dir==='right' → setPan(cgLeft + CG_PAN_STEP)`。
`panPrev()`（305）：`lock(); setPan(cgLeft + CG_PAN_STEP)`；`panNext()`（306）：`lock(); setPan(cgLeft - CG_PAN_STEP)`。
`prev()`（308-314）/`next()`（316-322）：`curPage = (curPage ∓ 1 + len) % len` 循环，`showPage()`。
`closeView()`（324-329）：`lock(); viewing=false; bigSrc=''; vName=''`。
`back()`（331）：`router.back()`。

> `readX(e)` / `readDir(e)` 是 `cg.ux` 里的**另一份实现**（cg.ux:164-184），与 `game.ux` 的 `readX/readDir` 逐字相同
> （源码注释说 cg 页这套经真机验证，game 页是照抄）。

---

## 12. `src/pages/settings/settings.ux`（302 行，设置）

### 12.1 结构（5 组设置 + 实时预览 + 重置/返回）

| 行 | 内容 | 控件 |
|---|---|---|
| 1 | 字体大小 | `−`(196,30) `值`(232) `＋`(286,30) + `<slider min=14 max=30 step=1 value="{{sizeIni}}" onchange="onSize">`（14,60,308×32） |
| 2 | 播放速度 | 同上几何 `top:94/99/124`；slider `0..120 step 1` |
| 3 | 自动播放速度 | `top:158/163/188`；slider `0..200 step 1` |
| 4 | 屏幕常亮 | 两个药丸 `关/开`（`.fastrow` top:226 left:228） |
| 5 | 长按屏幕 | 三个药丸 `隐藏/快进/关闭`（`.lprow` top:260 left:180） |
| — | 提示两行 | `.h1 top:296` / `.h2 top:310`，12px `#8b7f89` |
| — | 实时预览 | `.pv top:326 left:12 312×88 rgba(18,13,19,0.92) r14`；预览名牌「林曦」+ 预览句「想成为Galgame领域大神！！！」 |
| — | 底部 | `重置` / `返回`（`.row top:420 left:50 236 宽，两个 114×40`） |
| — | 调试 | `.dbg top:2 left:6 150 宽 11px #6d6270 lines:2`（显示 `readSlider` 挖到的事件字段） |

### 12.2 几何（其余）

`.title top:4; 21px`；`.slabel left:14; 16px; #cfc2cb`（`.l1 34 / .l2 98 / .l3 162 / .l4 228 / .l5 262`）；
`.step 32×28; radius:14; #32243a`（`.m1 196,30 / .p1 286,30 / m2 196,94 / p2 286,94 / m3 196,158 / p3 286,158`）；
`.step-t 18px #fff`；`.sval left:232; width:50; center; 15px; #ffb3cd`（`.v1 35 / .v2 99 / .v3 163`）；
`.sld left:14; width:308; height:32`（`.k1 60 / .k2 124 / .k3 188`）；
`.pill 44×30; radius:15; #2c2133; margin-left:6; 15px #cbbcc6`；`.pill-on 同尺寸 #b95079 白字`；
`.hint left:14; width:308; 12px; #8b7f89; lines:1`；
`.pv-name absolute top:4 left:12 #ffd8e6 bold`；`.pv-line absolute top:36 left:12 width:290 #fff lines:1`；
`.btn`（`.btn-half 114×40 radius:20 #32243a`）；`.btn-t 18px #fff`。

### 12.3 数据与行为

`protected`（125-143）：`sizeIni: DEFAULT_SETTINGS.size`、`speedIni`、`autoIni`（**只作为 slider 初值，onInit 里赋一次**）、`sizeText/speedText/autoText`、`rowKeep/rowLp`（药丸数组）、`hint1/hint2`、`pvStyle/pvNameStyle`、`dbg`。

`onInit()`（145-157）：`settings=DEFAULT_SETTINGS; saveTimer=null; lockTap=0`；`loadSettings(s => { settings=s; sizeIni=s.size; speedIni=s.speed; autoIni=s.autoMs; refresh() })`。
`onDestroy()`（159-161）：只清 `saveTimer`（**不 flush**）。
`refresh()`（163-183）：

```js
sizeText  = '' + s.size
speedText = s.speed === 0 ? '瞬间' : '' + s.speed
autoText  = s.autoMs === 0 ? '关闭' : '' + s.autoMs
rowKeep = ['关','开'].map((t,i)=>({t, cls: (!!s.keepOn === !!i) ? 'pill-on' : 'pill'}))
rowLp   = ['隐藏','快进','关闭'].map((t,i)=>({t, cls: (['hide','fast','off'][i] === lpCur) ? 'pill-on':'pill'}))   // lpCur 归一化
hint1 = '字号 14~30 px，显示的数字就是 px'
hint2 = '播放速度＝每字毫秒；自动播放＝每句停留毫秒。长按选「快进」时是按住才快进'
pvStyle = 'font-size:' + s.size + 'px; line-height:' + (s.size+6) + 'px;'
pvNameStyle = 'font-size:' + Math.max(16, s.size-2) + 'px;'
```

`apply(patch)`（185-193）：`settings = normalizeSettings({...settings, ...patch})`；`refresh()`；**300ms 去抖** `saveSettings`。
`flush()`（195-198）：清定时器 + 立即 `saveSettings`。

`readSlider(e)`（202-228）——**为“滑块事件结构未知”写的探针**：

```js
// 1) e 为空 → dbg='slider 事件为空'，返回 null
// 2) 若 e 是 number → 直接返回
// 3) scan(e)/scan(e.detail)/scan(e.target)：收集所有 number 字段，拼成 'k=v'
// 4) 优先取名字含 'value' 的候选；否则取第 0 个
// 5) dbg = 候选串（显示到屏幕上）；console.log('[GalGod] slider change: ' + dbg)
```

`onSize/onSpeed/onAuto`（234-250）：`v=readSlider(e)`；`null` 直接忽略；`onAuto` 额外 `if (v>0) patch.fast=false`。

`step(field, delta, lo, hi)`（253-263）：`lock()`；`v = clamp(settings[field] + delta)`；`autoMs>0` 时同时 `fast=false`；`apply(patch)`。
步进：`decSize/incSize ±1`；`decSpeed/incSpeed ±2`；`decAuto/incAuto ±10`（`AUTO_STEP=10`）。
`pickKeep(i)`（272-276）：`apply({keepOn: i===1})` + **立即 `flush()`**。
`pickLp(i)`（278-283）：`apply({longpress: ['hide','fast','off'][i] || 'hide'})` + 立即 `flush()`。
`reset()`（285-294）：`settings = normalizeSettings(DEFAULT_SETTINGS)`；重置三个 `*Ini`；`refresh(); flush(); toast('已恢复默认设置')`。
`back()`（296-300）：`lock(); flush(); router.back()`。

> 关键坑（源码注释 126-128）：**`<slider>` 的 `value` 只能绑“初值”**。绑实时值会变成受控组件，
> 拖动时框架先用旧值重渲染把滑块弹回去，表现为“划了没反应”。
> 因此用 `sizeIni/speedIni/autoIni` 三个只赋一次的字段；实时值另存。
> 另外**滑块上不能挂 `onswipe`**（拖动本身就是 swipe 手势，挂上会被吃掉）。

---

## 13. `src/pages/about/about.ux`（289 行，关于 + 彩蛋）

### 13.1 结构

```html
<text class="title" onclick="tapTitle">关于</text>      <!-- 彩蛋触发点：2s 内连点 7 次 -->
<text class="dots">{{dots}}</text>                     <!-- 连点计数提示 · / ·· / ··· -->
<text class="sub">GalGod · 小米手环 9 Pro 版 · v{{ver}}</text>
<list id="about-list" class="lst" bounces="true">
  <list-item for="{{rows}}" tid="ab"><div class="card"><text class="{{$item.c}}">{{$item.t}}</text></div></list-item>
</list>
<div class="back" onclick="back">返回</div>
<div class="mask" if="{{eggOpen}}"/> + <div class="egg" if="{{eggOpen}}">…</div>     <!-- 彩蛋菜单 -->
<div class="mask" if="{{fishOpen}}"/> + <div class="fish" if="{{fishOpen}}" onclick="tapFish">…</div>  <!-- 小鱼干小剧场 -->
```

彩蛋菜单 4 项：`解锁 · 后日谈`(unlockAfter) / `解锁 · 全部 CG`(unlockCg) / `小鱼干`(openFish) / `关闭`(closeEgg)。
小鱼干界面：`fishName`（说话人）+ `fishText`（台词）+ `fishHint`（`i+1 / 30` 计数）。

### 13.2 几何

`.page 336×480 #14101a`；`.title top:4; 22px`；`.dots top:10 left:286 width:40 15px #ff9ec4`；
`.sub top:36 12px #9c8f9b center`；`.lst top:58; 336×366`；`.item 336×25`；`.card 336×25 flex-row center padding-left:14`；
`.r-p width:308 15px #d9cdd6 lines:1`；`.r-s width:308 15px #ffb3cd lines:1`；`.r-g width:308 6px #14101a`（空行占位）；
`.back top:432 left:50 236×40 r20 #32243a`；
`.mask 336×480 rgba(8,6,10,0.72)`；`.egg top:104 left:32 272×250 #241c2c r18 flex-column center padding-top:14`；
`.egg-t 17px #7ee8e0 mb:12`；`.egg-b 216×40 r20 #3a2b45 mb:8`；`.egg-c #2a2033 mt:4`；`.egg-bt 17px #fff`；
`.fish top:300 left:24 288×150 flex-column`；`.fish-n 17px #7ee8e0 mb:8`；`.fish-t 17px #fff lh:24`；`.fish-h absolute bottom:0 left:0 14px #8a7f90`。

### 13.3 常量与数据

```js
const APP_VER = '2.5.2'    // 必须等于 manifest.versionName，tools/build.js 构建前核对（build.js:91-103）
const CPL = 20             // 关于页每行字数；floor(308/15)=20
const ABOUT = [ ['s'|'p'|'g', '文本'], … ]   // 共 37 项：4 个 s、18 个 p、15 个 g
const FISH_LINES = [ {n:'', t:'…'}, … ]      // 共 30 条
```

`ABOUT` 完整内容（**内容移植必须逐字保留**，37 项）：

| kind | 文本 |
|---|---|
| s | 故事梗概 |
| p | 在一个由「天选试」决定一切的世界里—— |
| p | 国家每三年举办一次天选试，一次录取一千人，考核内容全部是美少女游戏（Galgame）。 |
| p | 通过者握有制定规则、影响国运的权力。万般皆下品，惟有旮旯高。 |
| g | *(空)* |
| p | 主角陈舟是个不折不扣的 Galgame 废萌党。比起上学，他更想打游戏。 |
| g | *(空)* |
| p | 林曦是他的青梅竹马兼「好哥们」，比谁都温柔，却对 Galgame 既无兴趣也无才能。 |
| g | *(空)* |
| p | 江晚晴永远一副尽在掌握的样子，在三人之间斡旋，一步步走向她要的结局。 |
| g | *(空)* |
| p | 还有小涟——只有他能看见的纯白少女，与月光同在。 |
| g | *(空)* |
| p | 在「现实的 Galgame」里，他要面对的不是攻略路线，而是一个必须做出选择的世界。 |
| g | *(空)* |
| s | 结局 |
| p | 真结局 · 这片月幕：登上天选台，拒绝「剧情作」的做法，全选，全都要——创造全员幸福的结局。 |
| g | *(空)* |
| p | 结局 · 二人的世界：退出殿试，婉拒重职，与她们平和地告别。 |
| g | *(空)* |
| p | 结局 · 回归日常：带着温暖的心情活下去，活在一个有你们的世界。 |
| g | *(空)* |
| p | Bad End · 未能触碰的世界：省试落选，什么都无所谓了。 |
| g | *(空)* |
| p | 后日谈 · 诺提拉：深夜，刚通关一部 Galgame 的玩家，在家里遇见了自称诺提拉的金瞳少女。 |
| g | *(空)* |
| s | 版权信息 |
| p | 本应用为非官方、非商业性的个人移植作品，与 AstroBox、小米（Xiaomi）均无关联，亦未获其授权或认可。 |
| g | *(空)* |
| p | 剧本文字与全部美术资源（背景 / 立绘 / CG / 标题画）版权归原作 GalGod 及其开发方「诺提拉观察所」所有。 |
| g | *(空)* |
| p | 素材仅用于学习与交流，请勿用于任何商业用途。如有侵权，请联系删除。 |
| g | *(空)* |
| s | 开源协议 |
| p | 本项目代码基于 MIT 协议开源，详见仓库根目录的 LICENSE 文件。 |
| g | *(空)* |
| p | Copyright (c) 2026 The GalGod Band Project Contributors |

`FISH_LINES` 完整内容（30 条，`n` 说话人 / `t` 台词）：

```
1  ('',      '（口袋里还剩最后一包小鱼干。）')
2  ('Yui',   '……（耳朵动了动）')
3  ('我',    '你盯着我干什么？')
4  ('Yui',   '你口袋里有味道。')
5  ('我',    '你鼻子是雷达吗。')
6  ('Yui',   '是。')
7  ('我',    '……行吧。')
8  ('',      '（把整包倒了出来。）')
9  ('Yui',   '！')
10 ('Yui',   '……等一下。')
11 ('Yui',   '这个不行。')
12 ('我',    '啊？')
13 ('Yui',   '蛋黄粉太薄了。')
14 ('我',    '你还挑这个。')
15 ('Yui',   '要裹得厚厚的。厚到咬下去，先掉一层粉。')
16 ('我',    '……')
17 ('Yui',   '而且要有星星。')
18 ('我',    '什么星星。')
19 ('Yui',   '会闪的那种。')
20 ('我',    '小鱼干上为什么会有星星。')
21 ('Yui',   '因为那是小鱼干的愿望。')
22 ('我',    '……')
23 ('我',    '（默默记下：厚蛋黄粉，带星星闪。）')
24 ('Yui',   '记下了？')
25 ('我',    '记下了。')
26 ('Yui',   '那就好。')
27 ('Yui',   '今天的评价，给你加一分。')
28 ('我',    '原来是可以加分的吗。')
29 ('Yui',   '看你表现。')
30 ('',      '（尾巴晃了两下。）')
```

### 13.4 行为

`onInit()`（191-196）：`tapCount=0; lastTap=0; lockTap=0; build()`。
`build()`（198-209）：遍历 `ABOUT`；`g` → `rows.push({c:'r-g', t:''})`；否则 `c = kind==='s' ? 'r-s' : 'r-p'`，`wrapText(txt, CPL)` 后**每个物理行一个 `list-item`**。
`tapTitle()`（215-229）：`now-lastTap>2000 → tapCount=0`；`tapCount++`；`>=7` → 清零、`dots=''`、`eggOpen=true`；否则 `tapCount>=4` 时显示 `DOTS = ['','·','··','···']` 的 `min(3, tapCount-3)` 项。
`closeEgg()`（231）：`lock(); eggOpen=false`。
`openFish()`（234-240）：`lock(); eggOpen=false; fishIdx=0; fishOpen=true; showFishLine()`。
`showFishLine()`（242-248）：越界 → `fishOpen=false`；否则设 `fishName/fishText/fishHint = (i+1)+' / '+30`。
`tapFish()`（250-260）：`lock(); fishIdx++`；到底 → `fishOpen=false; eggOpen=true`（回到彩蛋面板）；否则 `showFishLine()`。
`unlockAfter()`（263-269）：`lock(); eggOpen=false; markCleared(() => toast('已解锁「后日谈 · 诺提拉」'))`。
`unlockCg()`（272-285）：`lock(); eggOpen=false`；把 `CGG[*].im` 去重合并成 `all`（32 个下标）；`saveSeen(all, () => toast('已解锁全部 CG（32 张）'))`。
`back()`（287）：`lock(); router.back()`。

> 彩蛋直接复用正常流程的 storage 键（`cleared` / `cgSeen`），不是旁路状态，所以解锁后章节页/CG 页立刻可见且重启仍在。
> 注意：`unlockAfter` 只写 `cleared`，**不会**给 `true_end_flag`/`true_end_finish` 置位——
> 因此“解锁后日谈”后从章节页直接进后日谈可读，但读完后走到终点节点时 `playEnd` 里的通关判定
> 仍依赖 `flags.true_end_finish`（后日谈章节本身没有 `sf true_end_finish`，所以不会重复写 cleared）。

---

## 14. 资源清单与尺寸（实测，非 README 转述）

### 14.1 引擎实际使用的图片（**这些才是必须移植进目标包的**）

| 目录 | 数量 | 尺寸 | 调色板 | 字节 | 用途 |
|---|---|---|---|---|---|
| `common/img/b/*.png`（38 个**无后缀**文件） | 38 | **672×480** | PNG 调色板 80 色 | 3,383,457 B = 3.227 MB | 背景（全景宽图） |
| `common/img/s/*.png`（`000.png`…`054.png`） | 55 | **143×380** | PNG 调色板 128 色（带 alpha） | 523,642 B = 0.499 MB | 立绘 |
| `common/img/c/*.png`（`cg_001`…、`sd_001`…，34 个无后缀文件） | 34 | **854×480** | PNG 调色板 56 色 | 3,422,650 B = 3.264 MB | CG / SDCG |
| `common/img/t/g0.png`…`g8.png` | 9 | **96×54** | PNG 调色板 64 色 | 28,956 B = 0.028 MB | CG 鉴赏缩略图 |
| `common/home.png` | 1 | **336×480** | 96 色 | 35,967 B | 主页标题画 |
| `common/icon.png` | 1 | **192×192** | **RGBA**（圆角 44） | 51,084 B | 应用图标 |
| **合计** | **138 PNG** | — | — | **7,445,756 B = 7.101 MB** | （与 README 的 7.06 MB / rpk 7.40 MB 一致量级） |

剧本资源：`story/index.txt` 4,010 B + 44 个 chunk 共 527,773 B → **合计 531,783 B = 0.507 MB**。
公共 JS：`assets.js`+`cglist.js`+`reader.js` = 13,180 B。

> 真机图片预算（README 第 732 行）：**< 9 MB**。当前 7.10 MB，余量约 1.9 MB。
> 体积构成：背景 45.4%（672 宽是 336 的 2 倍）+ CG 46.0%（854 宽是屏幕 2.54 倍）。

### 14.2 仓库里**存在但不被引擎引用**的残留文件（106 个，4.530 MB）

| 文件形态 | 数量 | 尺寸 | 字节 | 来源 |
|---|---|---|---|---|
| `common/img/b/*_r.png` | 38 | 336×480 | 1,867,256 B | 旧版“导出的 336 宽背景”残留 |
| `common/img/c/*_l.png` | 34 | 336×480 | 1,473,729 B | 旧版“CG 预切左右图”残留 |
| `common/img/c/*_r.png` | 34 | 336×480 | 1,409,140 B | 同上 |
| **合计** | **106** | — | **4,750,125 B = 4.530 MB** | |

证据：
1. `assets.js` 的 `IMG` 只列 138 个**无后缀**文件（§4.1），无一例 `_l/_r`；
2. `tools/test_paginate.js:240-243` 明确断言 **`cg.ux` 里不许出现 `_l`/`_r` 分块痕迹**（“CG 应该是一张宽图靠拖动看，不要切块翻页”）；
3. `tools/gen_assets.py:120-128` 每次生成前**清空 `img/`**（注释说明：改名后旧文件会留在包里白占体积，踩过一次 1.6 MB）；
4. `build.js` 校验 rpk 内 PNG 数 = 138（README 第 698 行：`211 条目 / 138 PNG / 44 剧本块`）。

结论：这 106 个文件是**历史残留**（导出仓库时保留了工作区文件），新的 rpk 里没有它们。
**移植时只取 §14.1 的 138 张**；若误把 `_l/_r` 一起搬过去，会多 4.53 MB 且让“CG 单图拖动”方案被误改成翻页。

### 14.3 每类图片在引擎中的绘制尺寸与位置（汇总）

| 素材 | 素材像素 | 运行时元素框 | object-fit | 位置 | 出处 |
|---|---|---|---|---|---|
| 背景（672×480） | 672×480 | 672×480 | `fill` | `absolute 0,0`，`left` 由定时器 0→-336→0 往复 | game.ux:121-124、239-242、973-991 |
| 立绘（143×380） | 143×380 | 143×380 | `contain` | `absolute top:100`，左/中/右 `left:10/96/182` | game.ux:128-131 |
| CG 正文层（854×480） | 854×480 | 336×480 | **`cover`**（裁两侧，满屏） | `absolute 0,0` | game.ux:114、27 |
| CG 鉴赏大图（854×480） | 854×480 | 854×480 | `fill` | `absolute 0,0`，`left ∈ [-518, 0]` | cg.ux:99-100、149-160、265-277 |
| 回忆滤镜 | 纯色 | 336×480 | — | `absolute 0,0`，`rgba(240,222,176,0.22)` | game.ux:135-136 |
| 主页标题画（336×480） | 336×480 | 336×480 | `cover` | `absolute 0,0` | index.ux:27 |
| CG 缩略图（96×54） | 96×54 | 96×54 | `cover` | 列表行内左侧 | cg.ux:82 |
| 应用图标（192×192） | 192×192 | — | — | manifest | — |

> **背景取景**：`gen_assets.py` 用 `cover(im, 672, 480, bias_y=0.42)`——纵向偏上取景，因为底部会被对话底板挡住（gen_assets.py:139-143）。
> **CG 取景**：`cover(im, 854, 480, bias_y=0.5)` 居中（gen_assets.py:147-151）。
> **立绘**：`contain(im, 143, 380, bg=None, anchor="bottom")`——等比放入、底部对齐、透明补边（gen_assets.py:144-146）。

---

## 15. `tools/` 脚本的规则（溯源与自检，移植后应复刻等价校验）

### 15.1 `tools/gen_story.py`（884 行，Ren'Py `.rpy` → 分块节点）

#### 15.1.1 输出节点格式（文件头注释 9-16 行；注意 `p` 字段是**旧版**已废弃的预分页）

```python
{t:"s",  n:"林曦", x:"原始台词", bg?, cs?, cg?, tint?}       # 一句台词（现行；旧版是 p:[页1,页2]）
{t:"o",  o:[{x:"选项", j:目标下标, c?:[flag,op,n]}]}          # 分支
{t:"j",  j:下标}                                             # 跳转
{t:"cj", v:flag, op:">=", n:7, j:下标}                        # 条件成立才跳
{t:"f",  v:flag, n:1}                                        # 标记累加
{t:"sf", v:flag, n:1}                                        # 标记赋值（文件头第 9-16 行未列出 sf，但实现见 §6.7）
{t:"e",  x:"结局标题", bg?, cs?, cg?}                          # 结局
```

`CHUNK_SIZE = 128`（gen_story.py:22）。
**不再在构建期分页**（gen_story.py:24-26）：台词按原始文本存进 `x`，分页由 `game.ux` 运行时按字号现算。

#### 15.1.2 角色/关键词映射

- `SPEAKER_NAMES`（32-40）：`cz→陈舟, me→我, zhengke→政客, lx→林曦, jwq→江晚晴, xl→小涟, xl_l→小涟, noctella/nt→诺提拉, xy_a/b/c→校友A/B/C, ty_a→健壮男生, reporter_a/b/c→记者A/B/C, staff→工作人员, man_parent→成熟男士, woman_parent→贵气妇人, banzhuren→班主任, n/centered/vcentered/narrator→''`
- `KEYWORDS`（42-52）：Ren'Py 关键字集合，用于区分“自定义角色码 + 台词”与普通语句。
- `MAIN`（54-55）：正片 14 章编译顺序 `1_1,1_2,1_3,1_4,2_1,interlude1,interlude2,2_2,2_3,2_4,3_1,3_2,3_3,3_4`。
- `CHAPTER_TITLES`（57-65）：章节 id → 中文标题（§6.2 的 title 来源；含未使用的 `interlude-interview`）。
- `LABEL_FILE`（67-75）：Ren'Py label → 场景文件 id（`scene_1_1→1_1`、`end1→end_te`、`end2→end_ne1`、`end3→end_ne2`、`after_story_noctella→after_story_noctella`）。
- `CHAPTER_HIDE = {end_te,end_ne1,end_ne2}`（78）；`CHAPTER_NEED_CLEAR = {after_story_noctella}`（80）。

#### 15.1.3 语句解析（`parse_one`，167-297）

| 源写法 | 产出 | 行号 |
|---|---|---|
| `$ ...full_restart...` | `("ending","Bad End · 未能触碰的世界")` | 171-173 |
| `$ flag += N` | `("flag", flag, N)` → `f` 节点 | 174-176 |
| `$ flag = True/False/数字` | `("setflag", flag, 1/0/N)` → `sf` 节点 | 177-182 |
| `$ obj.show("expr", pos=...)` | `("show", code, expr, pos)` → 写入 `cs` | 183-186 |
| `$ obj.hide(` | `("hide", code)` → 从 `cs` 移除 | 187-190 |
| `hide cg` / `hide sdcg` | `("cg","")` → `cg:-1` | 192-195 |
| `hide <code>`（code 是立绘角色） | `("hide", code)` | 196-199 |
| `scene bg <name>` / `show bg <name>` | `("bg", name)` | 201-204 |
| `scene black` / `scene white` | `("bg","black"/"white")` → `-1/-2` | 205-207 |
| `scene/show cg <n>` | `("cg","cg_"+n)` | 208-210 |
| `scene/show sdcg <n>` | `("cg","sd_"+n)` | 211-213 |
| `show cinematic_black_overlay` | `("bg","black")` | 214-215 |
| `show layer <x> at <filter>` | `("tint", filter=="memory_filter" ? "memory" : "")` | 216-219 |
| `show rainback/rainfront` | **忽略**（手环不做雨层，注释 220） | 220-222 |
| `show <code> [expr] [at ...]` | code 是立绘 → `show`；是背景 tag → `bg` | 223-236 |
| `"文本"` | 旁白 `("say","",text)` | 238-259 |
| `"名字" "台词"` | 说话人 `("say", 名字, 台词)`；同时记进 `STRING_SPEAKERS` 用于自检 | 244-256 |
| `centered_left_text("...")` | 旁白 | 261-263 |
| `<code> "台词"`（code 在 SPEAKER_NAMES） | 说话人 | 265-280 |
| `jump <label>` / `call <label>` / `return` | `("jump"/"call"/"return")` | 282-289 |
| 其它关键字（play/stop/voice/window/with/pause/…） | 忽略 | 291-294 |

文本清洗（`clean_text`，108-114）：反转义（`\n \t \" \' \\ \{ \[`）→ 保护 `{{`/`[[` → `{space=N}`→空格 → 删除 `{...}` 标签 → 还原 → `strip()`。

#### 15.1.4 结构化编译（`Compiler`，443-592）

- `emit(node, visible=False)`（451-456）：`visible=True` 时把 `pending`（bg/cs/cg/tint 累积状态）合并进节点并清空 —— **这就是“画面变化只在真变化时写入节点”的实现**。
- `jmp(label)`（458-460）：先发占位 `{"t":"j","j":-1}`，登记 patch，最后回填。
- `set_bg/set_cg/show/hide`（470-506）：写 `pending`；`show` 对同一 `k` 的角色**就地替换表情**（保持槽位顺序）。
- `compile_if`（565-575）生成的结构（**移植校验时可据此推断节点布局**）：

```
cj(cond, j=then_start)      # 条件成立跳 then
<else 体>
j(j=after)                  # 跳过 then
then_start:
<then 体>
after:
```

- `compile_menu`（577-592）：先发 caption 的 `s` 节点；再发 `o` 节点（`o:[]` 占位）；选项体起点即 `j` 目标；**选项体末尾若无条件跳转，则补一条 `j` 落到 `__menu_after_%d__`**。
- `compile_call`（553-563）：把被调章节**原地内联**，其内部 `return` 回填到调用点之后。
- 主流程（656-701）：正片 14 章顺序编译（`ret_target="fall"` 表示章末 `return` 直接落进下一章）→ 三个结局章各自编译（先发一个 `j` 占位当各章 `return` 的落点，再补 `cj true_end_finish==1 → __after_story__`，再 `jmp("__end__")`）→ 后日谈 → 末尾发 `{"t":"e","x":"—— 全剧终 ——"}`。

> 关键 bug 修复（README 第 707-710 行）：早期每章 `return` 被编译成“直接跳全剧终”；结局之间条件不成立时会**互相落空串场**。
> 现行做法 = 每个结局章末尾显式补 `cj → 后日谈` 与 `j → __end__` 两条（实测 4980/5089/5156 三个 cj）。

#### 15.1.5 资源映射（`load_asset_maps` 620-653、`collect_assets` 837-868）

- 背景：`resources.rpy` 里 `image bg <name> = bg_fit("images/bg/...")` 或 `image <name> = bg_fit("images/bg/...")`；`black/white` 直接映射 `-1/-2`。
- 立绘：`config/character_config.rpy` 里 `"code": { "表情": "images/characters/..." }`；另有 `resources.rpy` 的 `image <code> <expr> = "images/characters/other/..."`。
- CG：`image cg <n> = bg_fit("images/cg/...")` → `cg_<n>`；`image sdcg <n> = bg_focus("images/sdcg/...")` → `sd_<n>`；`image cg <name> = "images/cg/..."` → `cg_<name>`。
- 索引顺序（629-646）：**先背景（按 key 排序）→ 再立绘（按 `code|expr` 排序）→ 再 CG（按 key 排序）**，`IMG_INDEX[(kind,key)] = len(IMG_LIST)`。
- 立绘输出名 = `"/common/img/s/%03d.png" % 当前立绘序号`（639）。

#### 15.1.6 生成物

1. `src/common/story/chunk-%03d.txt`（713-719）：`json.dumps(part, ensure_ascii=False, separators=(",",":"))`；每块 128 节点。
2. `src/common/story/index.txt`（721-728）：`{ver:1, title:"GalGod", nodeCount, chunkSize:128, entry:0, chapters, chunks}`。
3. `tools/assets.json`（731-734）：`IMG_LIST`（`[{kind,key,src,out}]`，`indent=1`）。
4. `src/common/assets.js`（737-762）：`IMG`（数组）+ `BG`（`black: -1, white: -2` 先写，再按排序写背景）+ `SP`。
5. `src/common/cglist.js`（784-789）：`CGG = json.dumps(gall, ensure_ascii=False, separators=(",",":"))`；`th = "/common/img/t/g%d.png" % idx`。
6. **自检**（793-807）：`STRING_SPEAKERS` 里的名字若出现在任何 `s` 节点 `x` 的开头 → 记 WARNING（“说话人被拼进正文”）。

#### 15.1.7 生成后应打印的统计（可作为移植核对基线）

```
节点总数 : 5569
分块     : 44 块 (128/块)
章节     : 18
节点类型 : {'s': 5457, 'o': 15, 'j': 65, 'cj': 4, 'f': 13, 'sf': 13, 'e': 2}   # 实际顺序见 §6.4
字符串说话人 : 班主任(22), 同学A(17), 同学B(10), ???(9), 远处的声音(2), 众人(1)
图片索引 : {'bg': 38, 'sp': 55, 'cg': 34}  共 127 张
```

### 15.2 `tools/gen_assets.py`（257 行，Ren'Py 原图 → 手环 PNG）

#### 15.2.1 常量（全部）

| 常量 | 值 | 行号 | 意义 |
|---|---|---|---|
| `SCREEN_W, SCREEN_H` | `336, 480` | 25 | 画布（必须与 game.ux CSS 一致） |
| `BG_W` | `672` | 39 | 背景宽 = 2×屏幕宽（可平移 336px）；**=336 则不平移且体积减半** |
| `CG_W` | `854` | 48 | CG 宽（16:9 于 480 高） |
| `SPRITE_W, SPRITE_H` | `143, 380` | 50 | 立绘框 |
| `BG_COLORS` | `80` | 53 | 背景调色板色数 |
| `SP_COLORS` | `128` | 54 | 立绘色数 |
| `CG_COLORS` | `56` | 55 | CG 色数 |
| `THUMB_W, THUMB_H` | `96, 54` | 56 | 鉴赏缩略图（16:9） |
| `THUMB_COLORS` | `64` | 57 | 缩略图色数 |
| `HOME_TOP_H` | `240` | 61 | 主页真正露出的画面区高度（= index.ux `.panel` 的 top） |

#### 15.2.2 变换与量化

- `cover(im, w, h, bias_y=0.5)`（64-73）：`scale = max(w/sw, h/sh)` → LANCZOS 缩放 → 水平居中裁、垂直按 `bias_y` 裁（背景 0.42 偏上，CG 0.5 居中）。
- `contain(im, w, h, bg=None, anchor="center")`（76-92）：`scale = min(...)`，透明画布（或指定底色），`anchor="bottom"` 底部对齐；立绘用透明底 + bottom。
- `save_palette(im, path, colors, alpha)`（95-104）：
  - `alpha=True` → `convert("RGBA")` + `quantize(colors, method=FASTOCTREE)`；
  - `alpha=False` → `convert("RGB")` + `quantize(colors, method=MEDIANCUT, dither=FLOYDSTEINBERG)`；
  - `q.save(path, "PNG", optimize=True)`。**只输出 PNG**（真机 JPEG 解码不可靠：`gen_assets.py:6` 设计目标、`build.js:168-173` 断言 rpk 内无 JPEG、README 第 698 行记录“无 JPEG”）。
- 背景：`cover(im, BG_W, SCREEN_H, bias_y=0.42)`，无色（139-143）。
- 立绘：`contain(im, SPRITE_W, SPRITE_H, bg=None, anchor="bottom")`，alpha（144-146）。
- CG：`cover(im, CG_W, SCREEN_H, bias_y=0.5)`，无色（147-151）。

#### 15.2.3 主页画与图标（特殊流程）

- 生成前**清空 `img/`**（120-128），避免改名残留。
- 主页画（192-216）：源 `images/cg/main_screen.avif` → 按 `ah*1.5` 居中裁成 3:2（1920×1080 → 1620×1080）→ 按**宽度**缩放到 336（高约 224，不 cover，保住左右构图）→ 粘贴到 `(13,9,16)` 底色的 336×480 画布 → 从 `fit_h` 到 480 用**渐变 blend** 收进底色 → 96 色量化 → `common/home.png`。
- 图标（218-233）：源同图 → `side = int(ah*0.56)`（≈604，到肩部方框）→ 中心 `(int(aw*0.575), int(ah*0.32))`（女孩脸）→ 裁方图 → `resize(192,192)` → 圆角遮罩 `rounded_rectangle([0,0,191,191], radius=44)` → RGBA PNG → `common/icon.png`。
- 报告（235-241）：打印各类数量/平均字节/总 MB；**>9MB 报警**。

### 15.3 `tools/validate_story.py`（133 行）—— 打包前校验

5 类检查（文件头注释 5-10）：

1. **分块连续性/完整性**：按 `start` 排序后必须从 0 起严格衔接；每块文件存在；`len(part) == count`；合计 == `nodeCount`；无空槽（31-50）。
2. **图片引用范围**：`bg`/`cg` 必须满足 `-2 <= v < img_count`（`img_count` 从 `assets.js` 的 `IMG` 数组数出来）；`cs[].i` 必须 `0 <= i < img_count`；`cs[].s` 必须是 `left/center/right/c/l/r` 之一（否则警告）。
3. **跳转范围**：`j`/`cj` 的 `j` 与 `o[].j` 必须在 `[0,nodeCount)`；`o[].c` 若存在必须长度 3；章节 `start` 必须在范围内（65-77）。
4. **全图可达**（79-106）：从 `entry` 出发 DFS，`j→[j]`、`cj→[j, i+1]`、`o→所有选项 j`、其余 `t!='e' → [i+1]`、`e` 无后继；不可达节点数必须为 0。
5. **统计输出**（108-129）：节点数/分块数/章节数/图片表大小/节点类型分布/可达数/结局节点数；有 error 则 `return 1`。

### 15.4 `tools/simulate.py`（233 行）—— 剧情流程模拟器

用 Python 复刻 `game.ux` 的 `step()` 语义（`GUARD = 20000`）：

- `body_flags(nodes, start)`（30-51）：从选项体起点往前走，收集途中遇到的 `f`/`sf` 的 flag 名，遇到 `j`/其它类型停（用于“这个选项会加分吗”）。
- `play(nodes, index, picker, label)`（54-122）：`s` 记一次 tap 并 `pc++`；`f` 累加；`sf` 赋值；`j` 跳；`cj` 按 op 表判定；`o` 过滤条件后交给 `picker`；`e` 收尾。返回 `{label,end,taps,flags,choices,ok,path,visited}`。
- 8 种策略（172-177）：

```python
[("全部选第一个", first), ("全部选最后一个", last),
 ("优先加分选项", greedy), ("优先加分+取后者", greedy_last),
 ("优先不加分选项", avoidflag),
 ("真结局线", prefer("交给小涟选择")),
 ("end2 线", prefer("要让小涟诞生")),
 ("end3 线", prefer("要对小涟放手"))]
```

- 校验（179-227）：8 条策略都必须 `ok`（不越界/不超步/不触发“选项全被过滤”）；结局章 `end_te/end_ne1/end_ne2/after_story_noctella` 至少覆盖 3 个；
  **同一周目不允许串多个结局章**（204-211）；统计选项覆盖率。
- 已知抓到过 2 个逻辑 bug（README 第 707-710 行）：每章 `return` 编译成跳全剧终、结局之间落空串场。

### 15.5 `tools/test_paginate.js`（477 行）—— 排版与跨文件一致性断言（`npm run test`）

**核心手法**：把 `game.ux` 的 `layout()` 与 `reader.js` 的 `wrapText()/paginateText()` **源码原文**用正则抠出来 `new Function` 执行，
几何常量也从 `.ux` 里抠，所以“测的就是设备上跑的那份”，改版面测试会跟着变（文件头注释 1-18）。

断言清单（全部会导致 `exit(1)`）：

| # | 断言 | 位置 |
|---|---|---|
| 1 | 能抠出 `PANEL_TOP/PANEL_H/NAME_TOP/TEXT_TOP/TEXT_BOX_W/TEXT_PAD/TEXT_BOX_H/MAX_LINES` | 45-56 |
| 2 | **CSS 与 JS 常量一致**：`.panel{top,height}` == `PANEL_TOP,PANEL_H`、`.name{top}` == `NAME_TOP` | 92-109 |
| 3 | `gen_assets.SCREEN_W/H、BG_W、CG_W` 可读 | 123-131 |
| 4 | `game.ux.BG_W` == `gen_assets.BG_W`；CSS `.bgwide{width}` == `BG_W` | 134-143 |
| 5 | `BG_PAN_RANGE` == `BG_W - 屏幕宽` | 144-147 |
| 6 | 存在 `BG_STEP_PX` / `BG_TICK_MS` | 148-150 |
| 7 | `.bgwide` **不许**出现 `transition`/`animation` | 152-156 |
| 8 | `game.ux` **不许**有 `<swiper`、`.bgsw`、`.bgslide`、`buildBgFrames`、`startBgSwap`、`BG_TILE_COUNT` 残留 | 157-163 |
| 9 | 必须有 `startBgPan` / `bgPanTick` | 164-166 |
| 10 | `.page` 必须有 `overflow:hidden` | 169-175 |
| 11 | `CG_W > SCREEN_W` | 178-180 |
| 12 | `cg.ux` **不许**有 `scrollview`；必须有 `ontouchmove/ontouchstart/onswipe` 与 `panPrev/panNext`；根节点**不许**挂 `onswipe` | 183-203 |
| 13 | `cg.ux` `.big{width}` == `CG_W`，且必须写 `object-fit`；`.viewer`/页面必须有 `overflow:hidden` | 204-217 |
| 14 | `CG_DRAG_GAIN × (屏幕宽/2) >= CG_W - 屏幕宽`（否则“只能拖一半”） | 218-237 |
| 15 | `cg.ux` **不许**出现 `_l`/`_r`/`buildPanTiles` 痕迹 | 240-243 |
| 16 | **所有页**：给了宽高的 `<image>` 必须写 `object-fit` | 303-334 |
| 17 | **设置项登记表** `CONTROL_SITE`：`DEFAULT_SETTINGS` 每个键都必须登记由哪个页面控制，且该页面真的引用了它（`size/speed/autoMs/keepOn/longpress→settings`，`fast→game`） | 336-392 |
| 18 | 关于页 `CPL × 字号 <= .r-p 宽度` | 394-416 |
| 19 | 全剧本（5457 句）× 字号 14–30：**不超行、不超页、不丢字、末行不压 `.more`(462)** | 433-477 |

`test_paginate.js` 输出的基线（README 第 497-502 行记录）：

```
字号 14  每行22字  每页6行  总行数   8500  总页数   5457  ✔
字号 20  每行15字  每页5行  总行数  11315  总页数   5575  ✔
字号 30  每行10字  每页3行  总行数  16267  总页数   7563  ✔
✔ 字号 14~30 全部通过：不超行、不超页、不丢字、不压 ▼
```

### 15.6 `tools/build.js`（180 行）—— 构建前静态检查 + 构建包装 + 产物校验

1. **`preflight()`（43-110）**——拦“编译器不报错、真机才抛错”的两类 Vela 陷阱：
   - 扫描 `src/pages/**/*.ux` 的 `<script>`，按 **2 空格缩进**取 `export default` 第一层键：
     - 若同时出现 `data` 与 `public/protected/private` → **拒绝构建**（build.js:76-80）；
     - 若出现顶层字面量属性（`{` `[` `null` 数字 引号 true/false 开头）→ **警告**（81-85）。
   - **版本号一致性**（89-103）：`about.ux` 的 `APP_VER` 必须 == `manifest.versionName`，否则拒绝构建。
2. **构建包装**（114-130）：清 `../.temp_<工程名>` → `node node_modules/aiot-toolkit/lib/bin.js build|release` → 再清一次；aiot 退出码非 0 但产物存在时“当作成功”（Windows 上 rimraf 删 junction 会 EPERM，README 坑 1）。
3. **产物校验**（132-178）：`dist/*.rpk` 必须存在；自解析 zip 中央目录（不依赖 tar）列出条目；断言：
   - 无 JPEG（真机解码不可靠）；
   - 必含 `common/story/index.txt` 与 `story/chunk-*.txt`；
   - 打印条目数/PNG 数/剧本块数；>10MB 警告。

---

## 16. README 第五节「已知的坑」逐条摘录（全部已在源码里绕过）

> 原书 564-666 行。每条都给出了**真机证据或固件日志**，移植时必须继承这些约束。

**坑 1（build.js:1-13、README 566-571）：aiot-toolkit 在 Windows 上构建收尾 EPERM。**
工具先把工程复制到同级 `../.temp_<工程名>` 再编译，收尾用 rimraf 删临时工程；临时工程里的 `node_modules` 是软链接（junction），
rimraf 删它必报 `EPERM: operation not permitted, unlink ...node_modules`。
此时 **rpk 其实已生成**，但退出码是 1，还留垃圾目录，下次构建开头清理失败会中断。
→ `tools/build.js` 构建前后各用 `rmdir /s /q` 清一次 + 构建后校验产物内容。

**坑 2（README 573-576）：rpk 里的 JSON 资源用 `.txt` 扩展名。**
JSON 会被 webpack 当模块处理；用 `.txt` 存 JSON 内容可保证被当纯资源原样复制进包，运行时用 `@system.file.readText` 读
（官方文档明确 `readText` 支持 `/common/xxx` 应用资源路径）。
→ **移植到 BlueOS 时此条反转**：BlueOS 打包只收 `.json`，`.txt` 不会进包（见 §17.1）。

**坑 3（README 578-600）：不要给「有子节点」的容器加 `opacity` —— 真机实测。**
首版装上手环后：主页上半部分（背景 + `opacity:0.34` 压暗层）正常，下半部分整块变**横向条纹**、内容被压扁重复。
原因：`.panel` 用了 `background-color:#150f19; opacity:0.94` 且**内部有按钮子节点**；`opacity` 会让运行时把整棵子树离屏合成，手环固件上这条路径是坏的。
空 div 用 `opacity` 没事（压暗层即证据）。参考工程 `galgaoshou` 一直规避：它的 `.dialogue-panel` 是**空 div**，说话人/正文都是**兄弟节点**。
→ 本工程做法：**所有半透明一律改 `rgba()` 背景色，彻底不用 `opacity`**。
顺带修掉的真 bug：主页面板内容约 236px 塞进 230px 容器（轻微溢出）→ 改成 `top:240; height:240`。

**坑 4（README 602-632）：`data` 不能与 `public/protected/private` 同时出现 —— 固件日志实锤。**
现象：点主页「开始阅读」**完全没反应**。小米运动健康固件日志：

```
[AIOTJS] [jse_dump_obj:788] Error: 页面VM对象中的属性data不可与"public,protected,private"同时存在，
                                   请使用private替换data名称
    at __scriptModule__ (@aiot/game:1691)
```

页面 VM 根本建不起来 → 页面不渲染、按钮无反馈（每次点击重复抛同一错）。
→ 规矩：**每页只用 `protected`**，路由参数与界面状态都放里面，全工程不出现 `data`；`build.js` 加构建前静态检查。
→ **移植到 BlueOS 时此条反转**：BlueOS 用 `data` 作为绑定模型（见 §17.2）。

**坑 5（README 634-661）：写在 `export default` 顶层的「非绑定属性」不保证会出现在页面实例上。**
（与坑 4 同源，属推断，无对应日志）顶层写 `chunkCache: {}` 等字面量可能被丢掉；**纯读取不会补上属性**（只有赋值才会），
于是 `this.chunkCache[...]` → `undefined[...]` → TypeError。同一个文件里 `flags`、`pc` 没事，只因为它们在使用前先赋过值。
→ 规矩：**非绑定状态全部在 `onInit()` 里显式初始化**，读取前兜底（`readChunk` 里那两行 `if (!this.chunkCache) …`）；`build.js` 对顶层字面量告警。

**坑 6（README 663-666）：诊断能力要提前埋好。**
坑 4 能一次定位，靠三样东西：分阶段 `console.log('[GalGod] …')`、**屏上的状态徽标**（而不是全屏遮罩）、`config.logLevel` 不是 `off`。
若当时是“全屏遮罩 + 只弹 toast + 关日志”，只能靠猜。

### 16.1 README 其余必须继承的设计结论（非“坑”但影响移植）

| 结论 | 出处 | 要点 |
|---|---|---|
| 1px = 1 物理像素 | README 190-193 | `designWidth:336` = 物理宽，CSS 直接写像素、不用媒体查询 |
| 分层表 | README 195-221 | 背景/立绘/CG/滤镜/信息条/说话人/底板/正文/▼ 的位置尺寸（与 §8.2 一致） |
| 正文不用滚动 | README 223-225 | 运行时按字号切页，336 小屏上永不出现“文字被截断/句内滚动” |
| 性能与内存 | README 264-271 | 一次只读一块（~12KB）、缓存只留当前+下一块、并发合并、打字机 50ms 时间校正、自动存档 8 次+400ms、400ms 点击锁 |
| 交互表 | README 273-280 | 轻触/长按/≡ 按钮/系统返回 四种操作 |
| 设置项 | README 282-339 | 6 项、滑块 + −/＋ 双保险、快进在菜单不在设置页、自动与快进互斥、slider 受控坑 |
| 关于页与彩蛋 | README 341-373 | wrapText 共用、行高统一 25px、连点 7 次、两个解锁复用 storage |
| CG 拖动 | README 375-414 | 854 宽图 + touchmove + 三条兜底、`object-fit` 必写、根节点不挂 onswipe |
| 全景背景 | README 416-458 | 4 种方案对比、10fps 离散推进、体积代价表 |
| 屏幕常亮 | README 460-474 | features 必声明、try/catch、进页开/出页关、`keepOn` 不能用 `!!` |
| 长列表用 `<list>` | README 505-514 | 条目 86px/字号 24/一屏 4 条、`scrollTo` 定位、`mark` 用空串占位 |
| 章节过滤 | README 516-535 | hide/need 语义与通关判定 |
| CG 满屏 vs 鉴赏 | README 539-560 | `cover` 满屏、底板只改透明度不改位置、解锁判定、缩略图 96×54 |
| 与参考工程的差异 | README 670-687 | 设计宽 212→336、固定视口滚动→运行时分页、背景手搓横移→静态、立绘裁 76%→contain、色数 64→128、`<scroll>`→`<list>`、预设档位→滑块、不依赖自动折行 |
| 验证情况 | README 690-734 | 真机验证项与**仍未验证项**（slider、touchmove 真机派发、背景 10fps、brightness 放行、圆角屏遮挡、120KB JS 解析耗时、高频换图内存） |

---

## 17. Vela → BlueOS 移植风险清单（按严重度排序）

> 格式：**编号 · 风险** → Vela 依赖（文件:行号）→ 后果 → BlueOS 等价方案 → 参考工程/文档先例。
> 先例工程：`galgaoshou`（Vela 同源 galgame 的 BlueOS 移植，466 设计宽，圆屏）、`galgame`（另一 BlueOS galgame，466）。
> 文档：`BlueOS开发文档.md`（各参考工程根目录下的同一份，73.7 万字节）。

### 17.1 【致命】剧本资源用 `.txt` 存 JSON，BlueOS 不会把 `.txt` 打进包

- **Vela 依赖**：`game.ux:478`（`uri:'/common/story/index.txt'`）、`game.ux:647`（`uri: chunk.file` = `/common/story/chunk-000.txt`）、`chapters.ux:77`；`manifest.features` 的 `system.file`。
- **BlueOS 事实**：随包资源**只收 `.json`，`.txt` 不会被打进 rpk**（`galgaoshou/src/common/story/loader.js:10-13` 注释，作者在 vivo WATCH GT 2 实机验证）；运行时 URI 形如 `/common/scn/chunk-000.json`（loader.js:28、69）。
- **后果**：若原样搬运，运行时 `file.readText` 全部失败 → 首屏“读不到剧本索引”，游戏完全不可玩。
- **方案**：两种之一
  1. chunk 与 index 均改 `.json` 扩展名 + `uri:'/common/story/...json'`；
  2. 或把 `index` 编译成 ES 模块（`galgaoshou` 的 `src/common/story/index.js`，被 loader 直接 import），chunk 仍走文件读取。
  推荐 1+2 组合（index 体积仅 4KB，内联成模块可省一次 IO）。
- **先例**：`galgaoshou/src/common/story/loader.js:28,69,122-148`；`galgaoshou/src/common/scn/chunk-000.json`；`galgame/src/common/scn/s0001.json`。

### 17.2 【致命】页面模块声明：`protected` → `data`（并删除 `protected`）

- **Vela 依赖**：7 个页面全部用 `protected`（`game.ux:301`、`index.ux:63`、`saves.ux:81`、`chapters.ux:54`、`cg.ux:188`、`settings.ux:125`、`about.ux:178`），且 `data` 与 `protected` **不可共存**（README 602-632 固件日志）。
- **BlueOS 事实**：绑定模型是 `data`（`galgaoshou/src/pages/Reader/index.ux:97`、`Home/index.ux:26`、`About/index.ux:86`；`galgad/src/pages/Demo/index.ux:5`）。
- **后果**：若保留 `protected`，字段不进入响应式数据 → 界面不更新；若同时写 `data` 与 `protected`，在 BlueOS 上是否报错**未验证**（Vela 必报）。
- **方案**：**统一改成 `data`**，且**路由参数也要在 `data` 里声明**（`galgaoshou/Reader/index.ux:98-100` 注释：“BlueOS 在 data 中声明同名属性接收，统一为字符串”）。
  模板里对 `data` 字段的读取方式不变（`{{field}}`）。
  非绑定状态**不要**放进 `data`（会变成响应式代理，见 17.5）。

### 17.3 【致命】`overflow:hidden` 裁剪容器：背景全景与 CG 拖动两套方案都依赖它

- **Vela 依赖**：
  - `.page{overflow:hidden}`（game.ux:105-112）、`.bgclip{overflow:hidden}`（game.ux:121-122）—— 裁 672 宽背景；
  - `.viewer{overflow:hidden}`（cg.ux:95-96）—— 裁 854 宽 CG；
  - 两处都是“宽图 + left 偏移”方案的**唯一**裁剪手段。
- **BlueOS 事实**：参考工程明确“**不使用** `position: relative / overflow / z-index / 多值圆角**”`（`galgaoshou/src/pages/Reader/index.ux:6`）；
  文档里只检索到 `text-overflow`（`BlueOS开发文档.md:29819`），**没有** CSS `overflow:hidden` 的支持说明。
- **后果**：宽图会整幅铺出去/把页面撑成可横向滚动（Vela 上就是 README 102-104 行描述的现象）；CG 鉴赏“拖动看两侧”失效。
- **方案（需实机验证，按优先级）**：
  1. **预切 + 换 src**：背景按 336 宽切 N 帧（0/4/8/…/336 共 85 帧不现实）→ 改为**按需出 3~5 张不同取景**或直接放弃全景，用单张静态 336×480 `cover`（README 670-687 行的“与参考工程差异”里，参考工程恰恰是“静态 336×480 cover”路线）。
  2. **CG 鉴赏改成分块翻页**：源工程早期正是 `_l/_r` 预切（残留在 `img/c/*_l.png`、`*_r.png`，§14.2），可用 `swiper`（`BlueOS开发文档.md:30224-30339`，含 `swipeTo({index})`）或“点左右半屏换 src”。
  3. 若 BlueOS 的 `overflow:hidden` 实测可用（需在 `galgad` 用最小页面验证），则保留原方案，仅把 `position:relative` 换成页面根 `div` + 全屏 absolute 子层。
- **先例**：`galgaoshou/Reader/index.ux:6,800`（“全屏 absolute 直接子层，避免 position:relative 子树不渲染”）；`galgame` 同样不含 overflow。

### 17.4 【致命】`onswipe` 事件在 BlueOS 不存在

- **Vela 依赖**：根节点 `onswipe="blockSwipe"`（game.ux:4）+ **23 处**子元素 `onswipe`
  （game.ux L15,16,22,23,24,27,30,46,47,48,65,78,79,80,81,82,84,85,88,89,92,93,95；L40 是注释掉的禁用按钮）；
  全工程共 **7 个页面文件、75 处** `onswipe`（含注释：game 25 / cg 11 / settings 11 / about 9 / index 9 / saves 6 / chapters 4）；
  `readDir(e)`（game.ux:288-294）读 `e.direction/e.detail.direction/e.target.direction`；
  `cg.ux` 的 `onswipe="onPanSwipe"`（cg.ux:37）与 `readDir`（cg.ux:178-184）。
- **BlueOS 事实**：文档通用事件表只有 `touchstart/touchmove/touchend/touchcancel/longpress/click` 等（`BlueOS开发文档.md:32787-32790`、`31574-31596`），**没有 swipe**；
  `swiper` 组件的 `enableswipe` 是组件属性，不是页面事件（30271）。
- **后果**：`blockSwipe` 完全不会触发 → “下滑开菜单”失效；同时**失去“吃掉横向手势、防页面被拖走”的保护**。
- **方案**：
  1. 下滑开菜单改用“自算手势”：`ontouchstart` 记 `y0/x0/t0`，`ontouchend` 算 `dy/dx`——**这套代码源工程已写好**（`onHoldStart`/`checkSwipeDown`，game.ux:1050-1125），只需删掉 `onswipe` 处理器即可，逻辑不用重写；
  2. 防横向拖动：BlueOS 页面是否会被横拖**未验证**；若会，用 `$page.setStopGestureQuit(1)`（`BlueOS开发文档.md:20864`）或路由页配置 `followHand:"disable"`（`galgaoshou/src/manifest.json` 的 Reader 页）。
- **先例**：`galgaoshou/Reader/index.ux:798` 用全屏 `input-layer` + `@click`/`@longpress` 接管点击与长按，不依赖 swipe。

### 17.5 【严重】顶层字面量状态 + 大数组的响应式代理

- **Vela 依赖**：坑 5（README 634-661）——顶层字面量属性可能丢；`onInit()` 里显式初始化 + 读前兜底（game.ux:629-630）。
- **BlueOS 事实**：`data` 里的对象是响应式代理，**大数组被深度劫持会非常慢/占内存**；
  参考工程用 **`markRaw`** 包裹解析出的剧情块（`galgaoshou/src/common/story/loader.js:13-14,39-45`；`galgame/src/pages/index.ux:63` 有同样的 `markRaw` 兜底函数），
  并把会话态放在**模块级普通对象** `st`（`galgaoshou/Reader/index.ux:54-70`），不进 `data`。
- **后果**：把 128 个节点的 chunk 塞进 `data` 会明显卡顿；把 `hist`（最多 60 份存档快照）塞进 `data` 更糟。
- **方案**：**只有模板真正绑定的字段进 `data`**（`l0..l5/s0..s5/bgSrc/spL/spC/spR/cgSrc/tint/speaker/canTap/choices/menu/endText/badge/chapterTitle/progress/uiHidden/autoOn/fastOn`），
  其余（`story/pc/flags/chunk*/pages/rawText/pageIdx/typing*/timers/hist/settings/seen*/csRaw/bgOffset`）放**模块级对象**或页面实例的普通属性（非 `data`）；
  chunk 数组用 `markRaw`。

### 17.6 【严重】定时器必须“字面 token 配对清理”，且页面销毁必须清

- **Vela 依赖**：`this.timer = setTimeout(...)` + `clearTimeout(this.timer)` 等 9 个定时器（§8.20）；`onDestroy` 里清（game.ux:433-445）。
- **BlueOS 事实**：文档强制“所有 `setTimeout/setInterval` 创建的计时器，必须在页面销毁时通过 `clearTimeout/clearInterval` 匹配清除”（`BlueOS开发文档.md:23198`）；
  IDE 的 feature-api 检查**按字面 token 配对**：必须 `const timer = setTimeout(...)` + `clearTimeout(timer)` 才通过（`galgaoshou/Reader/index.ux:72-89`）。
- **后果**：`this.xxx = setTimeout(...)` 这种写法可能过不了 IDE 检查；漏清 → 页面销毁后回调仍触发（操作已销毁实例）。
- **方案**：统一 `armTimer(holder, key, handler, delay)` / `disarmTimer(holder, key)` 两个函数收口（照抄 `galgaoshou/Reader/index.ux:77-89`），
  定时器 id 存模块级 `st` 对象；`onHide/onDestroy` 全部 `disarm`。
  另外源工程**重复的 `onHide`**（game.ux:421 与 428，后者覆盖前者）必须合并（见 §8.6）。

### 17.7 【严重】`<slider>` 受控组件坑 + 事件字段未知

- **Vela 依赖**：`settings.ux:10/17/24` 的 `<slider value="{{sizeIni}}" onchange="onSize">`；`value` **只绑初值**（注释 126-128）；
  滑块上**不能挂 onswipe**；`readSlider()`（202-228）专门把事件里所有数字字段挖出来打到屏上（`dbg`）与 console。
- **BlueOS 事实**：`slider` 组件存在（`BlueOS开发文档.md:32052,32260`）；参考工程 `galgaoshou/Settings/index.ux` 用的是“档位/按钮”而非滑块（`galgaoshou` 的 `reader-settings.js` 里 `autoPlaySpeed` 是三档字符串 `slow/medium/fast`）。
- **后果**：BlueOS 的 slider 事件负载结构**未验证**；若绑实时值可能同样被弹回。
- **方案**：保留“初值字段 + 实时值字段”双轨与 `readSlider` 探针；**必须保留 −／＋ 步进按钮**（普通 `div`+点击，不依赖 slider）（`settings.ux:265-270`）；
  在目标端把 `readSlider` 挖到的字段名打进 `console.log` 供实机核对。若 BlueOS slider 不好用，直接降级成“−／＋ + 5 档预设”（参考工程做法）。

### 17.8 【严重】`@system.brightness.setKeepScreenOn` 换 API + features

- **Vela 依赖**：`game.ux:203` `import brightness from '@system.brightness'`；`setKeepScreenOn({keepScreenOn})`（game.ux:957-963）；`manifest.features` 必须声明 `system.brightness`。
- **BlueOS 事实**：`brightness.setKeepScreenOn({keepScreenOn:Boolean})` 存在于 `@blueos.hardware.display.brightness`，
  需要 `features: [{"name":"blueos.hardware.display.brightness"}]`（`BlueOS开发文档.md:7155,7168,7177,7375-7410`）。
- **后果**：按 Vela 写法 import 会失败（模块不存在）；`features` 不声明则调用失败。
- **方案**：改 `import brightness from '@blueos.hardware.display.brightness'`，manifest 加 feature；
  保留 `try/catch`（源工程已包）。**参考工程两个都没用这个能力**，需实机验证是否放行（源 README 也把它列为未验证项）。

### 17.9 【严重】全部 `@system.*` import 与 manifest features 的映射表

| 源（Vela） | 使用位置 | 目标（BlueOS） | manifest feature |
|---|---|---|---|
| `import router from '@system.router'` | game.ux:199、index.ux:58、saves.ux:71、chapters.ux:46、cg.ux:142、settings.ux:114、about.ux:83 | `@blueos.app.appmanager.router` | `blueos.app.appmanager.router`（`galgaoshou/Reader/index.ux:20`；文档 `@blueos...`） |
| `import storage from '@system.storage'` | reader.js:4、game.ux:200、saves.ux:73 | `@blueos.storage.storage` | `blueos.storage.storage`（`galgaoshou/Reader/index.ux:21`） |
| `import file from '@system.file'` | game.ux:202、chapters.ux:47 | `@blueos.storage.file` | `blueos.storage.file`（`galgaoshou/src/common/story/loader.js:25`） |
| `import prompt from '@system.prompt'` | game.ux:201、saves.ux:72、settings.ux:115、cg.ux:143、about.ux:84 | `@blueos.window.prompt` | `blueos.window.prompt`（`galgaoshou/Reader/index.ux:22`） |
| `import brightness from '@system.brightness'` | game.ux:203 | `@blueos.hardware.display.brightness` | `blueos.hardware.display.brightness` |
| `this.$app.exit()` | game.ux:1251、index.ux:91 | `this.$app.exit()`（**同名，无需改**） | `blueos.app.app`（文档 20846；`galgaoshou/Home/index.ux:105`） |

> `manifest.json` 的 `features` 是**能力白名单**：漏一个，对应 API 调用失败。
> 目标 `galgad/src/manifest.json` 在分析开工时**只有** `blueos.app.appmanager.router`；移植中已补齐其余 5 个
> （`blueos.storage.storage`、`blueos.storage.file`、`blueos.window.prompt`、`blueos.hardware.display.brightness`、`blueos.app.app`）。
> 仍需注意：`manifest.config` 里的 `logLevel` 是 Vela 字段，BlueOS 是否忽略不影响运行。

### 17.10 【严重】路由写法的差异（uri 前导斜杠 / 目录命名 / 页面配置）

| 差异 | Vela | BlueOS | 证据 |
|---|---|---|---|
| uri 前导斜杠 | `'pages/game'` | **`'/pages/Reader'`** | `galgaoshou/Home/index.ux:82,89`；`galgad/Demo/index.ux:14` |
| 页面目录命名 | `pages/game/game.ux`（组件名=目录名） | `pages/Reader/index.ux`（组件名 `index`） | `galgaoshou/src/manifest.json` routers；`galgad/src/manifest.json` |
| `router.replace` | 支持 | 支持（`galgaoshou/Reader/index.ux:632`、`galgame/src/pages/index.ux:873`） | — |
| 页面配置项 | 无 | 可在 manifest 的页面上配 `followHand:"disable"`、`launchMode:"singleTask"`（`galgaoshou/src/manifest.json` 的 `pages/Reader`） | `BlueOS开发文档.md:20518` |

- **后果**：uri 写错 → 跳转黑屏/无反应（无编译期报错）。
- **方案**：7 个页面全部重命名目录为 `Home/Reader/Saves/Chapters/Cg/Settings/About` 或保留小写但统一 + 所有 `router.*` 的 uri 加前导斜杠；
  阅读页建议配 `followHand:"disable"`（否则右滑返回手势会和“右滑快退”冲突）+ `launchMode:"singleTask"`（防重复栈）。

### 17.11 【严重】返回手势：`onBackPress` 的生效前提不同

- **Vela 依赖**：`game.ux:446-451` `onBackPress()` **永远返回 true**（返回键只开关菜单，永不退出页面）。
- **BlueOS 事实**：`onBackPress` 存在（`BlueOS开发文档.md:2261-2290`；`galgaoshou/Reader/index.ux:242-252` 用法一致：`return true` 消费）。
  **但**：`onBackPress` 只在页面配置了 `followHand:"disable"` 时生效（`BlueOS开发文档.md:2265`：“只有当前页面配置了 followHand : disable，该接口才生效”）。
  另有 `this.$page.setStopGestureQuit(1)` 可直接屏蔽手势返回（文档 20864）。
- **后果**：不配 `followHand` → 返回手势直接退页，“返回键开菜单”的交互完全消失（且正在读的进度靠 `onHide` 落盘——而 `onHide` 有 bug，见 17.6）。
- **方案**：阅读页 manifest 配 `followHand:"disable"`；`onBackPress` 逻辑照搬；`onDestroy` 里补落盘。

### 17.12 【严重】`<list>` 的 `scrollTo` / `$nextTick` / `$element` 可用性

- **Vela 依赖**：`chapters.ux:110-119` —— `this.$nextTick(() => this.$element('chap-list').scrollTo({index, behavior:'instant'}))`。
- **BlueOS 事实**：`$element` 存在（文档 20818）；`$nextTick` **未在文档检索到**；
  参考工程明确“**BlueOS scroll 无 scrollTo**”（`galgaoshou/src/common/story/paginate.js:4`、`Reader/index.ux:8`）。
  `<list>` 存在（文档 22011-22066），但**是否支持 `scrollTo` 未验证**。
- **后果**：章节页“自动滚到上次读到的章节”可能静默失效（有 `try/catch` 与 `typeof el.scrollTo === 'function'` 判断，不会崩）。
- **方案**：优先保留（有防御）；若不可用，用“首屏只渲染当前章附近”或“`swiper` 定位”（文档 30330 `swipeTo`）。

### 17.13 【中】触摸坐标字段与手势语义

- **Vela 依赖**：`readX/readY` 多字段兜底（game.ux:254-281、cg.ux:164-176）；`onlongpress` **只在识别时触发一次、没有松手事件**（game.ux:1047-1049 注释）→ 所以“长按快进”只能自己计时（`onHoldStart`/`onHoldEnd`）。
- **BlueOS 事实**：`TouchEvent` 有文档：`type/touches/changedTouches/targetTouches`，触摸点含 `clientX/clientY/pageX/pageY` 等（`BlueOS开发文档.md:32800-32830`、`31574-31596`）；`longpress` 事件存在（文档 32792）。
- **方案**：保留兜底读取（成本低、可防字段差异）；**长按快进仍用自己计时的方案**（跨平台一致，且 BlueOS 的 longpress 是否有“松手”事件同样未验证）。

### 17.14 【中】`object-fit` 必须显式写

- **Vela 依赖**：`.layer`（game.ux:114）、`.bgwide`（game.ux:123-124）、`.big`（cg.ux:99-100）都显式 `object-fit`；README 坑（396-405）：“`<image>` 不写 object-fit 会按原始尺寸画，只占左侧一块”。
- **BlueOS 事实**：`<image>` 的 `object-fit` 支持 `contain/cover/fill/none/scale-down`，**默认 `cover`**（`BlueOS开发文档.md:28420`）。
- **方案**：**逐条保留**（默认值虽不同，但显式写最安全）；移植后仍需回归“CG 只占左边一块”这个坑。

### 17.15 【中】`position: relative` / `z-index` / `多值 border-radius` / `text-shadow` 的可移植性

- **Vela 依赖**：`.page{position:relative}`（game.ux:110、index.ux:26…）；`.name{text-shadow:0 1px 3px rgba(0,0,0,0.9)}`（game.ux:163）；全部 `border-radius` 都是**单值**（13/26/9/12/18/20/16/3/21/17/14/15/8）。
- **BlueOS 事实**：`position: absolute` **可用**（`galgaoshou/Reader/index.ux:884-937` 的 `.char{position:absolute}` + `left/bottom/width/height`）；
  但参考工程**明确避免** `position:relative`、`z-index`、多值圆角（`Reader/index.ux:6`）；`text-shadow` 在文档中未检索到。
- **方案**：根节点不写 `position:relative`，改用“页面根 `div` + 全屏 `absolute` 子层”（`galgaoshou/Reader/index.ux:800` 注释）；
  层级靠 **DOM 顺序**（源工程本来就没用 z-index，§8.1 的顺序可直接继承）；
  名牌的 `text-shadow` 可删（有 `rgba` 底板兜底）；
  圆角统一单值（源码本来就都是单值，保持即可）。

### 17.16 【中】分辨率/几何：336×480 → 466 设计宽（**所有数值必须重算**）

- **Vela 依赖**：`designWidth:336`、1px=1 物理像素（README 190-193）；全部几何常量（§8.2/§8.3）。
- **BlueOS 目标**：`galgad` 的 `designWidth` 是 **466**，`deviceTypeList:["watch","watch-square"]`（`galgad/src/manifest.json`）；参考工程同样是 466（`galgaoshou/src/manifest.json`），
  且用 `$size-factor: 5px` 做 SCSS 单位（`galgad/src/assets/styles/variables.scss:9`，例：`font-size: 7 * $size-factor`）。
- **后果**：直接照搬 336 的坐标会在 466 画布上挤在左上角；`IMG` 的 672/854 宽素材与 466 屏也不匹配（672-466=206 可平移；854-466=388）；
  `layer()` 的 `cpl/lpp`（由 `TEXT_BOX_W/TEXT_BOX_H/size` 推出）全部变化 → 每页字数/行数变化 → **分页结果变化**（必须重跑等价测试）。
- **方案**：
  1. 先定“内容区”，再等比放大：466/336 = **1.3869**；若等比，字号 20 → 27.7（不建议直接用小数，需取整后重跑分页校验）；
  2. 背景可改 `BG_W=466`（不平移）或 `BG_W=932`（2 屏宽，可平移 466）——但**必须重新出图**（`gen_assets.py` 的 `BG_W`/`SCREEN_W/H`/`SPRITE_W/H`/`CG_W` 全要改）；
  3. CG 若保留“宽图拖动”，`CG_W` 应按 16:9 或原图宽高比重新定（源 854×480 是为 336×480 屏设计的），且 `CG_PAN_RANGE = CG_W - 466`；
  4. 若目标设备是圆屏（`galgad` 当前没有 `watch-round`，参考工程有），需额外处理圆角裁切：参考工程运行时判 `this.$device.deviceType` 选 `layoutClass`（`galgaoshou/Reader/index.ux:10,91-94`），左右各留 10~14px（源 README 第 729 行也是这个结论）。
- **先例**：`galgaoshou/Reader/index.ux:5-10`（466 显式宽度、圆/方屏运行时判定）；`galgaoshou/src/pages/Reader/index.ux:883-937`（立绘三档槽位在 466 画布上的 `left/bottom/width/height` 实测值：单人中 140/466 宽 186；双人 46 与 248 宽 172；三人 26/157/288 宽 152）。

### 17.17 【中】`opacity` 禁用（两边一致，但源工程有 0 处 opacity 要确认）

- **Vela 依赖**：坑 3（README 578-600）——有子节点的容器用 `opacity` 会渲染成横向条纹。
- **事实**：源工程**已经全部改成 `rgba()`**——全工程 grep `opacity` 只命中 3 行**注释**（game.ux:133-134、index.ux:28），
  **没有任何 `opacity:` 声明**。
- **方案**：移植时**继续保持零 `opacity`**；BlueOS 是否同样有该 bug 未验证，但没有理由冒险（`rgba` 语义等价）。

### 17.18 【中】快进（fast）不持久化 / 自动播放互斥的隐藏约定

- **Vela 依赖**：`reader.js:134-141`（`saveSettings` 删除 `fast`）、`reader.js:44-45`（`normalizeSettings` 强制 `fast=false`）；
  `game.ux:1085`（`setFast(true)` 时 `autoMs=0`）、`game.ux:1201`（开自动时 `fast=false`）、`game.ux:1214`（开快进时 `autoMs=0`）；`settings.ux:248/261`（同理）。
- **后果**：若移植时“顺手把 fast 也存进 settings”，会出现“退出时开着快进，下次进来狂翻剧情”（README 第 136-137 行明确说过这个真机反馈）。
- **方案**：原样保留三条互斥与“不持久化”。

### 17.19 【中】`data` 里不能放函数/undefined；`if`/`for`/`tid` 指令

- **Vela 依赖**：`if="{{...}}"`（全工程）、`for="{{rows}}"` + `tid="cid"` + `$idx`/`$item`（game.ux:65、saves.ux:7、cg.ux:9、chapters.ux:7、about.ux:9、settings.ux:29,35）。
- **BlueOS 事实**：`for="{{ rows }}"` + `$idx` + `tid` **同样可用**（`galgaoshou/Reader/index.ux:833` 用 `for`+`$idx`；`galgaoshou/Saves/index.ux:16` 用 `tid="slot"`）；
  `if="{{ ... }}"` 同样可用（`galgaoshou/Reader/index.ux:800`）。
- **差异**：事件绑定写法 —— 参考工程用 **`@click` / `@longpress`**（`galgaoshou/Reader/index.ux:798-800`），
  而 `galgad` 模板示例用 **`onclick="handler"`**（`galgad/src/pages/Demo/index.ux:27`）。
  两种都能编译（说明 BlueOS 兼容 Vela 式属性绑定），但**必须选一种并全工程统一**，不要混用。
- **方案**：保留 `if`/`for`/`tid`/`$idx`/`$item` 不变；事件统一（推荐沿用 `onclick` 以便最小改动，若 IDE 报错再切 `@click`）。

### 17.20 【中】CG 打开位置与注释/README 不一致（行为差异，不是平台差异）

- **事实**：`showPage()` 传 `setPan(CG_PAN_RANGE/2) = 259`（cg.ux:262），而 `setPan` 把正数夹到 0（cg.ux:267），
  所以实际是**最左端**；注释（cg.ux:261）与 README（393 行）说“停在正中间”。
- **方案**：二选一并写入验收标准：
  - 忠于**代码行为**：保持最左端；
  - 忠于**文字意图**：改成 `setPan(-CG_PAN_RANGE/2)`（视觉上居中）。
  建议选后者并记录为“已修复的注释/实现不一致”。

### 17.21 【中】纯色背景（bg=-1/-2）用 DOM 色块而非图片

- **Vela 依赖**：`.solid`/`.solid-white`（game.ux:18-19、125-126）+ `showBlack/showWhite`。
- **BlueOS**：普通 `div` + `background-color` 可用（参考工程大量使用）。
- **方案**：原样保留（这是最省事的一层）。

### 17.22 【低】`lines: 1`（文本最大行数）

- **Vela 依赖**：`.ln{lines:1}`（game.ux:168）、`.nm/.card-name/.card-info`（chapters/saves/cg/about 多处 `lines:1`）。
- **BlueOS**：`lines` 属性存在（`BlueOS开发文档.md:21676` 示例 `lines: 2;`），配合 `text-overflow: ellipsis` 使用（文档 29819）。
- **方案**：保留 `lines:1`；需要省略号的列表项加 `text-overflow: ellipsis`。

### 17.23 【低】`text` 用 `padding + background-color + border-radius` 做“自适应宽度名牌”

- **Vela 依赖**：`.name`（game.ux:160-163）。
- **BlueOS**：`<text>` 是否支持 `padding`/`background-color` 未验证（参考工程的文本容器都用 `div` 包裹）。
- **方案**：若 `<text>` 不支持，改成 `<div class="name-plate"><text class="name">…</text></div>`，但**自适应宽度**会丢失（变固定宽）。
  折中：按说话人字数动态算宽度（`width = 20 + 字数*20`，源工程字号 20px），或直接固定 120px 宽（源工程最长的说话人 5 字）。

### 17.24 【低】`console.log` 与诊断徽标

- **Vela 依赖**：`config.logLevel:"log"`（manifest）；`log()/fail()` 写 `badge` 与 `console.log('[GalGod] …')`（game.ux:454-464）；看门狗 8s（397-402）。
- **BlueOS**：无 `logLevel` 配置；`console.log` 可用（参考工程大量使用）。
- **方案**：保留 `badge` + `console.log` + 看门狗（这是源码作者强调的“诊断三件套”，见坑 6）。

### 17.25 【低】`$app.exit()` 与“主页/退出”语义

- `this.$app.exit()` 在 BlueOS 存在（文档 20846；`galgaoshou/Home/index.ux:105`），**无需改动**。
- 但 Vela 的 `router.replace` 到首页是否清栈，BlueOS 行为未验证 → 阅读页 `goHome()` 用 `replace`（game.ux:1250），若 BlueOS 不栈清，建议改 `router.clear()/back` 组合或 `launchMode:"singleTask"`。

### 17.26 【提示】性能预算

- 源工程：单页 `game.js` debug 未压缩约 120KB（README 第 730 行，未真机验证解析耗时）；chunk 每块 5–15KB；图片 7.1MB。
- 参考工程的经验（`galgaoshou/loader.js:1-14`）：**把 36 个分块内联进页面 JS 会让单页 1.78MB，进阅读页卡死重启**；所以 BlueOS 上同样必须“外置 + 按需读”。
- 目标端预算未知；建议沿用“一次 1 块 + 当前/下一块 LRU + markRaw”。

### 17.27 【提示】104 个残留文件不要带进目标包

见 §14.2。搬运资源时按 `IMG` 的 138 个无后缀文件白名单拷贝，别整目录复制。

### 17.28 风险清单速查（按“必须动手”的程度）

| 序 | 风险 | 必须做的事 | 难度 |
|---|---|---|---|
| 1 | `.txt` 不进包 | chunk/index 改 `.json`（或 index 改模块） | 低（改扩展名+uri） |
| 2 | `protected`→`data` | 7 页改声明，路由参数进 `data` | 低 |
| 3 | `overflow:hidden` 不可用 | 重新设计背景/CG 取景方案（或先验证可用） | **高** |
| 4 | `onswipe` 不存在 | 删处理器，下滑改用 `onHoldStart/checkSwipeDown` | 低（代码已有） |
| 5 | 大数组响应式 | 状态外置 + `markRaw` | 中 |
| 6 | 定时器 token 配对 | `armTimer/disarmTimer` 收口 + 合并重复 `onHide` | 低 |
| 7 | slider 受控 | 保留初值双轨 + 步进兜底 | 低 |
| 8 | brightness | 换 API + feature | 低 |
| 9 | `@system.*` | 6 个 import + 5 个 feature | 低 |
| 10 | 路由 | 加前导斜杠、页面目录、`followHand` | 低 |
| 11 | `onBackPress` | 配 `followHand:"disable"` | 低 |
| 12 | list.scrollTo | 保留防御/降级 | 低 |
| 13 | 触摸坐标 | 保留兜底 | 低 |
| 14 | `object-fit` | 逐条保留 | 低 |
| 15 | position/z-index | 根节点不用 relative、靠 DOM 顺序 | 中 |
| 16 | 分辨率 466 | **全部几何/图片重算** | **高** |
| 17 | opacity | 保持零 opacity | 低 |
| 18 | fast 不持久化 | 原样 | 低 |
| 19 | 事件绑定写法 | 全工程统一 | 低 |
| 20 | CG 初始位置 | 决定并记录 | 低 |
| 21 | 纯色背景 | 原样 | 低 |
| 22 | `lines:1` | 原样 | 低 |
| 23 | 名牌 padding | 视 `<text>` 支持情况降级 | 中 |
| 24 | 日志/徽标 | 保留 | 低 |
| 25 | `$app.exit` | 原样 | 低 |
| 26 | 性能 | 外置+LRU | 低 |
| 27 | 残留文件 | 白名单拷贝 | 低 |

---

## 18. 移植必须保持的不变量（验收清单）

以下数值/语义若不保持，就不算“零信息损失”。

### 18.1 内容不变量

1. 5569 节点、44 分块（128/块，末块 65）、18 章节（14 正片 + 3 隐藏结局 + 1 需通关后日谈）。
2. 节点类型计数：`s 5457 / o 15 / j 65 / cj 4 / f 13 / sf 13 / e 2`。
3. 台词逐字（119,410 字，含 172 处 `\n`）、说话人逐字（24 种）、说话人的空串=旁白。
4. 15 个选择点、53 个选项、逐字文本、逐字节目标、唯一条件选项 `["true_end_flag",">=",4]`。
5. 三个 flag（`true_end_flag` ≤4、`bad_end_flag` ≤9、`true_end_finish`=1）的累加/判定点（`bad_end_flag>=7`、`true_end_finish==1`）与后果（Bad End / 后日谈）。
6. 图片：38 背景 + 55 立绘 + 34 CG + 9 缩略图 + home + icon，共 138 张；`IMG` 下标顺序**必须保持**（剧本里存的是整数下标，改顺序=全剧错图）。
7. CG 鉴赏 9 组的 `n/th/u/im` 逐字，解锁判据是 `u`（不是 `im[0]`），`about` 全解锁写入 32 个下标。
8. 关于页 `ABOUT` 37 项与 `FISH_LINES` 30 条逐字；版本号显示 `2.5.2`。

### 18.2 语义不变量

1. `bg` 隐式清立绘（86 处）；`cs:[]` 清立绘（30 处）；`cg:-1` 隐藏 CG（6 处）；`tint:''` 关滤镜。
2. 视觉增量继承：节点缺字段 = 沿用上一状态；`s/o/e` 终止型，`f/sf/j` 继续循环。
3. 分页公式 `cpl=floor((TEXT_BOX_W-TEXT_PAD)/size)`、`lpp=min(MAX_LINES, floor(TEXT_BOX_H/(size+4)))`、断行优先标点（回退 8 字符）。
4. 打字机 50ms 校正、`speed=0`/`fast` 立即显示、`canTap` 仅在整页显示完为 true。
5. 自动播放 `700+字数*autoMs` 夹 `[1200,12000]`；快进 220ms；二者互斥；`fast` 不持久化。
6. 400ms 点击锁；下滑开菜单；右滑退一句；菜单“快退”180ms 连退；快退栈 60。
7. 自动存档：每 8 次推进 + 400ms 去抖；`pc=0` 不存；`onHide/onDestroy/结局/回主页/退出` 强制落盘。
8. CG 解锁：播放到 CG 节点即 `markSeen`，500ms 去抖写 `cgSeen`。
9. 通关判定：`flags.true_end_finish === 1` → 写 `cleared`。
10. 章节跳转过滤：`hide` 永不显示、`need` 需 `cleared`。
11. 进度显示：`min(99, round((pc-start)/(nextStart-start)*100))%`。
12. 看门狗 8s；`badge` 文案表（§8.21）。

### 18.3 交互不变量

1. 轻触：未打完→立刻全显；本页有后续→下一页；否则下一句；结局页→回标题。
2. 长按：按 `longpress` 设置三态（`hide` 切 UI / `fast` 按住快进 / `off` 无）。
3. 返回手势：开/关菜单，永不退出页面。
4. 菜单 12 个入口与文案（§8.17）。
5. 主页 8 个入口与文案；存档页 7 行 + 长按删除确认；章节页过滤 + `▶` 标记；CG 页未解锁 `?` + toast。

---

## 附录 A：storage JSON 样例（可直接用于回归对比）

```jsonc
// key = "settings"
{"size":20,"speed":28,"autoMs":0,"keepOn":true,"longpress":"off"}   // 注意：无 fast 字段（saveSettings 会删）

// key = "autoSave"
{"magic":"galgod-band-1","pc":1234,"chapter":7,
 "flags":{"true_end_flag":2,"bad_end_flag":1,"quick_menu":1,"custom_ui":1},
 "bgSrc":"/common/img/b/street1_1.png","showBlack":false,"showWhite":false,
 "cs":[{"k":"lx","i":62,"s":"c"}],
 "cgSrc":"","tint":"","text":"哟，舟子，早上好~","at":1760000000000}

// key = "saves"（长度 6，未用槽位为 null）
[ {"magic":"galgod-band-1","pc":…,…}, null, null, null, null, null ]

// key = "cgSeen"
[108,109,110,93,94,95]

// key = "cleared"
{"ok":1,"at":1760000000000}

// key = "pendingSave"（只在 game→saves(mode=save) 之间短暂存在，saves 页读到即删）
{ "magic":"galgod-band-1", "pc":…, … }   // 与 autoSave 同构
```

## 附录 B：全 UI 文案汇总（移植时可直接照抄）

**页面标题**：主页无标题（图内含）；`CG 鉴赏`；`章节选择`；`保存进度`/`读取进度`；`设置`；`关于`；正文页无标题（HUD 显示章节名）。

**主页**：`最近进度 · 第N章` / `还没有存档，从序章开始吧`；`开始阅读`、`继续阅读`、`存档`、`章节`、`CG`、`设置`、`关于`、`退出`。

**正文页**：`▼`；`阅读菜单`；`{章节} · {进度}`；`继续阅读`、`保存进度`、`读取存档`、`自动播放：开/关`、`快进：开/关`、`下一章`、`快退`、`章节`、`CG`、`设置`、`主页`、`退出`；结局页 `{endText}` + `轻触返回标题`。

**存档页**：`点按覆盖 · 长按删除` / `点按读取 · 长按删除`；`自动存档`、`存档 1..6`；`（空）`；标签 `自动`/`读取`/`覆盖`/`空`；`第N章 · {预览≤12字}…`；`删除存档？`、`此操作无法撤销`、`取消`、`删除`、`返回`。
toast：`自动存档不可覆盖`、`暂无自动存档`、`没有可保存的进度`、`已保存到存档 N`、`保存失败`、`该存档为空`、`自动存档不可删除`。

**章节页**：`共 {count} 章 · 上下滑动 · 点按开始`、`▶`（当前章）、`返回`；异常行 `剧本索引损坏` / `读取剧本索引失败`。

**CG 页**：`已解锁 {openCount} / {total} 组 · 点按查看`；`未解锁`、`{n} 张`、`?`；`关闭`、`按住画面左右拖动，看被裁掉的部分`、`换一张差分`、`{pageNo} / {pageAll}`、`返回`；toast：`还没在剧情里看到这一组`。

**设置页**：`字体大小`、`播放速度`、`自动播放速度`、`屏幕常亮`、`长按屏幕`；值显示：`{n}` / `瞬间` / `关闭`；药丸：`关`/`开`、`隐藏`/`快进`/`关闭`；
提示：`字号 14~30 px，显示的数字就是 px`、`播放速度＝每字毫秒；自动播放＝每句停留毫秒。长按选「快进」时是按住才快进`；
预览：`林曦` / `想成为Galgame领域大神！！！`；`重置`、`返回`；toast：`已恢复默认设置`。

**关于页**：`关于`（可连点 7 次）、`{dots}`、`GalGod · 小米手环 9 Pro 版 · v2.5.2`、`返回`；
彩蛋面板：`？？？`、`解锁 · 后日谈`、`解锁 · 全部 CG`、`小鱼干`、`关闭`；toast：`已解锁「后日谈 · 诺提拉」`、`已解锁全部 CG（32 张）`。
彩蛋小剧场：`{fishName}` / `{fishText}` / `{i+1} / 30`。

## 附录 C：源工程中属于「死代码/残留」的部分（移植时可丢弃，但要知道为什么）

| 项 | 位置 | 说明 |
|---|---|---|
| `.menu-btn` 菜单按钮 | game.ux:40-42（`if="{{false}}"`）+ 样式 146-148 | 已禁用，改用“下滑开菜单”。保留代码以便恢复。移植时若要按钮可改回 `{{!uiHidden && !endText}}` |
| 重复的 `onHide()` | game.ux:421 与 428 | 后者覆盖前者（见 §8.6），前者是死代码，但**其功能（清定时器/关常亮/落盘）必须合并保留** |
| `BG` 表 / `SP` 表 | assets.js:134-234 | 运行时无 import，仅供人看/工具核对。移植时保留（便于校验），但可只留 `IMG` |
| `img/b/*_r.png`、`img/c/*_l.png`、`img/c/*_r.png` | 106 个文件 4.53MB | 历史残留，不在 `IMG` 里、不在 rpk 里（§14.2） |
| `interlude-interview` 章节标题 | gen_story.py:62 | `CHAPTER_TITLES` 里有但没被 `MAIN`/`LABEL_FILE` 使用，**不会产生章节**（所以 18 章而非 19 章） |
| `img/b/*_r` 对应的“背景图块”方案 | 无代码引用 | test_paginate.js:157-163 断言禁止 `swiper`/`bgsw`/`bgslide`/`buildBgFrames`/`startBgSwap`/`BG_TILE_COUNT` 复活 |
| `.btn-half/.btn-third/.btn-quarter` | index.ux:51-53 | 定义了但主页只用 `.btn-5`（46px） |
| `readY/readX` 的 `pageY/pageX` 分支 | game.ux:262-263、277-278 | 某些固件字段；移植后可保留（兜底成本低） |
| `p`（预分页）节点字段 | gen_story.py:10 文档 | 旧版格式，现行数据里**不存在** `p` 字段（实测 0 处） |

---

## 附录 D：本次分析用到的核对命令（可在目标工程复现同类校验）

```powershell
# 1) 节点类型/字段分布/样例（Python）
#    读 index.txt → 逐 chunk JSON.parse → Counter(t) / 字段组合 / 样例
# 2) 图片尺寸与体积（Pillow）
python -c "from PIL import Image;im=Image.open('img/b/classroom1.png');print(im.size,im.mode)"
# 3) 分页/几何一致性（源工程自带，Node）
node tools/test_paginate.js
# 4) 剧本完整性/可达性（Python）
python tools/validate_story.py .
# 5) 剧情流程（Python）
python tools/simulate.py .
```

> 移植后建议在目标工程复刻 3 个等价检查：
> ① 分页（字号区间 × 全台词，不超行/不超页/不丢字/不压提示）；
> ② 剧本（分块连续、引用不越界、全图可达 = 5569/5569）；
> ③ 流程（8 种策略全部正常收尾、至少 3 个结局章可达、单周目不串结局）。

---

**文档结束。**
（本文所有数值/行号均来自对源工程的实际阅读与统计，未修改源工程与目标工程 `src/`；分析产物仅本文件。）


