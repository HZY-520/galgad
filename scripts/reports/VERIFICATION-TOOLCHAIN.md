# GalGod BlueOS 移植 · 验证工具链报告（tools/）

> 生成时间：2026-11-09（Asia/Shanghai）
> 负责人：toolchain-engineer（共享任务板 task-6）
> 范围：只写 `tools/` 与 `scripts/reports/`，不改 `src/`。构建统一由 Lead 安排，避免与其它 Agent 并发调用 blueos-pack。

## 0. 结论速览

| 工具 | 状态 | 说明 |
| --- | --- | --- |
| `tools/lint-timers.js` | **PASS** | 复刻 BlueOS IDE feature-api 定时器配对规则（apiParser.getTimerInfo 字面 token 配对）+ 页面禁用直接定时器；扫描 `<root>/src` 全部 `.ux` |
| `tools/validate-story.mjs` | **PASS** | 44 分块 / 5569 节点 / 18 章 / 127 图片 / 9 组 CGG / 跳转 / manifest 版本一致性 |
| `tools/validate-pages.mjs` | **PASS**（7 个正式页面） | 三段式、路由↔目录、模板/事件/图片、平台 CSS 禁用项、data 声明、features、Game 页几何常量与 `common/layout.js` 逐值一致 |
| `tools/test-engine.mjs` | **PASS** | 18 项 check：全 5569 节点、8 条策略、3 结局+Bad End、true_end_finish 通关、章节过滤 14/15、5457 say 节点存档往返、loader 44 分块 |
| `tools/test-reader.mjs` | **PASS** | 5457 句 × 字号 14–30 × 圆/方屏 = 185,538 次分页不变量 + 设置归一化/autoDelay/wrapText |
| `tools/build.mjs` | **就绪（未执行）** | 官方 blueos-pack 包装器 + 进程互斥锁 + 日志/摘要落盘 + `[INFO] finish compile`+新 rpk+**rpk 内容断言**；按 Lead 要求未启动 blueos-pack |
| `tools/gen_assets.py` / `tools/import_story.mjs` | 既有工具 | Lead 维护，本次未改动 |

一键门禁：`npm run check`（= lint → validate-story → validate-pages → test-engine → test-reader）。

## 1. 运行方式与报告位置

```powershell
cd C:\Users\Administrator\BlueOSProjects\galgad
npm run check          # = node tools/lint-timers.js --root . && validate-story && validate-pages && test-engine && test-reader

# 单个工具（均会写 JSON 报告到 scripts/reports/）
node tools/lint-timers.js --root .
node tools/validate-story.mjs
node tools/validate-pages.mjs --verbose
node tools/test-engine.mjs
node tools/test-reader.mjs

# 构建（Lead 统一执行；同一时间只会有一个 blueos-pack 进程）
node tools/build.mjs --debug   --device watch-round
node tools/build.mjs --debug   --device watch-square
node tools/build.mjs --release --device watch-round
node tools/build.mjs --release --device watch-square

# 只对已有 rpk 做内容断言（不启动构建）
node tools/build.mjs --verify-rpk dist/watch-round/debug/xxx.rpk
```

| 产物 | 路径 |
| --- | --- |
| lint JSON | `scripts/reports/lint-timers.json` |
| 剧本校验 JSON | `scripts/reports/validate-story.json` |
| 页面校验 JSON | `scripts/reports/validate-pages.json` |
| 引擎测试 JSON | `scripts/reports/test-engine.json` |
| 分页测试 JSON | `scripts/reports/test-reader.json` |
| 一键门禁完整日志 | `scripts/reports/check-final.log` |
| 构建日志 | `scripts/reports/build/<device>-<mode>.log` |
| 构建摘要（含 rpk 内容断言） | `scripts/reports/build/<device>-<mode>.json` |
| 构建失败首条记录 | `scripts/reports/build/FIRST-FAILURE.md` |
| 已有 rpk 离线断言 | `scripts/reports/build/verify-rpk.json` |
| rpk 产物 | `dist/<device>/<debug|release>/<package>.<mode>.<version>.rpk` |

## 2. 各工具实现要点

### 2.1 `tools/lint-timers.js`
- 逐字复刻 IDE `blueos-language-features` 的 `apiParser.getTimerInfo()` + `apiValidation.validateClearTimer()`：
  每个 `setTimeout` 必须在 `clearTimeout` 列表里存在 **fn 字面量完全相等** 的一项，否则报 feature-api Error。
