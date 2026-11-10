# GalGod · vivo 蓝河（BlueOS）手表移植说明

本工程把 **GalGod 2.5.2**（PC Ren'Py 原作《想成为 Galgame 领域大神！！！》的
小米手环 9 Pro Vela 快应用移植版，源仓库
<https://github.com/mcpotato1123/galgod-band>）**完整移植**到 vivo 蓝河（BlueOS）
手表平台，目标设备为圆屏 466×466（`watch-round`）与方屏 432×514
（`watch-square`，vivo WATCH GT 2 / BlueOS 3.0 实机）。

- 移植方式：按 `BlueOS开发文档.md` 重写为 `@blueos.*` 应用；剧本、立绘、背景、
  CG、分支、结局、CG 鉴赏、存档、设置、彩蛋全部保留。
- 工程位置：`C:\Users\Administrator\BlueOSProjects\galgad`。
- 原始 Vela 工程（只读）：`C:\Users\Administrator\BlueOSProjects\_galgod_band_src\galgod-band-main`。
- 行为依据：`docs/refs/source-galgod.md`；平台依据：`docs/refs/blueos-platform.md`；
  参考工程模式：`docs/refs/reference-port.md`。实现规范见 `docs/PORT-SPEC.md`。

> 剧本文字与全部美术资源版权归原作 **GalGod / 诺提拉观察所** 所有；本工程仅为
> 个人非商业性技术移植，代码部分沿用源工程 MIT 协议。详见 `NOTICE.md` 与 `LICENSE`。

---

## 1. 移植内容

| 项目 | 源工程（Vela / 手环 9 Pro） | 本移植（vivo 蓝河） |
| --- | --- | --- |
| 框架 | Xiaomi Vela 快应用（`@system.*`） | vivo BlueOS（`@blueos.*`） |
| 设计基准 | 336×480（designWidth 336） | **466**（圆屏 466×466 / 方屏设计宽 466、高约 554） |
| 页面数据 | `protected`（与 `data` 不能共存） | `data`（路由参数同名接收） |
| 页面栈 | 多实例 | 全部页面 `singleTask`；`Game`/`Gallery` 配 `followHand:disable` 以接管返回手势 |
| 剧本加载 | 44 个 `.txt`（内容是 JSON）+ 运行时索引 | 44 个 **`.json`** 随包资源 + `file.readText` + 同块并发合并 + 只缓存当前/下一块 |
| 长对白 | 6 个固定 `<text>` 槽位 + 运行时按字号分页 | 单 `<text>` + 运行时按字号分页（蓝河 `lines` 行数上限 6） |
| 背景动效 | 672 宽全景图 + 10fps 定时器推进 `left` | **改为静态 cover 背景**（低性能手表省 CPU/电量；见 §2） |
| 立绘 | 3 固定槽位 143×380 | 3 固定槽位 139×369（按 466/480 等比缩放） |
| CG | 854×480 宽图 + touchmove 拖动 | 正文 466×466 cover；鉴赏 640×360 宽图按 828×466 显示、可拖动看全图 |
| CG 鉴赏 | 9 组 / 32 张差分，`touchmove` + `onswipe` + 热区 | 9 组 / 32 张；`touchstart/move/end` 拖动 + 左右热区兜底 |
| 设置 | 3 个 slider + 2 个开关 | **−/＋ 步进** + 药丸开关（滑块在蓝河实机上不可靠，参考工程已改用步进） |
| 屏幕常亮 | `@system.brightness` | `@blueos.hardware.display.brightness.setKeepScreenOn` |
| 输入/手势 | Vela 的 `onswipe` / `onlongpress` | 无 `onswipe`：顶部「≡」按钮 + 下滑手势开菜单，`touchstart/touchend` 坐标自算右滑快退；长按用 `longpress` + 自计时快进 |
| 彩蛋 | 关于页连点 7 次 + 小鱼干剧场 | 完整保留（解锁后日谈 / 解锁全部 CG / 29 句小鱼干） |

**内容完整性**：5569 个剧本节点（5457 句台词、15 个选择点 / 53 个选项）、
18 个章节（14 正片 + 3 隐藏结局 + 1 后日谈）、4 种结局（真结局 / 2 个普通结局 /
Bad End）、127 张图片索引（38 背景 + 55 立绘 + 34 CG）、9 组 32 张 CG 鉴赏。
`npm run validate` / `npm run test` 会逐项核对，见第 5 节。

---

