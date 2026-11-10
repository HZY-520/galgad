# GalGod · vivo 蓝河（BlueOS）移植验证报告

- **工程**：`C:\Users\Administrator\BlueOSProjects\galgad`
- **移植对象**：`mcpotato1123/galgod-band`（GalGod 2.5.2，小米手环 9 Pro / Vela 快应用）
- **目标平台**：vivo 蓝河 BlueOS 手表（圆屏 466×466 / 方屏 432×514，`designWidth=466`）
- **验收时间**：2026-11-09
- **结论**：**通过**。`npm run verify`（静态校验 + 引擎/分页逻辑测试 + watch-round / watch-square
  官方 `blueos-pack` 整包构建 + rpk 内容断言）**exit 0，全部 PASS，无 `[ERROR]`**。

一键复跑：

```bash
cd C:\Users\Administrator\BlueOSProjects\galgad
npm run check     # lint + methods + validate-story + validate-pages + test-engine + test-reader + test-game-page
npm run verify    # check + watch-round/watch-square 构建 + rpk 内容断言
```

完整输出：`scripts/reports/verify-final.log`；构建日志/摘要：`scripts/reports/build/`。

---

## 1. 环境

| 项 | 值 |
| --- | --- |
| BlueOS Studio 打包器 | `D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js` |
| blueos-pack / vite / node | `1.0.12-beta.13` / `5.4.21` / `v24.21.0`（commit `7a50283d`） |
| 构建命令（官方） | `node <packer> build --device-type watch-round\|watch-square -f`（dev 阶段、不签名） |
| 资源流水线 | Python 3 + Pillow（`tools/gen_assets.py`，可用捆绑解释器） |
| 设备类型 | `watch-round`、`watch-square`（manifest `deviceTypeList`） |

> 重要结论（本次排障确认）：**`blueos-pack build --debug` 是 IDE 快速预览模式，只编译入口页**
> （反编译 `dist/index.cjs` 证实：`globalConfig.debug` 为真时 entries 只保留
> `entry+'/index'` 与 `app`）。因此本工程 `tools/build.mjs --debug` 走 `build` 子命令但
> **不透传** packer 的 `--debug`，产出包含全部 7 页的 dev 整包；需要 entry-only 预览包时用
> `--entry-only`（不作为验收依据）。

## 2. 内容完整性

| 指标 | 源工程 | 本移植 | 结果 |
| --- | --- | --- | --- |
| 剧本节点 | 5569 | 5569 | ✅ |
| 分块 | 44（chunkSize 128，末块 65） | 44 | ✅ |
| 章节 | 18（14 正片 + 3 `hide` 结局 + 1 `need` 后日谈） | 18 | ✅ |
| 台词句 | 5457 | 5457 | ✅ |
| 节点类型 | s=5457 o=15 e=2 f=13 sf=13 j=65 cj=4 | 一致 | ✅ |
| 图片索引 | 127（38 背景 + 55 立绘 + 34 CG） | 127 项且文件全部存在 | ✅ |
| CG 鉴赏 | 9 组 / 32 张差分 / 9 缩略图 | 9 组（`cglist.js`） | ✅ |
| 结局 | Bad End + 真结局 + 2 普通结局 | 4 个全部可达（test-engine） | ✅ |
| 隐藏内容 | 后日谈（通关解锁）、小鱼干彩蛋（30 句）、连点 7 次彩蛋 | 完整移植 | ✅ |
| 存档 | 自动存档 + 6 手动槽 + `cgSeen` / `cleared` / `settings` / `pendingSave` | 6 键语义一致 | ✅ |

## 3. 静态校验（`npm run check`，exit 0）