- 目标工程附加规则（PORT-SPEC §0.5）：页面 `<script>` 内禁止直接出现 `setTimeout/setInterval/clearTimeout/clearInterval`；
  定时器统一收口在 `src/common/reader.js` 的 `armTimer/armInterval`（局部变量持有句柄 → 静态检查与运行时都正确）。
- 默认 IDE 解释器路径：`D:/BlueOSStudio/.../blueos-language-features/server/dist/modes/script/hap/apiParser.js`，可用 `--ide` 覆盖。
- 退出码：0 通过 / 1 有 error / 2 用法错误 / 3 apiParser 加载失败。

### 2.2 `tools/validate-story.mjs`
- 分块：恰好 44 个 `chunk-XXX.json`，`start/count` 连续且覆盖 `nodeCount=5569`，分块节点数与 count 一致；
- 章节：18 章，`start` 严格递增、首章 0、末章覆盖到 nodeCount，3 个隐藏结局章 + 1 个 need 后日谈；
- 节点：仅允许 `s/o/e/f/sf/j/cj`，按类型校验必填字段；`bg/cs/cg` 下标在 IMG(127) 范围内且语义区间正确
  （bg 0–37 / cs 38–92 / cg 93–126，-1/-2 纯色），图片文件真实存在；
- 跳转：`j`/`cj.j`/选项 `j` 全部落在 `[0, nodeCount)`，禁止自跳；
- 选项：`o[].x`、`o[].j`、条件 `c=[v,op,n]` 合法性；
- CGG：9 组，缩略图存在、`u/im` 下标合法、对应图片与鉴赏宽图 `w/` 存在；
- manifest `versionName` 与 About 页 `APP_VER` 一致（About 未实现时跳过并记 TODO）。

### 2.3 `tools/validate-pages.mjs`
- 页面三段式 `script → template → style`、单根节点、标签配平；
- `manifest.router.pages` ↔ `src/pages` 目录一致（缺页面输出「未实现」；多余未注册目录报 error）；
- 模板：禁止 `@system.*`、`onswipe/@swipe`、`scrollview/swiper/image-animator/slider`；事件白名单
  `click/longpress/change/touchstart/touchmove/touchend/touchcancel`，处理函数必须在 script 中存在；
  `<image>` 不得绑事件；`<list>` 直接子节点只能 `<list-item>` 且必须有 `type`；
- `<image>`：显式宽高 + `object-fit`（class 规则/内联 style/属性任一来源；动态 class/style 记 warning 人工复核），静态 src 文件必须存在；
- 脚本：禁止 `private:/protected:/public:`、`require()`、动态 `import()`；本地 import 必须相对路径 + `.js` 且文件存在；
  `@blueos.*` import 必须在脚本顶部；`onInit` 内不得直接调用 storage/router/prompt/file/brightness/$app；
  `data` 字段声明（模板绑定标识符、路由参数）；`this.X=` 未声明记 warning（响应式坑）；
- 样式：`.page` 必须 `width:466px`；禁止百分比 `width`、`position:relative`、`overflow/z-index/box-shadow/filter`、
  多值 `border-radius`、`top:auto`、`flex:1`、`flex-grow>0`；`opacity` 只允许空 div；禁止 `@import`/`lang="scss"`/
  SCSS 变量/`@media (shape:)`；`#id`/后代选择器记 warning；
- **Game 页几何**：`.panel/.panel.square`、`.speaker/.speaker.square`、`.line/.line.square`、
  `.next-hint/.next-hint.square`、`.hud/.hud.square`、`.sp/.sp-l/.sp-c/.sp-r` 的 left/top/width/height/bottom/border-radius
  逐值对照 `src/common/layout.js` 的 `PANEL/NAME/TEXT/NEXT_HINT/HUD/SPRITE`（改一半立即报错）；
- features：代码 import 的 `@blueos.*` 必须在 `manifest.features` 声明（router 归 `blueos.app.app`），
  且 5 项必需能力（storage.storage / storage.file / window.prompt / display.brightness / app.app）齐全；
- About 页 `APP_VER == manifest.versionName`。