## 2. 针对低性能 vivo 手表的优化（与原工程的有意差异）

1. **图片全部按目标屏幕重裁**：背景 466×466（源 672×480 全景 → 静态 cover）、
   CG 466×466、立绘 139×369、鉴赏宽图 640×360（仅 32 张）、缩略图 120×68；
   8 位调色板 PNG（背景/CG 64 色、立绘 128 色 RGBA、宽图 48 色），删除 106 张
   `_l/_r` 历史残留。图片总量约 **6.4 MB**，低于源工程 README 记录的 9 MB 预算。
2. **去掉背景全景平移**：源工程用 10fps 定时器推进 `left`；本移植改为静态
   `object-fit: cover`，减少持续重绘与定时器唤醒（参考《GAL高手》移植的同类优化）。
3. **剧本外置 + 分块 LRU**：剧本不进页面 JS（避免单页 JS/快照膨胀导致实机卡死），
   运行时只读当前分块，缓存当前 + 下一块，块级并发合并。
4. **非响应式状态外置**：剧本、缓存、定时器句柄、历史栈放模块级普通对象 `st`，
   `data` 只放模板绑定的字段，减少 Proxy 依赖收集。
5. **定时器统一收口**：`armTimer/disarmTimer/armInterval/disarmInterval`，满足
   BlueOS IDE 的 feature-api 静态检查，`onHide/onDestroy` 全部清理。
6. **半透明全部用 rgba 背景色**：不给带子节点的容器加 `opacity`（实机渲染陷阱）；
   所有定位元素都是页面根节点的直接子节点、显式 px、`bottom` 锚定（规避真机
   DPR≠1 时嵌套容器宽度被二次换算的问题）。
7. **屏幕常亮可关**：设置页关掉后不再调用 keepScreenOn；默认开。
8. **首屏看门狗与屏上状态徽标**：加载失败/卡住时在屏幕顶部显示阶段信息
   （`badge`），并用 `console.log('[GalGod] …')` 分阶段打日志，便于真机排障。
9. **无 slider / 无 scrollview / 无 onswipe / 无 z-index / 无 overflow 依赖**：
   全部换成蓝河文档与参考工程实机验证过的组件与写法。

## 3. 目录结构

```
galgad/
├─ src/
│  ├─ manifest.json          # 包名/图标/版本/features/deviceTypeList/designWidth 466/router
│  ├─ app.ux                 # 应用入口（生命周期与错误日志）
│  ├─ app.d.ts
│  ├─ assets/images/         # icon.png(114) / home.png(466x666)
│  ├─ common/
│  │  ├─ layout.js           # 版面几何 + 分页度量（页面 CSS 与之核对）
│  │  ├─ reader.js           # 设置/分页/storage/定时器收口
│  │  ├─ engine.js           # 剧本引擎纯逻辑（可在 Node 里跑全剧情）
│  │  ├─ story.js            # 索引 + 分块加载器（LRU 2）
│  │  ├─ asset.js            # 图片下标 -> URI（含鉴赏宽图）
│  │  ├─ assets.js           # 由源工程生成的图片索引表（127 项）
│  │  ├─ cglist.js           # CG 鉴赏 9 组
│  │  ├─ story/              # index.json + chunk-000..043.json（5569 节点）
│  │  └─ img/{b,s,c,w,t}/    # 背景/立绘/CG/鉴赏宽图/缩略图
│  └─ pages/                 # Home / Game / Saves / Chapters / Gallery / Settings / About
├─ tools/                    # 资源流水线、导入、构建、lint、校验、逻辑测试
├─ scripts/reports/          # 构建日志与验证报告
├─ docs/                     # 本说明、PORT-SPEC、VERIFICATION、refs/
├─ dist/                     # 构建产物 dist/<device>/debug|release/*.rpk
└─ BlueOS开发文档.md         # 平台参考文档（本地资料）
```

## 4. 构建与运行

环境：
- **BlueOS Studio**（本机 `D:\BlueOSStudio`），提供官方打包器
  `D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js`
  （实测 1.0.12-beta.13）。
- **Node.js ≥ 18**（实测 v24.21.0）。
- 资源流水线需要 Python 3 + Pillow（本机可用捆绑解释器，见下）。

命令：

