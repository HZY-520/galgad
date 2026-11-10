# GalGod（想成为 Galgame 领域大神！！！）· vivo 蓝河（BlueOS）手表移植版

把 PC 版 Ren'Py galgame **GalGod 1.0.0 / 2.5.2** 的小米手环 9 Pro 移植版
（[mcpotato1123/galgod-band](https://github.com/mcpotato1123/galgod-band)，Vela 快应用）
**完整移植**到 vivo 蓝河（BlueOS）手表平台的可运行工程。

- **目标设备**：vivo 蓝河手表，圆屏 466×466（`watch-round`）与方屏 432×514
  （`watch-square`，vivo WATCH GT 2 / BlueOS 3.0 实机），一套源码、分别出包。
- **平台**：BlueOS `@blueos.*` API，纯 CSS，`config.designWidth: 466`。
- **移植内容**：5569 个剧本节点（5457 句台词 / 15 个选择点 / 53 个选项）、
  18 个章节（14 正片 + 3 个隐藏结局 + 1 个后日谈）、4 种结局、
  127 张图片索引（38 背景 + 55 立绘 + 34 CG）、9 组 32 张 CG 鉴赏、
  存档/读档（6 手动槽 + 自动存档）、设置、关于页彩蛋（连点 7 次 + 小鱼干小剧场）。
- **状态**：官方 `blueos-pack` 双设备构建通过（`[INFO] finish compile`，无 `[ERROR]`），
  静态校验 / 剧本完整性 / 引擎全流程 / 分页排版测试全部 PASS。详见
  [docs/VERIFICATION.md](docs/VERIFICATION.md)。

> 剧本文字与全部美术资源版权归原作 **GalGod / 诺提拉观察所** 所有；本工程为
> 个人非商业性技术移植，代码部分沿用源工程 MIT 协议。详见 [NOTICE.md](NOTICE.md)
> 与 [LICENSE](LICENSE)。

## 快速开始

```bash
# 依赖：Node >= 18、BlueOS Studio（提供官方打包器）、Python3 + Pillow（仅资源流水线需要）

# 1) 静态校验 + 逻辑测试（无需模拟器）
npm run check

# 2) 官方打包（debug 侧载包，完整页面，不签名）
npm run build:debug      # watch-round  -> dist/watch-round/debug/*.rpk
npm run build:square     # watch-square -> dist/watch-square/debug/*.rpk

# 3) 一次性完整验收（check + 双设备构建 + rpk 内容断言）
npm run verify

# 可选：重生成剧本/图片（源工程在 ..\_galgod_band_src\galgod-band-main）
node tools/import_story.mjs
python tools/gen_assets.py
```

**用 BlueOS Studio 打开**：直接打开本目录；`.ide/settings.json` 默认
`watch-round`，模拟器预览即可。打包器路径（本机实测）：
`D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js`
（`blueos-pack 1.0.12-beta.13`）。

> ⚠️ `blueos-pack` 的 `build --debug` 是 **IDE 快速预览模式**，只编译入口页；
> 本工程 `tools/build.mjs --debug` 走 `build` 子命令但不透传 packer 的 `--debug`，
> 产出 **包含全部 7 个页面** 的 dev 包。需要 entry-only 预览包时用
> `node tools/build.mjs --entry-only --device watch-round`（不用于验收）。

release 包需要证书：在 BlueOS Studio 中生成签名后打包，或自行准备
`sign/private.pem` + `sign/certificate.pem`（本工程未内置证书）。

## 目录结构

```
galgad/
├─ src/
│  ├─ manifest.json          # 包名/图标/版本/features/deviceTypeList/designWidth 466/router
│  ├─ app.ux                 # 应用入口（生命周期与错误日志）
│  ├─ app.d.ts
│  ├─ assets/images/         # icon.png(114×114) / home.png(466×666)
│  ├─ common/
│  │  ├─ layout.js           # 版面几何 + 分页度量（页面 CSS 与之核对）
│  │  ├─ reader.js           # 设置 / 换行分页 / storage 封装 / 定时器收口
│  │  ├─ engine.js           # 剧本引擎纯逻辑（Node 可测的节点执行/分支/存档/章节）
│  │  ├─ story.js            # 索引 + 分块加载器（LRU 2 / 并发合并 / 预读）
│  │  ├─ asset.js            # 图片下标 -> URI（含 CG 鉴赏宽图）
│  │  ├─ assets.js           # 由源工程生成的图片索引表（127 项）
│  │  ├─ cglist.js           # CG 鉴赏 9 组（组名/缩略图/解锁条件/差分下标）
│  │  ├─ story/              # index.json + chunk-000..043.json（5569 节点）
│  │  └─ img/{b,s,c,w,t}/    # 背景/CG/立绘/鉴赏宽图/缩略图（+lock.png）
│  └─ pages/                 # Home / Game / Saves / Chapters / Gallery / Settings / About
├─ tools/                    # 剧本导入、资源流水线、构建、lint、校验、逻辑测试
├─ scripts/reports/          # 构建日志/摘要与各工具 JSON 报告
├─ docs/                     # 移植说明、实现规范、验证报告、参考文档
├─ dist/                     # dist/<device>/debug|release/*.rpk
└─ BlueOS开发文档.md         # 平台参考文档（本地资料）
```

## 移植与优化要点

| 项目 | 源工程（Vela / 手环 9 Pro） | 本移植（vivo 蓝河） |
| --- | --- | --- |
| 框架 | `@system.*` 快应用 | `@blueos.*`（router/storage/file/prompt/brightness/app） |
| 设计基准 | 336×480 | 466（圆屏 466×466；方屏设计宽 466、高约 554） |
| 页面数据 | `protected` | `data`（路由参数同名接收，`singleTask` + `onRefresh`） |
| 剧本 | 44 个 `.txt`（JSON 内容） | 44 个 `.json` 随包资源 + `file.readText` + LRU 2 分块缓存 |
| 正文 | 6 个固定 text 槽位 | 单 text + 运行时按字号分页（字号 14–30、圆/方屏不同文本区） |
| 背景动效 | 672 宽全景 + 10fps 定时器平移 | 静态 cover（低性能手表省 CPU/电量，见 docs/PORT-NOTES.md） |
| CG 鉴赏 | 854 宽图 touchmove 拖动 | 640×360 宽图按 828×466 显式 px 显示 + 触摸拖动/热区兜底 |
| 设置 | slider ×3 + 开关 | −/＋ 步进 + 药丸开关（蓝河实机更稳） |
| 手势 | `onswipe`/`onlongpress` | 顶部「≡」按钮 + 下滑手势开菜单；`touchstart/touchend` 自算右滑快退；长按用 longpress + 自计时快进 |
| 资源 | 源尺寸调色板 PNG | 按 466 重裁 + 8 位调色板（图片总量 6.4 MB，rpk 15.05 MiB） |

实机差异规避（参考工程 galgame/galgaoshou 的 vivo WATCH GT 2 实机经验）：
全屏扁平层 + 显式 px（不用百分比宽度/嵌套定位容器）、半透明用 rgba 而非容器
opacity、`<image>` 显式宽高 + object-fit、定时器统一 `armTimer/disarmTimer` 并在
`onHide/onDestroy` 清理、不使用 `scrollview/slider/onswipe/z-index/overflow` 依赖、
storage 调用放在 `onReady/onShow`（不在 `onInit`）。

## 验证

```bash
npm run check     # lint-timers / check-methods / validate-story / validate-pages / test-engine / test-reader / test-game-page
npm run verify    # 以上 + watch-round/watch-square 构建 + rpk 内容断言
```

| 工具 | 覆盖 | 结果 |
| --- | --- | --- |
| `tools/lint-timers.js` | BlueOS IDE feature-api 定时器配对规则 | PASS（0 error） |
| `tools/check-methods.mjs` | 页面 `this.xxx()` 调用与模板事件处理器存在性（防真机 `not a function`） | PASS（8 个 `.ux`） |
| `tools/validate-story.mjs` | 44 分块/5569 节点/18 章节/127 图片/跳转与 CG 组 | PASS |
| `tools/validate-pages.mjs` | 7 页三段式/路由/事件与组件白名单/CSS 红线/几何常量/版本号 | PASS（7/7） |
| `tools/test-engine.mjs` | 全节点执行、8 条策略、4 结局可达、通关判定、存档往返 | PASS（18/18） |
| `tools/test-reader.mjs` | 5457 句 × 17 字号 × 圆/方屏分页不变量、设置归一化 | PASS（7/7） |
| `tools/test-game-page.mjs` | Game 页运行时全链路（点击/分页/选项/结局/菜单按钮/手势/重排/读档） | PASS（46/46） |
| `tools/test-pages.mjs` | 其余 6 页运行时全链路（Home/Saves/Chapters/Gallery/Settings/About） | PASS |
| `tools/build.mjs` | 官方 blueos-pack 双设备构建 + rpk 内容断言 | PASS（2/2，15.05 MiB） |

详细数字、日志与 rpk 内容清单见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 版权与免责声明

- 本工程是**非官方、非商业性**的个人移植，与 vivo、小米、原开发方均无隶属关系。
- 剧本文字与全部美术资源版权归 **GalGod / 诺提拉观察所** 所有，仅用于学习交流，
  请勿用于任何商业用途；如版权方有异议，删除相应素材即可（代码不依赖具体内容）。
- 代码部分沿用源工程 MIT 协议（见 [LICENSE](LICENSE)），**MIT 不覆盖素材**（见
  [NOTICE.md](NOTICE.md)）。