| 工具 | 覆盖 | 结果 |
| --- | --- | --- |
| `tools/lint-timers.js` | 复刻 BlueOS IDE feature-api 定时器「字面 token 配对」规则 | **PASS**：扫描 8 个 `.ux`（app.ux + 7 页），errors=0 warnings=0；运行时代码的定时器全部收口在 `common/reader.js` 的 `armTimer/armInterval` |
| `tools/validate-story.mjs` | 44/44 分块、5569/5569 节点、18/18 章、127/127 图片、9/9 CGG；节点字段、`bg/cs/cg` 下标与文件、`j/cj` 与选项跳转目标、章节表 | **PASS**：errors=0 warnings=0 |
| `tools/validate-pages.mjs` | 7/7 页三段式、manifest 路由、事件/组件白名单（无 `@system.*`/`onswipe`/`scrollview`/`slider`/`flex:1`/百分比宽度/`position:relative`/`opacity` 容器）、`<image>` 显式宽高+object-fit、features 声明、`data` 字段、`onInit` 不调 feature API、**CSS 几何常量与 `common/layout.js` 逐值一致**、About `APP_VER == manifest.versionName` | **PASS**：7/7 页面，errors=0 warnings=0 |
| `tools/test-engine.mjs` | 18 项：条件求值、选项过滤、节点语义、立绘槽位、章节索引/进度/过滤、存档 normalize/apply、全 5569 节点顺序执行、8 条策略、4 结局可达、`true_end_finish` 通关判定、**5457 个 say 节点存档往返**、44 分块 loader（缓存/trim/prefetch/坏块） | **PASS**：checks=18 failures=0 |
| `tools/test-reader.mjs` | 设置归一化、`longpressMode`、`autoDelay` 上下界、`wrapText` 标点断行与显式换行、`paginateText` 分组；**5457 句 × 字号 14–30（17 档）× 圆/方屏 = 185,538 次分页**不变量 | **PASS**：checks=7 failures=0 |
| `tools/check-methods.mjs` | 页面「方法存在性」：扫描每个 `.ux` 的 `this.xxx()` 调用与对象字面量方法定义，缺失即报错（防止真机 `not a function`） | **PASS**：8 个 `.ux`，errors=0 |
| `tools/test-game-page.mjs` | Game 页**运行时**全链路（临时 ESM 工程 + stub 掉 `@blueos.*` 与定时器，真实执行页面方法）：进入阅读、连续点击、分页、选项、走到结局、菜单 12 按钮、下滑/右滑/长按手势、字号切换重排、自动存档继续、手动槽读取、`at` 章节跳转、`onHide/onDestroy` 定时器清理 | **PASS**：checks=42 failures=0 |
| `tools/test-pages.mjs` | 其余 6 页**运行时**全链路（同一套临时 ESM 基础设施，真实索引/真实 CGG）：Home 21 / Saves 49 / Chapters 22 / Gallery 43 / Settings 48 / About 39 | **PASS**：checks=222 failures=0 |

分页不变量实测：185,538 次分页，平均 1.072 页/句、最多 4 页/句；全部满足
「不丢字 / 每行 ≤ 每行容量 / 每页 ≤ 6 行 / 行宽 ≤ 正文框宽」。

## 4. 官方构建（`npm run verify`，双设备）

| 设备 | 结果 | rpk | 大小 | 耗时 |
| --- | --- | --- | --- | --- |
| watch-round | ✅ `[INFO] finish compile`，exit 0，`[ERROR]` 0 条 | `dist/watch-round/debug/galgad.lico.debug.1.0.0.rpk` | 15,786,216 B（15.05 MiB） | 9.7 s |
| watch-square | ✅ `[INFO] finish compile`，exit 0，`[ERROR]` 0 条 | `dist/watch-square/debug/galgad.lico.debug.1.0.0.rpk` | 15,786,212 B（15.05 MiB） | 9.5 s |

rpk 内容断言（两台一致，`tools/build.mjs` 内置 + `--verify-rpk` 离线复核）：

- 外层 6 项：`manifest.json`、`galgad.lico.vru`、`icon.vug`、`META-INF/CERT`、`META-INF/build.txt`、`META-INF/`；
- `.vru`（VIVO union file）429 条目；
- manifest：`package=galgad.lico`、`versionName=1.0.0`、`designWidth=466`、`router.entry=pages/Home`、
  `router.pages` **7/7**（Home/Game/Saves/Chapters/Gallery/Settings/About）；
- features 5 项（packer 归一化后）：`system.storage`、`system.file`、`system.prompt`、
  `system.brightness`、`blueos.app.app`（分别对应 src 的 `blueos.storage.storage`、
  `blueos.storage.file`、`blueos.window.prompt`、`blueos.hardware.display.brightness`、`blueos.app.app`）；
- 页面编译产物 **21/21**（7 页 × index.js / index.template.json / index.css.json，另含 snapshot/map）；
- 剧本 JSON **45/45**（44 分块 + index.json）；
- 图片 **171/171** = 127 IMG（38 背景 + 55 立绘 + 34 CG）+ 32 鉴赏宽图 + 10 缩略图（g0–g8 + lock.png）+ home/icon；
- `app.js` / `app.css.json` / `app.snapshot` 存在；无 0 字节文件；rpk < 16 MiB（文案/包体余量）。

## 5. 资源优化（针对低性能 vivo 手表）