```bash
# 校验（lint + 剧本 + 页面 + 引擎 + 分页）
npm run check

# 官方打包（debug 侧载包，无需签名，包含全部 7 个页面）
npm run build:debug      # watch-round
npm run build:square     # watch-square（vivo WATCH GT 2 实机）

# 完整验收（check + 双设备构建 + rpk 内容断言）
npm run verify

# 资源与数据再生成（只在需要改素材/剧本时跑）
node tools/import_story.mjs
python tools/gen_assets.py
```

产物：`dist/watch-round/debug/galgad.lico.debug.1.0.0.rpk` 与
`dist/watch-square/debug/galgad.lico.debug.1.0.0.rpk`，各 **15.05 MiB**。
两个 device 可分别构建；**不要并发跑同一个 blueos-pack**。

> ⚠️ 构建语义（本次排障确认）：`blueos-pack build --debug` 是 **IDE 快速预览模式**，
> 只会编译入口页（rpk 里只有 `pages/Home`）。本工程 `tools/build.mjs --debug` 走
> `build` 子命令但**不透传** packer 的 `--debug`，因此是包含 7 页的完整 dev 包；
> 只有需要 entry-only 预览包时才用 `--entry-only`。

模拟器预览：用 BlueOS Studio 打开本目录，`.ide/settings.json` 默认
`watch-round`；`.preview.json` 保留模板默认值。

## 5. 验证手段（详见 `docs/VERIFICATION.md`）

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| IDE 同款定时器规则 | `tools/lint-timers.js` | 复刻 BlueOS IDE `apiParser.getTimerInfo` 字面 token 配对，0 error |
| 页面方法存在性 | `tools/check-methods.mjs` | 每个 `.ux` 的 `this.xxx()` 调用与模板处理器必须在页面对象里定义（防真机 `not a function`） |
| 剧本完整性 | `tools/validate-story.mjs` | 44 分块 / 5569 节点 / 18 章节 / 图片下标与文件存在 / 跳转目标 / CG 组 |
| 页面静态规范 | `tools/validate-pages.mjs` | 三段式 / 路由 / 事件与组件白名单 / CSS 红线 / features / 几何常量 / 版本号 |
| 引擎逻辑 | `tools/test-engine.mjs` | 全节点顺序执行、8 条策略、4 结局可达、通关判定、章节过滤、5457 个 say 存档往返 |
| 分页排版 | `tools/test-reader.mjs` | 5457 句 × 字号 14–30 × 圆/方屏（185,538 次）：不丢字 / 不超行 / 不超页 / 行宽不超 |
| 页面运行时（Game） | `tools/test-game-page.mjs` | 真实执行 Game 页脚本：进入阅读、60 次点击、4795 步到结局、菜单 12 按钮、手势、字号重排、自动/手动读档、`at` 跳转、销毁清理（46 项） |
| 页面运行时（其余 6 页） | `tools/test-pages.mjs` | Home 21 / Saves 49 / Chapters 22 / Gallery 43 / Settings 48 / About 39（222 项） |
| 官方构建 | `tools/build.mjs` | watch-round + watch-square 整包构建，`[INFO] finish compile` 且无 `[ERROR]`；rpk 内容断言（21 页面 / 45 剧本 / 171 图片） |

实测：`npm run verify` exit 0，全部 PASS；两个 rpk 各 15.05 MiB。详细数字与产物清单见
`docs/VERIFICATION.md`（含 2026-11-10 真机 `onTap` 崩溃的根因与修复记录）。

## 6. 真机注意事项 / 已知风险

- **屏幕常亮接口**：`@blueos.hardware.display.brightness.setKeepScreenOn` 在本机
  模拟器与参考工程中未实测；已包 `try/catch`，失败只是不常亮，不影响阅读。
- **鉴赏宽图缩放**：640×360 资源按 828×466 显示（约 1.29× 放大），来自宽图
  显示需求；若真机 `<image>` 对显式 px 缩放异常，正文/列表不受影响，可在
  设置里继续阅读。
- **无背景全景平移**：源工程的全景动效被移除，属性能优化取舍（见 §2）。
- **模拟器 vs 真机**：本工程按参考工程 `galgame` 的实机结论规避了
  百分比宽度、嵌套定位容器、`opacity` 容器、表冠 delta 等陷阱；仍建议在
  vivo WATCH GT 2 上按 `docs/VERIFICATION.md` 的清单人工回归一次
  「开始 → 连续翻页 → 选项 → 存档 → 读档 → CG 鉴赏 → 设置 → 关于彩蛋」。
- 应用包名 `galgad.lico`、名称「想成为Gal神」、版本 `1.0.0`。