### 2.4 `tools/test-engine.mjs`
Node 侧加载真实 `src/common/*.js`：复制到临时目录（`package.json {"type":"module"}`）并把内部相对 import 改 `.mjs`、
`@blueos.storage.*` 换成内存 stub（storage 用 Map；file 用同步 fs 读取真实 `src/common/story/*.json` 并统计读盘次数）。
覆盖：
1. `testCond/choicesOf/executeNode/renderSprites/chapterIndex/chapterProgress/visibleChapters/nextVisibleChapter/normalizeSave/applySave/describeSave` 单元语义；
2. 全 5569 节点逐个执行：动作类型正确、pc 不越界、跳转落地正确；
3. **8 条策略**跑全剧本到结局：S1/S2 总选首/末 → Bad End(4345)；S3 全 flag 拉满 + 4797 条件项 → **真结局 end_te**、
   `true_end_finish=1`、`bad_end_flag=7`、`true_end_flag=4`、进入后日谈(5158) → 剧终(5568)；
   S4 只拉真 flag 但 bad<7 → Bad End；S5 → end_ne2；S6 → end_ne1；S7 条件选项过滤（flag=3 时第 3 项不可见）→ end_ne2；S8 伪随机；
4. 结局可达性汇总：`bad_end / end_te / end_ne1 / end_ne2` 四种均可达；
5. 章节过滤：未通关 14 章 / 通关 15 章，hide 结局章永不显示，need 后日谈仅通关后显示，nextVisibleChapter 跳过规则；
6. **5457 个 say 节点**逐个 `collectSave → JSON 往返 → normalizeSave → applySave` 全字段一致；
7. loader：索引读取、44 分块全读、二次读取缓存命中不重复读盘、trim 淘汰、prefetch、坏分块/空 chunk 回调 null、chunkOf 边界；
8. storage 封装：默认设置、保存/读回、坏 JSON fallback。

### 2.5 `tools/test-reader.mjs`
对 **5457 句 × 字号 14–30（17 档）× 圆屏/方屏（2 种）= 185,538 次分页**断言：
不丢字（展平行 join == 原文去换行）、每行长度 ≤ charsPerLine、每页行数 ≤ min(MAX_LINES, linesPerPage)、
行宽估算（len×fontSize）≤ 文本框宽、pages > 0；另测 `paginationMetrics` 公式/边界、`normalizeSettings` 默认/越界/老存档兼容、
`autoDelay` 1.2–12s 夹取、`longpressMode` 归一化、`wrapText` 标点断行/显式换行、`paginateText` 分组。

### 2.6 `tools/build.mjs`（官方 blueos-pack 包装器）
- 打包器定位：`BLUEOS_PACK_BIN` → `D:\BlueOSStudio\...\blueos-pack\bin\index.js` → 其它常见安装位置；
  实测版本 `blueos-pack 1.0.12-beta.13`。
- 命令：
  - `--debug`（整包验收）：`node <packer> build --device-type <device> -f`（dev 阶段、不签名、输出 `dist/<device>/debug`，**编译全部页面**）；
  - `--entry-only`：`node <packer> build --device-type <device> --debug -f`（IDE 快速预览语义，packer 内部会
    `if (globalConfig.debug) 只保留 entry+'/index' + app`，rpk 里只有 Home，**不完整，不能当整包验收**）；
  - `--release`：`node <packer> release --device-type <device> -f`（需要 `sign/private.pem` + `sign/certificate.pem`）。
  > 重要实测：blueos-pack 的 `--debug` 并不是「带调试符号的完整包」，而是**只编译入口页**的快速预览模式
  > （`dist/index.cjs` 中 `globalConfig['debug']` 为真时删除非 `entry+'/index'`/`app` 的 entries）。
  > 因此整包验收必须用 `build` 子命令但不传 `--debug`（本工具的 `--debug` 正是这个语义）。
- **成功判定**（退出码不可信）：日志出现 `[INFO] finish compile` **且** `dist/<device>/` 下找到本次新生成的 `.rpk`
  **且** rpk 内容断言通过；否则 exit 1，并把关键 `[ERROR]`/日志末尾/涉及页面写进 `scripts/reports/build/FIRST-FAILURE.md`。