| 类别 | 源工程 | 本移植 | 说明 |
| --- | --- | --- | --- |
| 背景 | 672×480 × 38（3.23 MB） | 466×466 × 38（2.07 MB，64 色） | 静态 cover，去掉 10fps 全景平移 |
| CG | 854×480 × 34（3.26 MB） | 466×466 × 34（1.76 MB，64 色） | 正文满屏 |
| 鉴赏宽图 | （源用 854 宽） | 640×360 × 32（1.95 MB，48 色） | 显示 828×466，可拖动 |
| 立绘 | 143×380 × 55（0.50 MB） | 139×369 × 55（0.47 MB，128 色 RGBA） | 等比缩放 |
| 缩略图 | 96×54 × 9 | 120×68 × 9 + lock.png | 8 位调色板 |
| 主页画/图标 | 336×480 / 192×192 | 466×666 / 114×114 | 图标正方形无圆角（BlueOS manifest 要求） |
| 图片合计 | 7.10 MB（另有 106 张 4.53 MB `_l/_r` 残留未使用） | **6.36 MB** | 小于源工程记录的 9 MB 预算 |
| 剧本 | 0.507 MB | 0.507 MB（44 个 `.json` 随包） | 不进页面 JS；运行时 LRU 2 分块 |
| debug rpk | （源 7.40 MB / 手环） | **15.05 MiB** | < 16 MiB 限制 |

运行时优化：每页只读当前分块、缓存当前+下一块、并发合并、预读；`data` 只放模板绑定字段，
剧本/缓存/定时器句柄放非响应式模块级 `st`；`onHide/onDestroy` 释放全部定时器与屏幕常亮；
提供屏上 `badge` 阶段诊断与 `[GalGod]` 分阶段日志。

## 6. 模拟器 / 实机差异规避（参考 galgame / galgaoshou 实机经验）

| 风险 | 本工程做法 |
| --- | --- |
| 真机 DPR≠1 时嵌套定位容器宽度被二次换算（UI 挤左、每行 3–4 字） | 所有页面采用「根节点 + 全屏扁平层」，定位元素都是根节点直接子节点，显式 px + bottom 锚定，不用百分比宽度 |
| `<image>` 百分比尺寸解析不可靠 | 背景/CG/立绘/宽图全部显式宽高；`object-fit` 显式声明（background cover / sprite contain / 宽图 fill） |
| 带子节点容器 `opacity` 在固件上渲染成条纹 | 半透明一律 `rgba()` 背景色；`opacity` 不用于容器 |
| 全透明 div 收不到点击 | 手势/点击层 `background-color: rgba(...,0.02)` |
| 表冠 delta 真机远大于 1 | 本移植不使用表冠缩放（源工程也未用），无此风险 |
| 插件 IDE 定时器 lint 误报 | 定时器全部经 `armTimer/armInterval` 本地变量持有 + 同引用清理（lint 0 错） |
| 页面 JS 内联大剧本 → 实机进阅读页卡死 | 剧本 44 个 `.json` 随包 + `file.readText` + 分块 LRU，页面 JS 不含剧本文本 |
| `<list>` 子项定位/结构不一致 | list-item 仅 `type="row"` 单类型、DOM 一致、内部无 position；未解锁 CG 用 `lock.png` 换 src |
| 屏幕常亮 API 未实机验证 | `@blueos.hardware.display.brightness.setKeepScreenOn` 包 try/catch，失败仅不常亮 |

## 7. 仍需人工回归（本机无法命令行驱动模拟器/真机）

本机无法命令行启动 BlueOS 模拟器（依赖 Studio 预览通道），运行时验证由「官方编译器真实整包 +
Node 侧引擎全剧情/分页测试 + 页面几何静态校验」组合完成。建议在 vivo WATCH GT 2（432×514 /
BlueOS 3.0）与圆屏模拟器各回归一次：

1. 首页 → 开始阅读 → 连续翻页（打字机/分页/▼）→ 选项 → 结局 → 返回标题；
2. 存档页：保存/覆盖/读取/长按删除；自动存档「继续阅读」；杀进程后恢复；
3. CG 鉴赏：9 组解锁状态、全屏宽图左右拖动看全图、切差分、关闭；
4. 设置：字号 14/20/30、速度、自动播放、屏幕常亮开关、长按行为三选一（按住快进/隐藏界面）；
5. 关于页：连点标题 7 次 → 解锁后日谈 / 解锁全部 CG / 小鱼干 30 句；章节页出现后日谈；
6. 下滑开菜单、右滑快退、返回键开/关菜单（不误退出）；
7. 连续阅读 30 分钟观察内存/发热/崩溃（低性能手表重点）。

## 8. 真机反馈修复（2026-11-10，v1.0.1）

真机反馈：**进入 Game 页点屏幕直接报错、字幕无反应**。

```
[Info]  [GalGod] 读取分块 /common/story/chunk-000.json …
[Error] QuickJSRuntime JSError:not a function
        at onTap (build/watch-square/pages/Game/index.js:1111)
```

### 8.1 根因与修复

| # | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | `onTap` 抛 `not a function`，点击无法推进字幕 | 页面脚本重写时把 Vela 的 `onHoldEnd()` 改名为 `onTouchEnd()` + 新方法 `endHold()`，但 `onTap`（click 兜底收尾）与 `holdMax` 看门狗**仍调用旧的 `this.onHoldEnd()`**。模板事件处理器存在性校验只覆盖模板，覆盖不到页面内部 `this.x()` 调用，所以静态校验漏过 | 新增 `endHold()`（清 `holdTimer`/`holdMax`，若在快进则关闭），`onTap` 用 `try { this.endHold() } catch {}` 兜底、`holdMax` 与 `onTouchEnd` 改调 `endHold()` |
| 2 | 从设置页返回后字号/速度/常亮/长按行为不生效 | `st.booted` 只在 `startReading()` 里置 `false`，**从未置 `true`**，`onShow()` 第一行 `if (!st.booted) return` 永远早退；同时 `onHide()` 已关掉屏幕常亮，回到前台不会恢复 | 索引读取成功即 `st.booted = true`；`onShow()` 先无条件 `setKeepScreenOn(设置里的 keepOn)` 再按需重读设置（字号变化 → `reflow()`） |
| 3 | 排障信息不足 | 只有「读取分块」日志，无法判断字幕是否已渲染 | 本次进入阅读渲染出**第一句**时打一条 `[GalGod] 首句渲染 pc=… 说话人=…`（之后不再逐句打印，遵守精简日志规范） |

### 8.2 新增门禁（堵住这类「测试没覆盖到」的漏洞）

| 工具 | 作用 | 结果 |
| --- | --- | --- |
| `tools/check-methods.mjs` | 静态扫描每个 `.ux`：`this.xxx()` 调用必须在页面对象里定义、模板 `@click` 等处理器必须存在（自动剥离注释，避免误报） | PASS：8 个 `.ux`，errors=0（修复前准确报出 Game 的 2 处 `this.onHoldEnd()`） |
| `tools/test-game-page.mjs` | 把 Game 的 `<script>` 搬进临时 ESM 工程，stub `@blueos.*`（storage/file/router/prompt/brightness）与假定时器，**真实执行**页面方法：进入阅读 → 连续 60 次点击 → 4,795 步推进到结局 → 选项 → 菜单 12 按钮 → 下滑/右滑/按住快进 → 字号 30 重排 → 自动存档继续 → 手动槽读档 → `at` 章节跳转 → `onHide/onDestroy` 无残留定时器 | PASS：checks=42 failures=0（修复前即在 `onTap` 复现崩溃） |
| `tools/test-pages.mjs` | 其余 6 页同样的运行时全链路（Home 21 / Saves 49 / Chapters 22 / Gallery 43 / Settings 48 / About 39），真实剧本索引与真实 CGG，覆盖防抖写盘、长按删除、宽图拖动、彩蛋与小剧场 | PASS：checks=222 failures=0 |

### 8.3 复验

- `npm run check`：lint-timers / check-methods / validate-story / validate-pages / test-engine / test-reader / test-game-page / test-pages —— **8 个工具全 PASS，exit 0**。
- 双设备重建：`dist/watch-round/debug/…rpk` 15,786,216 B、`dist/watch-square/debug/…rpk` 15,786,212 B；两台均 `[INFO] finish compile`、`[ERROR]` 0 条；rpk 内容断言 21/21 页面、45/45 剧本、171/171 图片。
- 编译产物核查：`build/watch-square/pages/Game/index.js` 中已无 `onHoldEnd`，`endHold` 与 `st.booted = true` 均在编译产物中。

> 请在真机上重装新包后按 §7 清单回归，重点：进入阅读后连续点击翻页、进设置改字号返回、按住快进、下滑开菜单。

## 10. 界面优化（2026-11-10 第二轮反馈）

反馈：**对话面板占屏比例太大，且没有正常的阅读菜单按钮**。

### 10.1 对白面板缩小