- 进程互斥：`scripts/reports/build/.build.lock`（检测已有 blueos-pack 存活进程则拒绝并发，避免缓存竞态随机页面编译错）。
- 日志/摘要：`scripts/reports/build/<device>-<mode>.log` / `.json`。
- **rpk 内容断言 `verifyRpkContents()`**（无第三方依赖）：
  - rpk = ZIP（`META-INF/CERT`、`manifest.json`、`<package>.<hash>.vru`、`META-INF/build.txt`，可能还有根 `icon.vug`）；
  - `.vru` = `"vivo union file"`：16 字节魔数 + 头部 + 包名 + 目录表 `[u32 dataOffset][u32 size][u32 nameLen][name]`，
    用「最大条目数」启发式定位目录起点，先例：galgame rpk → 2308 条目、galgaoshou rpk → 558 条目；
  - 内层 manifest 校验 `package / versionName / router.entry / router.pages / features` 与 `src/manifest.json` 一致；
  - vru 校验：7 页 × 3 个编译产物 = 21；`common/story/{index.json, chunk-000..043.json}` = 45；
    `common/img/**` 全部 png→vug（127 IMG + 32 宽图 + 10 缩略图 = 169，实测参考工程 common 图片 2169/2169 全量进包）；
    `assets/images/{home,icon}.png`→vug（icon 也接受根 `icon.vug`）；
    另有 `app.js` / `app.css.json`、0 字节文件检查、rpk > 16 MiB 体积警告；
  - 支持 `--verify-rpk <path>` 只断言不构建；支持 `--skip-content-check` 跳过。

## 3. 当前验证基线（最终一次完整运行，`npm run check` exit 0）

- lint：`.ux` 文件 8 个（app.ux + 7 页面，TestPage 残留已由 Lead 删除）→ 0 error / 0 warning；
- validate-story：44/44 分块、5569/5569 节点、18/18 章、127/127 图片、9/9 CGG、0 error / 0 warning；
- validate-pages：7/7 页面 PASS、0 error / 0 warning；
- test-engine：18/18 check PASS，8 条策略全部到达结局，四种结局均可达（bad_end / end_te / end_ne1 / end_ne2）；
- test-reader：7/7 check PASS，185,538 次分页全部通过（平均 1.072 页/句，最多 4 页）；
- 完整输出：`scripts/reports/check-final.log`；各工具 JSON：`scripts/reports/{lint-timers,validate-story,validate-pages,test-engine,test-reader}.json`。
- **构建（双设备 debug，工程根目录实测）**：
  - `dist/watch-round/debug/galgad.lico.debug.1.0.0.rpk`：15,784,953 B（15.05 MiB），`[INFO] finish compile` ✅；
  - `dist/watch-square/debug/galgad.lico.debug.1.0.0.rpk`：15,784,952 B（15.05 MiB），`[INFO] finish compile` ✅；
  - rpk 内容断言（两台设备一致）：外层 6 项（META-INF/CERT、META-INF/build.txt、manifest.json、galgad.lico.vru、根 icon.vug）、
    vru 429 项；manifest pages=7 / features=5；页面产物 21/21；剧本 JSON 45/45；图片 171/171（15.05 MiB < 16 MiB 预算）。
  - 摘要/日志：`scripts/reports/build/watch-round-debug.json`、`watch-square-debug.json` 及同名 `.log`。

> 说明：test-reader 首次运行的 4 条 failure 均为**测试断言期望写错**（reader.js 行为与源工程一致），已修正：
> `autoDelay` 下界 800/730 应夹到 1200；`wrapText` 显式换行应区分单换行（2 行）与空行（`'abc\n\ndef'` → 3 行）。
> 未改 `src/common/reader.js`。

## 4. 待办 / 需 Lead 决策

1. **构建**：工程根目录双设备 debug 整包构建已完成（见 §3），Lead 可用
   `node tools/build.mjs --verify-rpk dist/<device>/debug/galgad.lico.debug.1.0.0.rpk` 复核（只读断言，不启动构建）。
   构建命令固定为 `node tools/build.mjs --debug --device watch-round|watch-square`（`--debug` = 完整 dev 包；
   需要 IDE 快速预览时用 `--entry-only`）。
2. **src 观测项（已解决）**：`src/pages/TestPage` 未注册残留已由 Lead 删除，lint 恢复 8 个 .ux / validate-pages 7/7 PASS。
3. 仍建议人工确认：Gallery 页动态 class 的 `<image>`（`class="{{ $item.thumbCls }}"`）在真机上的宽高/object-fit 渲染。
4. release 构建需要 `sign/private.pem` + `sign/certificate.pem`（debug 不需要签名）。
5. 历史遗留产物：`scripts/reports/direct-build.log` / `rpk-unpack-round/` 为排查过程证据，可保留；旧的 entry-only rpk 已被覆盖。