| 项 | 旧值（圆屏） | 新值（圆屏） | 旧值（方屏） | 新值（方屏） |
| --- | --- | --- | --- | --- |
| 面板尺寸 | 406×290（bottom 0） | **340×186（bottom 66）** | 410×230（bottom 10） | **410×186（bottom 20）** |
| 占屏高 | 62% | **39.9%** | 41.5% | **33.6%** |
| 正文区 | 310×144 | **300×126** | 334×144 | **340×140** |
| 说话人底板 | 300×34 | 300×30 | 320×30 | 340×32 |
| ▼ 提示 | 面板外右下 | **正文下方居中（面板内）** | 面板内右下 | 正文右侧 |
| 字号 20 时 | 15 字 × 6 行 | 14 字 × 5 行 | 15 字 × 6 行 | 16 字 × 5 行 |

几何全部收敛在 `src/common/layout.js`（`PANEL / NAME / TEXT / NEXT_HINT / HUD / MENU_BTN`），
页面 CSS 由 `tools/validate-pages.mjs` 逐值核对，改一半会直接报错。

### 10.2 新增顶部「≡」阅读菜单按钮

- 位置：圆屏 `left 312 / top 58 / 42×42`（在半径 215 的安全圆内，y≈58 处安全横向约 108..358）；
  方屏 `left 410 / top 8 / 44×44`。
- **DOM 顺序放在 `.tap-layer` 之后**：BlueOS 没有 `z-index`，靠绘制顺序决定谁接收点击；
  放前面会被全屏点击层吃掉（这正是"点了没反应"的常见原因）。
- 绑定 `@click="openMenu"`；`openMenu()` 会打 400ms 点击锁，所以即使事件冒泡也不会顺带翻一页。
- 隐藏条件与对白一致：`!uiHidden && !endText && !choices.length && !menu`。
- 仍保留原手势入口：下滑打开菜单、返回键开关菜单。

### 10.3 新增门禁

- `tools/validate-pages.mjs`：
  - `.menu-fab` / `.menu-fab.square` 几何必须与 `layout.js MENU_BTN` 一致；
  - 圆屏安全区校验（正文块四角、面板上沿、菜单按钮角到 (233,233) 距离 ≤215）；
  - **对白面板占屏高 > 55% 直接报错**（防止再次变成"压屏"布局）；
  - 模板必须存在 `menu-fab` 且绑定 `@click="openMenu"`。
- `tools/test-game-page.mjs`：新增 4 条模板结构断言（点击层存在 / `.menu-fab` 存在 / 顺序在点击层之后 / 绑定 openMenu）。
- `tools/render_layout_preview.py`：按 `layout.js` 数值 + 真实素材合成 1:1 版面图
  （`docs/preview/game-round.png` 466×466、`docs/preview/game-square.png` 466×554），
  用于快速目检占屏比例与安全区，不必每次都开模拟器。

### 10.4 复验

- `npm run check`：8 个工具全 PASS（test-game-page 由 42 → **46** 项）。
- 双设备重建：`watch-round` 15,787,721 B、`watch-square` 15,787,725 B，均 `[INFO] finish compile`、`[ERROR]` 0 条，
  rpk 内容断言 21/21 页面、45/45 剧本、171/171 图片。
- 几何自检（脚本核对）：圆屏面板 63..403 × 214..400、正文 83..383 × 256..382、
  菜单按钮 312..354 × 58..100、▼ 224..244 × 378..398；所有关键点到圆心距离 ≤215；
  说话人不与正文重叠、正文完全在面板内、▼ 不压正文。

## 11. 验收产物清单

- 构建：`dist/watch-round/debug/galgad.lico.debug.1.0.0.rpk`、`dist/watch-square/debug/galgad.lico.debug.1.0.0.rpk`
- 构建日志/摘要：`scripts/reports/build/watch-{round,square}-debug.{log,json}`、`verify-rpk.json`
- 门禁日志：`scripts/reports/verify-final.log`、`check-final.log`
- 各工具报告：`scripts/reports/{lint-timers,check-methods,validate-story,validate-pages,test-engine,test-reader,test-game-page,test-pages}.json`
- 工具链总报告：`scripts/reports/VERIFICATION-TOOLCHAIN.md`
- 平台/源码/参考分析：`docs/refs/{blueos-platform,source-galgod,reference-port}.md`
- 移植说明：`README.md`、`docs/PORT-NOTES.md`、`docs/PORT-SPEC.md`
- 版面预览图：`docs/preview/game-round.png`、`docs/preview/game-square.png`（按 layout.js 合成）
