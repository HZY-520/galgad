# BlueOS 参考工程分析：可照抄的移植模式、实机坑与工具链

> 目标读者：`galgad`（vivo 蓝河 / BlueOS 手表，466 圆屏 + 432×514 方屏）的实现者。
> 本文只做「照着写」所需的事实提取；参考工程 A/B 均为**只读**，本文所有结论都带 `文件:行号` 证据。
>
> - 参考工程 A：`C:\Users\Administrator\BlueOSProjects\galgame`（《魔女的夜宴》Vela→BlueOS，vivo WATCH GT 2 实机验证，圆屏 466 + 方屏 390×450/432×514）
> - 参考工程 B：`C:\Users\Administrator\BlueOSProjects\galgaoshou`（《GAL 高手》Vela→BlueOS，官方 blueos-pack 双设备四组合构建 + 严格校验/资源优化）
> - 平台文档副本：`galgaoshou/BlueOS开发文档.md`（34,022 行，官方文档全文）
> - 类型定义：`galgad/node_modules/@types/blue-os/**`（本机 BlueOS Studio 同款 API 声明）
>
> 证据等级：**[实机]** = 真机实测；**[模拟器]** = BlueOS Studio 模拟器实测；**[构建产物]** = 官方 blueos-pack 编译产物核对；**[官方文档]** = `BlueOS开发文档.md`；**[类型]** = `@types/blue-os`；**[推导]** = 由以上事实计算得出（文中会标注）。

---

## 0. 速查（TL;DR，先看这一节）

| 事项 | 结论 | 证据 |
| --- | --- | --- |
| 官方打包器绝对路径 | `D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js` | `galgaoshou/tools/build.mjs:32`、`galgame/scripts/verify/build_check.ps1:29` |
| 打包器版本 | **1.0.12-beta.13**（vite 5.4.21；实测 node v24.21.0） | `blueos-pack/package.json`、`galgaoshou/scripts/reports` 构建日志首行 |
| 构建命令（双设备） | `node <blueos-pack>/bin/index.js build --device-type watch-round --debug -f`；`release` 用 `release --device-type ...` | `galgaoshou/tools/build.mjs:194-197`、`galgaoshou/README.md:111-116` |
| 成功判定 | 输出含 **`[INFO] finish compile`** 且 `dist/<device>/<debug|release>/` 生成新 `.rpk`；**不能只看退出码** | `galgaoshou/tools/build.mjs:38,249-267`；`galgame/README.md:160`；`galgame/scripts/verify/build_check.ps1:149-152` |
| 最高风险实机坑 | ①嵌套定位容器的宽度在 DPR≠1 真机上被二次换算（宽度≈设计值一半、文字每行 3~4 字）②`<image>` 百分比尺寸解析不可靠（缩放/定位偏左上）③表冠 `delta` 单次远大于 1 ④页面 JS 内联大剧本→实机卡死 | `galgame/scripts/reports/verify/real-device-issues.md:22-109`、`galgame/src/pages/cg-viewer/index.ux:2-21`、`galgaoshou/docs/PLATFORM-NOTES.md:100-113` |
| 资源预算 | 参考 A：src 资源 **15.22 MiB / 2283 文件**，release rpk 实测 **15,605,456 B（≈14.88 MiB）**；参考 B：素材 **497 张 / 8,040,707 B（7.67 MiB）** + 剧本 JSON **1,863,652 B**，release rpk 实测 **10,684,222 B（≈10.19 MiB）** | `galgame/scripts/reports/asset-build-report.md:11-22`、`galgaoshou/docs/ASSET-OPTIMIZATION.md:359-373`、`dist/` 实测 |
| 单帧解码内存预算 | 背景/事件 CG 466×466 RGBA ≈ **0.83 MiB/张**；立绘 212×520 ≈ **0.42 MiB/张**；CG 576×324 ≈ 0.71 MiB → 重裁 466×262 后 0.47 MiB；最坏单场景（背景+3 立绘+CG）≈ **2.9 MiB** | `galgame/scripts/build_assets.py:82-90`、`galgaoshou/docs/ASSET-OPTIMIZATION.md:196-208`、本文 §5.3 [推导] |
| 必须抄的 5 条验证规则 | ①定时器字面 token 配对 ②`.page{width:466px}`/禁 `position:relative` 等平台 CSS ③`<list>` 只许 `<list-item>` 且必须有 `type` ④`<image>` 不绑事件 ⑤`onInit` 不调 feature API | `galgaoshou/tools/validate-pages.mjs:34-49,459-477,487-525,548-580` |
| 目标工程当前必须改的配置 | `checkJs:true`/`noUnused*:true`→`false`；`app.d.ts` 改为 `/// <reference types="blue-os" />` 且删除 `Promise` 声明；manifest `deviceTypeList` 增 `watch-round`、`features` 按需补齐 | `galgad/tsconfig.json`、`galgad/src/app.d.ts`、`galgad/src/manifest.json`；参考值见 `galgame/tsconfig.json`、`galgame/src/app.d.ts`、`galgaoshou/src/manifest.json` |

**入口命令（参考工程可直接跑）**

```bash
# 参考 B（推荐照抄其工具链）
cd C:\Users\Administrator\BlueOSProjects\galgaoshou
node tools/lint-timers.js --root .      # 0 error
node tools/validate-story.mjs           # PASS
node tools/validate-pages.mjs           # PASS
node tools/test-engine.mjs              # 44/44
node tools/test-reader.mjs              # 45/45
node tools/build.mjs --debug   --device watch-round
node tools/build.mjs --release --device watch-square

# 参考 A（双设备构建 + 产物断言 + 实机回归工具）
cd C:\Users\Administrator\BlueOSProjects\galgame
powershell -NoProfile -File scripts/verify/verify_all.ps1      # lint→几何→模拟图→静态审查→构建/断言
node scripts/verify/lint_timers.js
powershell -File scripts/verify/build_check.ps1
```

---

## 1. 事实基线：环境、版本与产物

### 1.1 环境与工具版本

| 项 | 值 | 证据 |
| --- | --- | --- |
| BlueOS Studio | `D:\BlueOSStudio`（含 `BlueOS Studio.exe`、`resources/`、`tools/`） | 目录实测 |
| blueos-pack | `D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack`，`version=1.0.12-beta.13`，`engines.node>=18` | `blueos-pack/package.json` |
| Node | 实测 `v24.21.0`；构建日志内 `node: 24.21.0; vite: 5.4.21; commit: 7a50283d` | `galgame/scripts/reports/verify/logs/build-20261102-210433-watch-round.log:1` |
| 本机 Python | `C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（Pillow 12.3.0） | `galgaoshou/docs/ASSET-OPTIMIZATION.md:5`、`galgame/scripts/reports/asset-build-report.md:6` |
| IDE 语言服务（定时器规则来源） | `D:\BlueOSStudio\resources\app\extensions\blueos-language-features\server\dist\modes\script\hap\apiParser.js` | `galgaoshou/tools/lint-timers.js:6-9` |
| 目标工程类型声明 | `galgad/node_modules/@types/blue-os`（含 router/storage/file/prompt/deviceInfo/brightness 等 d.ts） | 目录实测 |

### 1.2 参考工程规模（实测数字，作为目标工程的预算锚点）

| 指标 | 参考 A（galgame） | 参考 B（galgaoshou） |
| --- | --- | --- |
| 页面数 | 7（index/detail/settings/saves/gallery/cg-viewer/about） | 5（Home/Reader/Settings/Saves/About） |
| 剧本 | 101 章 `src/common/scn/s0001..s0101.json`，4,617,190 B | 36 分块 `src/common/scn/chunk-000..035.json`，1,863,652 B |
| 图片 | 2283 个文件，15.22 MiB（bg 99 / ev 92 / th 92 / ch 1883 / ov 3） | 497 张，8,040,707 B（CG 133 + 立绘 171 + 背景 60 + Overlay 129 + UI 4） |
| src 资源合计 | 15,962,483 B（硬上限 16 MiB） | 素材 7.67 MiB + 剧本 1.78 MB |
| release rpk（实测） | `dist/watch-round/release/mndyy.galgame.lico.release.production.1.1.1.rpk` = **15,605,456 B** | `dist/watch-round/release/gal.gaoshou.lico.release.production.1.0.rpk` = **10,684,222 B** |
| debug rpk（README 记录） | ≈25.7 MB（含调试信息/原图） | 18.32 MB |
| 构建耗时 | round 15.099s / square 10.652s（最终回归） | 每组合 6–7s（README）；日志实测 13.14s |

证据：`galgame/scripts/reports/asset-build-report.md:9-22`、`galgame/README.md:172`、`galgaoshou/README.md:20-23,240-246`、`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:99-113`、`dist/` 实测。

> **目标工程建议**：素材 ≤ 8–10 MiB、剧本 ≤ 2 MiB、src 资源 ≤ 16 MiB；rpk ≈ src 体积量级（PNG 会被打包器再压缩/签名，比例参考：A 15.22 MiB→14.88 MiB，B 约 9.5 MiB→10.19 MiB）。

---

## 2. 工程脚手架（可复制）

### 2.1 目录骨架（官方模板 + 两个参考工程的收敛结果）

```
galgad/
├─ src/
│  ├─ app.ux                    # 应用入口（只放 app 级对象，可空）
│  ├─ app.d.ts                  # 全局类型声明
│  ├─ manifest.json             # 包名/图标/features/deviceTypeList/designWidth/router/display
│  ├─ assets/
│  │  ├─ images/                # 静态 UI 图（icon/cover/logo/背景…）
│  │  └─ styles/                # 模板自带 scss（BlueOS 工程建议纯 CSS，不再使用）
│  ├─ common/
│  │  ├─ js/ 或 story/          # 纯 JS 公共模块（不依赖 UI，可在 Node 里直接测）
│  │  └─ scn/                   # 剧本 JSON（必须 .json，随包资源）
│  └─ pages/
│     ├─ Home/index.ux          # 目录名可大写；组件名必须是 index（当前仅支持 index.ux）
│     └─ ...
├─ scripts/ 或 tools/           # 构建/校验/资源脚本
├─ sign/                        # release 签名（private.pem + certificate.pem，不入库）
├─ build/<device>/              # blueos-pack 中间产物（每设备一份）
├─ dist/<device>/<debug|release>/*.rpk
├─ .preview.json
├─ .ide/settings.json
├─ tsconfig.json
└─ package.json
```

证据：`galgaoshou/README.md:43-89`、`galgame/README.md:129-150`、官方文档 `BlueOS开发文档.md:20515`（`component` 只能 `index.ux`）。

### 2.2 `src/manifest.json` 完整字段（直接照抄参考 B，改成目标包名）

```json
{
  "package": "gal.gaoshou.lico",
  "name": "Gal高手",
  "versionName": "1.0",
  "versionCode": 1,
  "appCategory": ["games", "pastime"],
  "icon": "/assets/images/icon.png",
  "features": [
    { "name": "blueos.app.appmanager.router" },
    { "name": "blueos.app.app" },
    { "name": "blueos.storage.storage" },
    { "name": "blueos.storage.file" },
    { "name": "blueos.window.prompt" }
  ],
  "deviceTypeList": ["watch", "watch-square", "watch-round"],
  "config": { "designWidth": 466 },
  "router": {
    "entry": "pages/Home",
    "pages": {
      "pages/Home": { "component": "index" },
      "pages/Reader": { "component": "index", "followHand": "disable", "launchMode": "singleTask" },
      "pages/Settings": { "component": "index" },
      "pages/Saves": { "component": "index" },
      "pages/About": { "component": "index" }
    }
  },
  "display": { "backgroundColor": "#120d13" },
  "distrubuteRules": { "minAPILevel": 1 }
}
```

出处：`galgaoshou/src/manifest.json:1-64`。

**字段语义与可选值（官方文档）**

| 字段 | 说明 | 官方证据 |
| --- | --- | --- |
| `package` / `name` / `icon` / `versionCode` / `versionName` | 包名、应用名（≤6 汉字）、图标（114×114）、版本 | `BlueOS开发文档.md:20368-20384` |
| `features[]` | 绝大多数 API 必须声明，否则不能调用；打包后会被改写为 `system.*`（见下表） | `BlueOS开发文档.md:20375` |
| `deviceTypeList` | 可选 `watch,watch-square,watch-round,tv,car,phone` | `BlueOS开发文档.md:20378` |
| `config.designWidth` | 设计基准宽度；`px` 按实际屏宽等比缩放（dp 才是绝对单位） | `BlueOS开发文档.md:2589-2613` |
| `router.pages.<path>` | `component`（必须 index）、`path`、`launchMode`（standard/singleTask）、`followHand`（enable/disable） | `BlueOS开发文档.md:20513-20518,20528-20531` |
| `display.backgroundColor` | 窗口背景色 | `BlueOS开发文档.md:20544-20546` |
| `appCategory` | 必填，最多 2 个；游戏用 `games` | `BlueOS开发文档.md:20381,20394-20406` |

**features 声明名 → 编译后名（实测映射）**

| manifest 声明 | 编译进 `build/<device>/manifest.json` 的名字 |
| --- | --- |
| `blueos.app.appmanager.router` | `system.router` |
| `blueos.storage.storage` | `system.storage` |
| `blueos.storage.file` | `system.file` |
| `blueos.window.prompt` | `system.prompt` |
| `blueos.hardware.deviceInfo` | `system.device` |
| `blueos.network.fetch` | `system.fetch` |
| `blueos.app.app` | `blueos.app.app`（不变） |
| `blueos.hardware.display.brightness`（常亮用） | 推断为 `system.brightness`（同前缀映射规律；未见该工程实测） |

证据：`galgaoshou/build/watch-round/manifest.json`（features 段）、`galgame/build/watch-round/manifest.json`（features 段）。注意两份 build 产物里 `config.debug:true`、`minPlatformVersion:1070`、`bundleType:"blueos"` 是打包器自动追加的，不要手写。

### 2.3 `src/app.d.ts`（两个参考工程逐字节相同）

```ts
/// <reference types="blue-os" />

type Router = typeof import('@blueos.app.appmanager.router')

declare const global: {
  router: Router
}

declare const markRaw: <T>(value: T) => T
```

出处：`galgame/src/app.d.ts:1-9`、`galgaoshou/src/app.d.ts:1-9`。

- `markRaw` 是运行时全局（`@types/blue-os/global.d.ts:972`），用于避免剧本大对象被响应式深度代理；工程里仍建议写 `raw()` 兜底（`galgame/src/common/js/scene-store.js:24-30`、`galgaoshou/src/common/story/loader.js:38-45`）。
- **不要**在 `app.d.ts` 里声明 `Promise` 等内置类型（目标工程当前有，会引发 IDE 报错）。参考：`galgaoshou/docs/PLATFORM-NOTES.md:16`、`galgaoshou/README.md:365-366`。
- 页面实例上的 `$device`/`$element`/`$app` 没有类型声明（`@types/blue-os` 中 grep 不到），只能按官方文档使用（`BlueOS开发文档.md:20784-20819`）。

### 2.4 `tsconfig.json`（必须与参考工程一致，否则 IDE 报 Cannot find name / noUnused）

```json
{
  "compilerOptions": {
    "noImplicitAny": false,
    "strict": true,
    "noUnusedLocals": false,
    "noImplicitThis": true,
    "noUnusedParameters": false,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "checkJs": false,
    "lib": ["ES2022"],
    "outDir": "./build"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

出处：`galgame/tsconfig.json:1-20`、`galgaoshou/tsconfig.json`（同值）。目标工程 `galgad/tsconfig.json` 当前是 `noUnusedLocals:true / noUnusedParameters:true / checkJs:true`，**必须改**（`galgaoshou/docs/PLATFORM-NOTES.md:8-17`）。

### 2.5 `src/app.ux`（可空壳；只做应用级对象）

```html
<script>
export default {
  onCreate() {},
  onDestroy() {},
}
</script>
```

出处：`galgaoshou/src/app.ux:1-6`；参考 A 多 `onShow/onHide` 空实现（`galgame/src/app.ux:8-13`）。

- `app.ux` 编译后会包含 manifest 配置信息，**不要删除 `/**manifest**/` 注释标识**（`BlueOS开发文档.md:21408`）。
- 官方示例里 `import router from '@blueos.app.router'` 是**过期写法**（`BlueOS开发文档.md:21373`），实际必须用 `@blueos.app.appmanager.router`（`galgame/README.md:185`、类型定义 `@types/blue-os/app/appmanager/router.d.ts:5`）。

### 2.6 `.preview.json` / `.ide/settings.json`

```json
// .preview.json（两个参考工程完全相同）
{
  "modeOptions": { "current": -1, "list": [] }
}
```

```json
// .ide/settings.json（参考 B；参考 A 的 device 默认 watch-square）
{
  "blue-os-previewer.device": "watch-round",
  "blue-os-previewer.appUpdateMethod": 0,
  "blue-os-previewer.appMode": "app",
  "blue-os-previewer.resolution": {
    "watch-square": { "width": 390, "height": 450, "label": "390*450" },
    "watch-round": { "width": 466, "height": 466, "label": "466*466" }
  },
  "blue-os-previewer.otherSetting": ""
}
```

证据：`galgaoshou/src/.preview.json` 与 `galgaoshou/.ide/settings.json:1-18`；`galgame/.ide/settings.json:1-18`。

### 2.7 签名证书（release 必需，debug 不需要）

```powershell
$ossl = 'D:\BlueOSStudio\resources\app\extensions\blueos-debugger\OpenSSL-Win64\bin\openssl.exe'
$env:OPENSSL_CONF = 'D:\BlueOSStudio\resources\app\extensions\blueos-debugger\OpenSSL-Win64\bin\openssl.cfg'
& $ossl req -x509 -newkey rsa:2048 -keyout sign/private.pem -out sign/certificate.pem `
  -days 3650 -nodes -subj "/CN=gal.gaoshou.lico/O=galgaoshou-blueos/C=CN"
```

- 出处：`galgaoshou/README.md:156-180`。`sign/` 已在 `.gitignore` 忽略（`galgaoshou/.gitignore`；`galgame/.gitignore` 忽略 `/sign` 与 `/sign.zip`）。
- 参考 A 直接把 `sign/{private.pem,certificate.pem}` 打了 `sign.zip` 备份（`galgame/sign.zip` 内 2 个文件），换环境时解压到工程根 `sign/` 即可。
- 没有 sign 时 release 会报「缺少 release 签名私钥文件」；debug 用打包器内置调试签名（`galgaoshou/README.md:179-180`）。

### 2.8 目标工程 `galgad` 当前基线 vs 需要改的项

| 项 | 当前（galgad） | 参考值 / 需要改成 |
| --- | --- | --- |
| `tsconfig` | `checkJs:true`、`noUnusedLocals/Parameters:true` | 全部 `false`（见 §2.4） |
| `app.d.ts` | `/// <reference types="@blueos" />` + 自声明 `Promise` | `types="blue-os"`，删 `Promise`（见 §2.3） |
| `manifest.deviceTypeList` | `["watch","watch-square"]` | `["watch-round","watch-square"]`（要给圆屏出包时也保留 `watch`） |
| `manifest.appCategory` | `["other"]` | `["games"]` |
| `manifest.features` | 仅 router | 按用到的 API 补齐 storage/file/prompt/app 等（见 §2.2 表） |
| 页面 | `pages/Demo`、`pages/DemoDetail` | 新建 Home/Reader/Settings/Saves/…（`component` 必须 index） |
| `.ide/settings.json` | 无 resolution 段 | 补 watch-round/square 分辨率（见 §2.6） |

证据：`galgad/tsconfig.json`、`galgad/src/app.d.ts`、`galgad/src/manifest.json`、`galgad/.ide/settings.json`（本机实测读取）。

---

## 3. BlueOS 代码模式（照抄级）

### 3.1 `.ux` 文件结构与官方编译产物

一个 `.ux` = `<script>` + `<template>` + `<style>` 三段，**顺序不强制**：

- 参考 A 全部是 `script → template → style`（如 `galgame/src/pages/index/index.ux:1,92,108`）。
- 参考 B 的 `Saves`/`About` 是 `template → script → style`（`galgaoshou/src/pages/Saves/index.ux:1,50,271`），`Reader` 是 `script → template → style`（`galgaoshou/src/pages/Reader/index.ux:1,798,880`）。
- 官方原文：「ux 后缀文件由 javascript 代码、template 模板和 style 样式 3 个部分组成」，template **只能有一个根节点**（`BlueOS开发文档.md:21368,21390`）。

官方编译产物（`build/<device>/pages/<Page>/`，实测）：

| 文件 | 内容 | 实测例 |
| --- | --- | --- |
| `index.js` | `<script>` 编译后的 JS（含 import 展开） | `galgaoshou` Reader `40,527 B`；`galgame` detail `35,561 B` |
| `index.template.json` | 模板 AST（`type/class/style/$shown/attr/bind/children`，`if/for` 已编译成 `$shown`/`for` 字段） | `galgame/build/watch-round/pages/detail/index.template.json` |
| `index.css.json` | 样式表（**属性名 camelCase**：`backgroundColor`/`objectFit`/`borderRadius`/`fontSize`） | `galgame/build/watch-round/pages/detail/index.css.json` |
| `index.js.map` | source map（debug 构建） | 同上 |
| `index.snapshot` | 可选快照（`--enable-snapshot` 默认 watch 开启） | `galgaoshou/docs/OPTIMIZATION-CONTRACT.md:108` 记录 22,769 B（当前 build/ 目录未见该文件，属构建参数差异） |

### 3.2 import 清单（复制粘贴）

```js
// 路由 / 存储 / 提示 / 文件（页面与公共模块）
import router from '@blueos.app.appmanager.router'
import storage from '@blueos.storage.storage'
import prompt from '@blueos.window.prompt'
import file from '@blueos.storage.file'
import deviceInfo from '@blueos.hardware.deviceInfo'   // 可选
import brightness from '@blueos.hardware.display.brightness' // keepScreenOn 用

// 本地模块：相对路径 + 必须带 .js 后缀
import { paginateText } from '../../common/js/paginate.js'
import { loadScene } from '../../common/story/loader.js'
```

证据：`galgame/src/pages/detail/index.ux:10-28`、`galgaoshou/src/pages/Reader/index.ux:20-50`、`galgaoshou/src/common/story/loader.js:25-26`；`.js` 后缀要求见 `galgaoshou/docs/PORT-CONTRACT.md:139-140`、`galgaoshou/tools/validate-pages.mjs:557`（禁 `@system.`）。

> 不要在页面里写 `window/document/localStorage/fetch/require`（`galgaoshou/docs/PORT-CONTRACT.md:159`）；网络能力用 `@blueos.network.fetch`（`galgame/README.md:186`，目标工程无云存档可不声明）。
> **云存档/网络非必需**：参考 A 的 5 个云端槽位是可选功能（PHP 后端 + `@blueos.network.fetch` + `features:blueos.network.fetch`，`galgame/README.md:50-69`；`galgame/src/common/js/cloud-config.js:1-29`）；目标工程（GalGod）**没有云存档需求**，整块可删，也不需要 `blueos.network.fetch`/`blueos.hardware.deviceInfo`（除非要用 `deviceInfo` 取屏幕参数）。

### 3.3 页面生命周期与路由参数接收（核心模式）

```js
export default {
  data: {
    // 路由参数：在 data 中声明同名属性接收，值永远是 string
    auto: '',
    load: '',
    mode: 'load',
  },

  onInit() {
    // 只做纯数据初始化；禁止在此调用 storage/router/prompt/file（IDE 会报 feature-api）
  },

  onReady() {
    // 页面创建完成，feature API 从这里开始用
    this.loadData()
  },

  // singleTask 页面被再次打开：参数从 query 传入，onRefresh 在 onShow 之前执行
  onRefresh(query) {
    const params = query || {}
    this.auto = params.auto == null ? '' : String(params.auto)
    this.load = params.load == null ? '' : String(params.load)
    this.startReading()
  },

  onShow() { /* 回到前台：刷新设置/进度 */ },
  onHide() { /* 清定时器 + 落盘自动存档 */ },
  onDestroy() { /* 清定时器 + 释放大缓存 */ },
}
```

证据：`galgaoshou/src/pages/Reader/index.ux:96-240`（data 96-148、onInit 150-153、onReady 177-182、onRefresh 185-213、onHide 225-228、onDestroy 230-240）；`galgame/src/pages/detail/index.ux:107-193`；官方生命周期 `BlueOS开发文档.md:2197-2298`；`onRefresh` 在 `onShow` 之前、`singleTask` 语义 `BlueOS开发文档.md:2286-2292,20530`。

> 注意：`onInit` 不能调 feature API（`galgame/README.md:184`、`galgaoshou/tools/validate-pages.mjs:570-580`）。storage 读取放 `onReady`。

### 3.4 router：push / replace / back

```js
import router from '@blueos.app.appmanager.router'

router.push({ uri: '/pages/Reader', params: { auto: '1' } })
router.push({ uri: '/pages/Saves', params: { mode: 'load' } })
router.push({ uri: '/pages/Saves', params: { mode: 'save' } })
router.replace({ uri: '/pages/Home' })   // 清栈式回主页
router.back()                             // 返回上一页
```

证据：`galgaoshou/src/pages/Home/index.ux:80-106`、`galgaoshou/src/pages/Reader/index.ux:630-663`；类型签名 `@types/blue-os/app/appmanager/router.d.ts:12-83`；`params` 值统一转 String `router.d.ts:19-21`。

### 3.5 storage：JSON 读写封装（照抄 `save-store` 思路）

```js
import storage from '@blueos.storage.storage'

/** 读取一个 key 并 JSON.parse；不存在/损坏时返回 null（不报错） */
export function readJson(key, callback) {
  storage.get({
    key,
    success: (data) => {
      if (!data || typeof data !== 'string') { callback(null, null); return }
      try { callback(null, JSON.parse(data)) } catch (e) { callback(null, null) }
    },
    fail: () => callback(null, null),
  })
}

/** JSON.stringify 后写入 */
export function writeJson(key, value, callback) {
  storage.set({
    key,
    value: JSON.stringify(value),
    success: () => callback && callback(null),
    fail: () => callback && callback(new Error('storage write failed: ' + key)),
  })
}

export function deleteKey(key) {
  storage.delete({ key, success: () => {}, fail: () => {} })
}
```

出处：`galgame/src/common/js/save-store.js:15,34-64`；简化版 `galgaoshou/src/pages/Home/index.ux:43-64`、`galgaoshou/src/pages/Saves/index.ux:79-144`。

**坑**：`storage.get` 读不存在的 key 通常走 **fail**（不是 success+空串）。需要默认值时必须在 fail 分支也初始化并写回，否则每次冷启动都会丢数据（云存档 `player_id` 的血泪教训，`galgame/README.md:187`）。目标工程的阅读设置/存档读取请照此处理。

### 3.6 file：读取随包 JSON（剧本外置方案）

```js
import file from '@blueos.storage.file'

file.readText({
  uri: '/common/scn/chunk-000.json',   // 包内资源 URI；src/common/scn/*.json → 包内 /common/scn/*.json
  success: (data) => {
    const text = data && typeof data.text === 'string' ? data.text : ''
    const scenes = markRaw(JSON.parse(text))   // 大对象 markRaw，避免深层响应式
    // ...
  },
  fail: () => { /* 读取失败：toast + 保留原画面 */ },
})
```

- 证据：`galgaoshou/src/common/story/loader.js:25-29,107-149`、`galgaoshou/src/common/scn/chunk-000.json`（随包资源实测存在于 `build/watch-round/common/scn/`）。
- **实证**：参考 A 在模拟器逐页实测 `file.readText('/common/scn/s0001.json')` 读取随包剧本成功，打字机/分页正常（`galgame/README.md:115`）；参考 B 以 `build/<device>/common/scn/chunk-000..035.json` 进包、`features` 含 `system.file` 复核（`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:109`）。
- **必须是 `.json`**：blueos-pack 的资源收集排除 `.txt`（`galgame/README.md:179`、`galgame/scripts/reports/asset-build-report.md:78,213`、`galgaoshou/docs/PLATFORM-NOTES.md:105-107`）。
- 早期「file 读不了包内资源」是误判；正确结论是 `.txt` 没进包（`galgaoshou/docs/PLATFORM-NOTES.md:105-107`）。
- 大剧本不要内联进页面 JS：参考 B 曾把 36 个分块内联，Reader 单页 JS **1,884,887 B**、快照 **3,434,690 B**，实机进阅读页卡死重启；外置后 `index.js` **23,008 B（−98.8%）**（`galgaoshou/README.md:15-16,296-315`、`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:99-113`）。

**完整 loader 要点（可直接改造成 `common/story/loader.js`）**

```js
const CHUNK_DIR = '/common/scn/'
const CACHE_LIMIT = 2            // LRU 只留 2 块（当前+预取）
const chunkCache = {}
const chunkOrder = []
const pendingLoads = {}          // 同分块并发去重

function ensureChunk(info, callback) {
  const chunkIndex = info.index
  const cached = cachedChunk(chunkIndex)
  if (cached) { touchChunk(chunkIndex); if (callback) callback(null, cached); return }
  const waiting = pendingLoads[chunkIndex]
  if (waiting) { if (callback) waiting.push(callback); return }
  const callbacks = callback ? [callback] : []
  pendingLoads[chunkIndex] = callbacks
  file.readText({
    uri: info.path,
    success: (data) => {
      delete pendingLoads[chunkIndex]
      let scenes = null, error = null
      try { scenes = JSON.parse(data && typeof data.text === 'string' ? data.text : '') }
      catch (e) { error = new Error('剧情分块解析失败: ' + info.path) }
      if (!error && (!Array.isArray(scenes) || scenes.length !== info.count)) {
        error = new Error('剧情分块数据非法: ' + info.path)
        scenes = null
      }
      if (!error) { scenes = raw(scenes); storeChunk(chunkIndex, scenes) }
      deliver(callbacks, error, error ? null : scenes)
    },
    fail: () => { delete pendingLoads[chunkIndex]; deliver(callbacks, new Error('剧情分块读取失败: ' + info.path), null) },
  })
}
```

出处：`galgaoshou/src/common/story/loader.js:28-149`。LRU 实现 `:78-91`，`loadScene` 命中缓存同步回调 `:176-201`，`clearStoryCache` `:248-251`。

### 3.7 prompt / 输入法（`input` 隐藏 + `focus`）

```js
import prompt from '@blueos.window.prompt'
prompt.showToast({ message: '保存成功' })     // 只有 toast 一个 API（d.ts 仅 showToast）
```

```html
<!-- 隐藏 input：任意组件拉起输入法；show="false"，位置任意 -->
<input class="cloud-name-input" id="cloud-name-input" type="text" show="false"
       value="{{ cloudDraftName }}" @change="onCloudNameChange" />
```

```js
openNameEditor() {
  try {
    const el = this.$element('cloud-name-input')
    if (el && typeof el.focus === 'function') el.focus()   // 拉起系统输入法
  } catch (e) { /* 不阻断流程 */ }
},
onNameChange(event) {
  // 文档约定 change 参数是 { value }；兼容 detail.value / 字符串
  let value = ''
  if (event && typeof event === 'object') value = event.value !== undefined ? event.value : (event.detail && event.detail.value) || ''
  else if (typeof event === 'string') value = event
  this.cloudDraftName = String(value || '')
},
```

- 证据：`galgame/src/pages/saves/index.ux:442-464,738-744`；官方输入法用法 `BlueOS开发文档.md:9479-9532`；`prompt` 类型 `@types/blue-os/window/prompt.d.ts:11-20`。
- 真机命名输入法手感需人工复核（`galgame/README.md:127`）。
- 目标工程若需要「设置里改名」可照抄；不需要则完全不用 input。

### 3.8 `$device` / deviceInfo：圆屏 vs 方屏

```js
/** 只有明确是方形表才用 square；其余（含未提供 $device 的旧引擎）一律按 round 保守处理 */
function detectShape(device) {
  const type = device && device.deviceType != null ? String(device.deviceType) : ''
  return type === 'watch-square' ? 'square' : 'round'
}

// 页面里：
this.layoutClass = detectShape(this.$device) === 'round' ? 'layout-round' : ''
```

证据：`galgaoshou/src/pages/Reader/index.ux:91-94,177-182`、`galgame/src/pages/detail/index.ux:67-72,224`；官方 `$device` 定义 `BlueOS开发文档.md:20787`（`watch-square` 方形 / `watch-round` 圆形）。模板里也可写 `if="$device.deviceType == 'watch-square'"`（`BlueOS开发文档.md:2654-2658`），但**分页/逻辑必须用 JS**（媒体查询只改样式）。

`deviceInfo`（需要屏幕尺寸/密度时）：

```js
import deviceInfo from '@blueos.hardware.deviceInfo'
const info = deviceInfo.getInfoSync()      // 同步版；另有 getInfo({success})
// info.screenWidth / screenHeight / windowWidth / windowHeight / screenDensity / deviceType
```

证据：`@types/blue-os/hardware/deviceInfo.d.ts:441-539`（`getInfoSync`）；异步版 `:11-126`；官方 `BlueOS开发文档.md:7966-8032`。注意 d.ts 注释里 `deviceType` 写「手表版为 'watch'」，但页面 `$device.deviceType` 实际为 `watch-round/watch-square`（参考 A/B 的运行时判定），**圆方屏判定请用 `$device`**，不要用 `deviceInfo.deviceType` 的注释值。

### 3.9 圆屏/方屏布局切换 + VH 计算（可复制公式）

**A. 由 designWidth 推导方屏设计高度**（`height:100%` 换算）

```
方屏 390×450：scale = 390/466 ≈ 0.83691 → 设计高度 = 450/scale = 466*450/390 ≈ 537.69 设计 px
实机 432×514：scale = 432/466 ≈ 0.92704 → 设计高度 = 466*514/432 ≈ 554.45 设计 px
```

- 参考实现：`SQUARE_FALLBACK_HEIGHT = 537.7`（`galgame/src/pages/cg-viewer/index.ux:31-32`）；方屏注释「设计高度约 554」（`galgaoshou/src/pages/Home/index.ux:240`）；离线预览的换算 `scale=390/466≈0.8369`（`galgaoshou/tools/preview.mjs:26-33`，其注释写 537.85，实际应为 537.69，属小的文档漂移）。
- 运行时用 `getBoundingClientRect` 实测更稳：

```js
/** 读取视口宽高比，换算设计高度（用于竖直居中/平移 clamp）与触摸坐标归一化 */
measureViewport() {
  try {
    const element = this.$element('cg-gesture')
    if (element && typeof element.getBoundingClientRect === 'function') {
      element.getBoundingClientRect({
        success: (rect) => {
          const width = Number(rect && rect.width)
          const height = Number(rect && rect.height)
          if (width > 0 && height > 0) {
            st.viewportHeight = (DESIGN_WIDTH * height) / width   // 466 * h/w
            st.coordScale = DESIGN_WIDTH / width                  // 触摸/物理 px → 设计 px
            this.clampPan()
            this.syncImageStyle()
          }
        },
      })
    }
  } catch (e) {
    st.viewportHeight = BASE_HEIGHT   // 466
    st.coordScale = 1
  }
}
```

出处：`galgame/src/pages/cg-viewer/index.ux:268-291`（DESIGN_WIDTH=466、BASE_HEIGHT=466、SQUARE_FALLBACK_HEIGHT=537.7 见 `:27-32`）。

**B. 类切换 + 基础样式（方屏 base，圆屏覆盖）**

```html
<!-- 对白层扁平化：所有定位元素都挂 .page 下，圆屏只加 layout-round 类 -->
<div class="dialogue {{ layoutClass }}" if="{{ dialogueVisible }}"></div>
<text class="speaker {{ layoutClass }}" if="{{ dialogueVisible }}">{{ speaker }}</text>
<text class="line {{ textSizeClass }} {{ layoutClass }}" if="{{ dialogueVisible }}">{{ pageText }}</text>
<text class="next-hint {{ layoutClass }}" if="{{ dialogueVisible && canContinue }}">▼</text>
```

```css
/* 方屏 base：对白框 410×230、radius 30；正文 334×144 */
.dialogue { position:absolute; left:28px; bottom:10px; width:410px; height:230px;
            background-color:rgba(18,13,19,0.88); border-radius:30px; }
.line { position:absolute; left:66px; bottom:44px; width:334px; height:144px;
        color:#fff; font-weight:bold; text-align:center; }

/* 圆屏覆盖：对白框 406×290、radius 40；正文 310×144；文本块角距圆心 ≤215 */
.dialogue.layout-round { left:30px; width:406px; height:290px; bottom:0px; border-radius:40px; }
.line.layout-round     { left:78px; width:310px; height:144px; bottom:86px; text-align:center; }
```

出处：`galgame/src/pages/detail/index.ux:996-999,1149-1204,1427-1454`；圆屏安全半径与角距计算 `galgame/README.md:80,190`、`galgame/scripts/verify/layout_check.py:4-12`。

**C. 媒体查询是「编译期折叠」**

`@media screen and (device: watch-square) { ... }` 单次构建只保留当前设备的规则；`top:auto` 会被丢弃（`galgame/README.md:181`）。实测证据：同一份源码分别构建后

- `galgame/build/watch-round/pages/settings/index.css.json` 只有 `height:210px`（无 281px）；
- `galgame/build/watch-square/pages/settings/index.css.json` 只有 `height:281px`（无 210px）。

所以媒体查询适合**纯样式微调**（列表高度、logo 大小），不适合「改分页常量/改数据」——参考 B 的 Reader 圆方屏正文尺寸用运行时 `layoutClass` 解决（`galgaoshou/src/pages/Reader/index.ux:10,178-179`）。

### 3.10 `keepScreenOn` 等价实现（阅读/游戏页必做）

BlueOS 没有 Vela 的 `@system.brightness`，等价 API 是 **`@blueos.hardware.display.brightness` 的 `setKeepScreenOn`**：

```json
// manifest.features 增加
{ "name": "blueos.hardware.display.brightness" }
```

```js
import brightness from '@blueos.hardware.display.brightness'

setKeepScreenOn(on) {
  try {
    brightness.setKeepScreenOn({
      keepScreenOn: !!on,
      fail: () => { /* 老 ROM 不支持时静默降级 */ },
    })
  } catch (e) { /* 接口缺失时忽略 */ }
}
// 进入阅读页 onReady/onShow 调 setKeepScreenOn(true)；onHide/onDestroy 调 false
```

证据：官方文档 `BlueOS开发文档.md:7375-7410`（`brightness.setKeepScreenOn({keepScreenOn})`，接口声明 `blueos.hardware.display.brightness` 见 `:7168`，导入见 `:7177`）；类型 `@types/blue-os/hardware/display/brightness.d.ts:119-138`；同名字段语义见 `brightness.d.ts:115-123`。另可用 `wakeScreenOn({screenOn})`（`:179-199`）和 `setValue({value:0-255})`（`:38-57`）——但**不要**改系统亮度，用户会反感。

> 注意：参考 A/B 都**没有**调用该 API（grep 无命中），所以这是「按官方 API + 类型定义给出」的方案，真机需回归一次；建议包 try/catch，防止某些 ROM 抛错。

### 3.11 表冠事件（`@rotation` + `requestFocus` + `rotation-sensitivity`）

```html
<div class="gesture" id="cg-gesture"
     rotation-sensitivity="2"
     @rotation="onCrownRotation"
     @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchCancel"
     @longpress="onStageLongPress" @click="onStageClick">
</div>
```

```js
onReady() { this.measureViewport(); this.focusCrown() },
onShow()  { this.measureViewport(); this.focusCrown() },

/** 让手势层抢占表冠焦点（页面内只允许一个组件获焦） */
focusCrown() {
  try {
    const element = this.$element('cg-gesture')
    if (element && typeof element.requestFocus === 'function') element.requestFocus(true)
  } catch (e) { /* 元素未就绪时 onShow 会再次尝试 */ }
},

/**
 * 表冠旋转：delta 只取方向符号（真机单次 delta 可能远大于 1，直接累加会“一转缩数倍”），
 * 每事件固定步长；state=1（开始旋转）忽略；delta 缺失时用 direction 兜底。
 */
onCrownRotation(event) {
  if (!event || !this.hasImage) return
  if (event.state === 1) return
  let direction = 0
  const delta = Number(event.delta)
  if (Number.isFinite(delta) && delta !== 0) direction = delta > 0 ? 1 : -1
  else if (event.direction === true) direction = 1
  else if (event.direction === false) direction = -1
  if (direction === 0) return
  this.adjustZoom(direction * 0.1)   // ZOOM_STEP = 0.1，范围 1.0~3.0
},
```

证据：`galgame/src/pages/cg-viewer/index.ux:236-266,416-427`（`rotation-sensitivity="2"` 在 `:419`）；官方事件参数 `BlueOS开发文档.md:33946-33952`（`delta` 正常低速绝对值恒为 1，`state` 1 开始/2 旋转中/3 结束；`direction` 逆时针 true）；通用属性 `:33926-33931`；`requestFocus` 方法 `:33959-33961`。
**坑**：官方文档说 delta 正常为 ±1，但真机可能远大于 1 —— 以参考 A 实机修复为准（`galgame/README.md:195`）。

### 3.12 触摸 / 长按 / 拖动（含坐标换算与 click 吞噬）

```js
/** 触摸点优先级 clientX > pageX > offsetX：部分引擎/模拟器 pageX 恒为 0 */
readTouchPoint(event) {
  const list = event && event.touches && event.touches.length ? event.touches
             : event && event.changedTouches ? event.changedTouches : null
  const point = list && list.length ? list[0] : event
  if (!point) return null
  const pick = (a, b, c) => (a !== undefined && a !== null ? a : b !== undefined && b !== null ? b : c)
  const x = pick(point.clientX, point.pageX, point.offsetX)
  const y = pick(point.clientY, point.pageY, point.offsetY)
  if (x === null) return null
  return { x: Number(x) || 0, y: Number(y) || 0 }
},

onTouchStart(event) {
  const point = this.readTouchPoint(event)
  if (!point) return
  st.touchActive = true; st.touchMoved = false; st.suppressClick = false
  st.dragMode = false; st.longPressed = false
  st.startX = point.x; st.startY = point.y
  st.startPanX = st.panX; st.startPanY = st.panY
},

/** 长按：仅放大后进入拖动模式；其它情况无操作（并吞掉长按松手后的 click） */
onStageLongPress() {
  st.longPressed = true; st.suppressClick = true
  if (!this.hasImage) return
  if (st.zoom <= 1.001) return
  st.dragMode = true
},

onTouchMove(event) {
  if (!st.touchActive) return
  const point = this.readTouchPoint(event)
  if (!point) return
  const scale = st.coordScale || 1          // 物理 px → 设计 px
  const dx = (point.x - st.startX) * scale
  const dy = (point.y - st.startY) * scale
  if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) st.touchMoved = true
  if (!st.dragMode) return                   // 只有长按进入拖动模式后才平移
  st.panX = st.startPanX + dx; st.panY = st.startPanY + dy
  this.clampPan(); this.syncImageStyle()
},

onTouchEnd() {
  if (!st.touchActive) return
  st.touchActive = false
  const dragged = st.dragMode
  st.dragMode = false
  if (dragged || st.touchMoved || st.longPressed) st.suppressClick = true
  st.longPressed = false
},

onTouchCancel() { st.touchActive = false; st.touchMoved = false; st.dragMode = false
                  if (st.longPressed) st.suppressClick = true; st.longPressed = false },

onStageClick() {
  if (st.suppressClick) { st.suppressClick = false; return }
  this.toggleControls()
},
```

出处：`galgame/src/pages/cg-viewer/index.ux:295-381`（阈值 `MOVE_THRESHOLD=8` 在 `:38`）。

**点击/长按阅读文本**（参考 A detail）：

```js
onTap() {
  if (st.suppressHiddenClick) { st.suppressHiddenClick = false; return }
  if (this.loading || this.menu || this.showChoice || this.showEnd) return
  if (this.uiHidden) { this.uiHidden = false; this.dialogueVisible = st.wasDialogueVisible; this.syncChrome(); return }
  if (!this.dialogueVisible) return
  if (!this.canContinue) { this.finishTyping(); return }   // 未打完 → 立即完成
  this.advancePageOrLine()                                 // 已完成 → 下一页/下一行
},

onLongPress() {
  if (this.loading || this.menu || this.showChoice || this.showEnd || this.uiHidden) return
  st.wasDialogueVisible = this.dialogueVisible
  this.dialogueVisible = false; this.uiHidden = true
  st.suppressHiddenClick = true
  armTimer(st, 'suppressTimer', () => { st.suppressTimer = 0; st.suppressHiddenClick = false }, 500)
  this.clearAutoTimer(); this.syncChrome()
},
```

出处：`galgame/src/pages/detail/index.ux:689-722`。全屏点击层必须极淡背景：`background-color: rgba(16,10,16,0.02)`（`:1205-1212`）；`<image>` 不能绑事件，点击放覆盖 div（`galgame/README.md:183`、`galgaoshou/tools/validate-pages.mjs:487-495`）。

### 3.13 列表（`<list>` + `<list-item type>`）

```html
<list class="thumb-list">
  <list-item type="row" class="thumb-row" for="{{ rows }}" tid="leftIndex">
    <div class="cell" @click="openItem($item.leftIndex)">
      <image class="thumb" src="{{ $item.leftSrc }}"></image>
      <text class="thumb-title">{{ $item.leftTitle }}</text>
    </div>
    <div class="cell" @click="openItem($item.rightIndex)">
      <image class="thumb" src="{{ $item.rightSrc }}"></image>
      <text class="thumb-title">{{ $item.rightTitle }}</text>
    </div>
  </list-item>
</list>
```

规则（官方 + 参考 B 静态校验）：

- `<list>` **只能**直接包含 `<list-item>`（官方 `BlueOS开发文档.md:29916`；校验 `galgaoshou/tools/validate-pages.mjs:463-470`）。
- `<list-item>` 必须有 `type`；**相同 type 的 DOM 结构必须完全一致**（`BlueOS开发文档.md:29881-29883`；校验 `validate-pages.mjs:471-473`）。因此「空态/新建/自动存档/手动存档」要么用不同 type，要么拆多个 list-item（参考 A saves `:603,612,627`、gallery 两列一行 `:120-129`）。
- 动态列表用 `for="{{ rows }}"` + `tid` 指定唯一字段（`BlueOS开发文档.md:25509-25513`；`galgaoshou/BlueOS开发文档.md:23061` 提到 tid 用于 Diff 复用）。
- 列表本身支持 `scrollTo({index, behavior})`（**不是** scroll 组件）`BlueOS开发文档.md:29972-29987`；`scroll` 组件没有 `scrollTo` 方法（方法只有 `getScrollRect` / `revealScrollbar`，`:30117-30125`），但有 `scroll-top/scroll-bottom/scroll-left/scroll-right` 可绑定（`:30060-30068`）。

### 3.14 定时器收口（IDE feature-api 必过）

```js
/**
 * BlueOS IDE 的 feature-api 检查按字面 token 配对：
 * `const timer = setTimeout(...)` + `clearTimeout(timer)` 才能通过；
 * `st.typingTimer = setTimeout(...)` + `clearTimeout(st.typingTimer)` 会被误判。
 * 所有定时器统一通过这两个函数持有/清理。
 */
function armTimer(holder, key, handler, delay) {
  const timer = setTimeout(handler, delay)
  holder[key] = timer
  return timer
}
function disarmTimer(holder, key) {
  const timer = holder[key]
  holder[key] = 0
  if (timer) clearTimeout(timer)
}
```

- 出处：`galgame/src/pages/detail/index.ux:74-95`、`galgaoshou/src/pages/Reader/index.ux:72-89`。
- 全页**只允许 `armTimer` 里出现一处字面 `setTimeout`**；`onHide/onDestroy` 必须 disarm 全部句柄（`galgaoshou/docs/PLATFORM-NOTES.md:22-36`、`galgaoshou/README.md:368-387`）。
- 非响应式句柄放模块级 `st`（不要放 `data`），否则每次清定时器都触发 setData。
- 自检：`node tools/lint-timers.js --root .` 必须 0 error（`galgaoshou/README.md:386`）。

### 3.15 `markRaw`、非响应式状态与 setData 预算

```js
/** markRaw 兜底：运行时若未提供该全局函数则退化为普通对象 */
function raw(value) {
  try { return typeof markRaw === 'function' ? markRaw(value) : value }
  catch (error) { return value }
}

/** 非响应式运行时状态（模块级，避免被 Proxy 深度代理） */
const st = {
  nodes: [], flags: {}, choices: [], sceneId: '001', lineIndex: 0,
  pages: [], pageIndex: 0, currentText: '', typingFull: '', typingPos: 0,
  typingTimer: 0, autoTimer: 0, flowTimer: 0, loadToken: 0,
  paused: false, destroyed: false, dialoguesSinceAutoSave: 0,
}
```

- 出处：`galgame/src/pages/detail/index.ux:30-59,97-104`、`galgaoshou/src/pages/Reader/index.ux:54-70`。
- 原则：`data` 只放模板绑定的基本类型/小数组；整章剧本、flags、settings、大对象放模块级变量或普通实例属性；`nodes` 用 `markRaw` 包裹（`galgame/README.md:173`、`galgaoshou/README.md:312-315`）。
- 切场景时只对**变化了的**舞台 image 字段赋值（`galgaoshou/src/pages/Reader/index.ux:402-412`），避免一次切场景 10+ 次 setData。

### 3.16 分页（BlueOS 无 `scroll.scrollTo`，长对白必须分页）

```js
/** 对白文字区域（设计 px），必须与页面 .line 样式完全一致 */
export const TEXT_LAYOUTS = {
  square: { width: 334, height: 144 },
  round:  { width: 310, height: 144 },
}

export function paginationMetrics(fontSize, shape) {
  const size = Number(fontSize) || 26
  const layout = TEXT_LAYOUTS[normalizeShape(shape)]
  const lineHeight = Math.round(size * 1.38)          // 必须与 CSS line-height 一致
  const linesPerPage = Math.max(1, Math.floor(layout.height / lineHeight))
  // 12px 安全余量：粗体中文字形宽度可能略大于 fontSize，满宽会在行尾多挤一个字导致多一行
  const charsPerLine = Math.max(6, Math.floor((layout.width - 12) / size))
  return { fontSize: size, lineHeight, linesPerPage, charsPerLine,
           charsPerPage: charsPerLine * linesPerPage, textWidth: layout.width,
           textHeight: layout.height, shape: normalizeShape(shape) }
}
```

- 出处：`galgame/src/common/js/paginate.js:20-49`；参考 B 的同名模块 `galgaoshou/src/common/story/paginate.js:12-42`（`TEXT_LAYOUTS.round=270×132/square=334×116`，行高系数 1.4，字号默认 22）。
- 断页策略：先强标点（`。！？!?…」』】）)`），再弱标点（`，、；：,. `），最后硬切（`galgame/src/common/js/paginate.js:25-26,51-61`）。
- 圆屏/方屏的 `TEXT_LAYOUTS` 必须与页面 CSS 一一对应，否则分页与实际换行不一致、底部溢出（`galgame/README.md:81,190`；`galgame/scripts/verify/layout_check.py:4-12`）。
- 字号/行高必须一家：参考 A `22/26/30px → 30/36/41px`（`galgame/src/pages/detail/index.ux:1182-1193`、`README.md:81`），分页里 `lineHeight=Math.round(size*1.38)`（22→30、26→36、30→41）[推导]。

### 3.17 返回手势与按键（`onBackPress` / `onKey`）

**返回手势屏蔽（阅读页/游戏页必做）**

```json
// manifest：页面配置 followHand:disable，onBackPress 才生效
"pages/Reader": { "component": "index", "followHand": "disable", "launchMode": "singleTask" }
```

```js
onBackPress() {
  if (this.menu) { this.menu = false; return true }   // 返回 true = 拦截返回，不退出页面
  if (this.showEnd) { this.goHome(); return true }
  return true                                          // 阅读中禁止右滑返回，防止误退
},
```

- 证据：`galgaoshou/src/pages/Reader/index.ux:242-252`、`galgaoshou/src/manifest.json:42-46`；官方「只有当前页面配置了 `followHand:disable`，该接口才生效」`BlueOS开发文档.md:2262-2265`；`followHand` 默认 `enable` `:20518`。
- 注意：返回键/右滑与表冠是两套机制；`onBackPress` 只拦截返回动作，不处理表冠。

**按键事件（`onKey`，两个参考工程都未使用，目标工程按需）**

```js
onKey(event) {
  // event: { keyCode, keyAction, repeatCount }
  // keyCode：0=下键(电源键)，1=上键
  // keyAction：0=按下，1=短按弹起，2=长按弹起
  // repeatCount：长按时连续按下事件递增，第一个按下事件为 0
  if (event && event.keyCode === 1 && event.keyAction === 1) this.nextDialogue()
},
```

- 官方：`BlueOS开发文档.md:2310-2341`（参数表 `:2324-2331`，示例 `:2337-2341`）。参考 A/B 均未实现 `onKey`（grep 无命中），目标工程如用上键翻页/下键菜单，需要真机确认键值映射。

### 3.18 存档结构（可直接复用）

```js
// autoSave 与 recoveryData[] 的元素结构一致
{
  storyId: 'sanoba-witch',
  currentScnId: '001',
  currentLineIndex: 12,
  currentChapterName: 'chapter 1-1',
  gameFlags: { nen_flag: 1 },
  settings: { textSpeed: 25, textSize: 26, autoPlay: false, autoPlaySpeed: 'medium' },
  savedAt: 1730000000000,
  name: '自定义存档名'
}
```

```js
export const SETTINGS_KEY = 'settings'
export const AUTO_SAVE_KEY = 'autoSave'
export const RECOVERY_KEY = 'recoveryData'      // JSON 数组，手动存档槽
export const PENDING_SAVE_KEY = 'pendingSave'   // 阅读页 → 存档页的待保存数据，离开存档页删除
```

出处：`galgame/src/common/js/constants.js:19-32`、`galgame/src/common/js/save-store.js:1-14,67-79`；参考 B 同结构 `galgaoshou/docs/PORT-CONTRACT.md:57-91`、`galgaoshou/src/common/story/engine.js:151-182`。

**自动存档时机**：每 10 句 + `onHide/onDestroy` + 跳章节/选选项前（`galgame/src/pages/detail/index.ux:816-822,930-942`、`galgaoshou/src/pages/Reader/index.ux:754-794`）。

---

## 4. 实机坑清单（单列；每条含 现象 / 根因 / 修法 / 证据）

> 重要性排序：P0 = 不修会白屏/卡死/不可用；P1 = 实机明显错位/手感错误；P2 = IDE 报错或边角问题。
> 参考 A 的实机定量分析在 `galgame/scripts/reports/verify/real-device-issues.md`，是本文最有价值的一手材料。

### 4.1【P0】百分比宽度 + 嵌套定位容器 + DPR≠1 → UI 宽度减半、文字每行 3~4 字

- **现象**：vivo WATCH GT 2（432×514，DPR≈2）上，首页按钮/面板宽度只有模拟器的 ≈0.46 倍（`primary` 设计 280px，期望物理 259px，实测 119px），文字每行只剩 3~4 字；而 `left/top/height` 与模拟器 1:1（误差 ≤2%）。阅读页对白行距/面板 top 正常，只有水平宽度异常。
- **根因**：真机在「嵌套在另一个定位容器里的 absolute 子元素」上把 width 按逻辑像素/密度又换算了一次（宽度轴二次除 2）；百分比 `100%` 与显式 `px` 在该旧构建里同等受影响，不是单纯「百分比解析」问题。
- **修法**：
  1) 页面结构扁平化：`根节点 .page + 全屏 absolute 直接子层`；所有定位元素尽量直接挂 `.page`，纵向用 `bottom` 锚定；`.panel` 只做背景不承载子元素。
  2) 根容器/全屏层宽度写显式 **466px**（`height:100%` 可以），不要 `width:100%`。
  3) 实测仍需用 `getBoundingClientRect` 拿真实宽度做归一化（详见 §3.9）。
- **证据**：
  - 实机定量：`galgame/scripts/reports/verify/real-device-issues.md:22-59`（表格：real/sim = 0.46/0.44；文本每行 3~4 字 vs 设计 15 字）、`:90-109`（候选根因 1/2/3）、`:136-145`（修复方向）。
  - 扁平化代码：`galgame/src/pages/index/index.ux:2-14,92-106`（注释直接写明真机宽度二次换算）、`galgame/src/pages/detail/index.ux:990-999`（对白层扁平化注释）。
  - README 结论：`galgame/README.md:98,194`；参考 B 复述：`galgaoshou/README.md:400-404`、`galgaoshou/docs/PLATFORM-NOTES.md:44-57`。
  - **注意**：`real-device-issues.md:104-109` 明确说「单把 100% 改成 466px 不自动修复，需要扁平化 + 运行时测量」；两件事要一起做。

### 4.2【P0】`<image>` 百分比 width/height 解析不可靠 → CG 放大后偏左上

- **现象**：CG 鉴赏表冠放大后图片缩到左上角，不是中心缩放；真机与模拟器都能复现（所以是代码 bug，不是设备专属）。
- **根因**：旧实现用 `<image>` 的百分比 width/height/left/top 做缩放定位；平台对 image 百分比尺寸解析不可靠。
- **修法**：缩放几何全部用设计 px 内联样式，`object-fit: contain`：
  ```
  size = 466 * zoom
  left = (466 - size)/2 + panX
  top  = (VH  - size)/2 + panY
  ```
- **证据**：`galgame/src/pages/cg-viewer/index.ux:7-11,184-198,445-449`；实机分析 `galgame/scripts/reports/verify/real-device-issues.md:61-72`；README `galgame/README.md:95,194`。

### 4.3【P0】页面 JS 内联大剧本 → 实机进阅读页卡死/重启

- **现象**：点击「开始阅读」进入 Reader 后主线程长阻塞、内存峰值，低性能手表卡死或看门狗重启。
- **根因**：36 个剧情分块以 ES 模块字符串内联进 Reader 页面，单页编译 JS **1,884,887 B**、页面快照 **3,434,690 B**，约 2 MB 剧情文本一次性加载/求值并常驻。
- **修法**：剧本外置为随包 `.json` + `file.readText` 按需读取 + `JSON.parse` + `markRaw` + LRU 2 + 并发去重 + 加载令牌 + 全屏 loading；Reader `launchMode:singleTask` + `onRefresh`；`onDestroy` 释放缓存。
- **证据**：`galgaoshou/README.md:15-16,296-315`、`galgaoshou/docs/PLATFORM-NOTES.md:100-113`、`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:99-113`；参考 A 的同一做法 `galgame/src/common/js/scene-store.js:54-77`、`galgame/README.md:115-119,173`。

### 4.4【P1】表冠 `delta` 真机远大于 1 → 轻转一下缩数倍

- **现象**：表冠缩放极敏感，一档滚轮直接放大好几倍。
- **根因**：官方文档称低速时 `delta` 绝对值恒为 1（`BlueOS开发文档.md:33949`），但真机单次事件 delta 可远大于 1；直接累加会放大。
- **修法**：只取方向符号 `sign(delta)`，每个事件固定步长 0.1；`state===1`（开始）忽略；`direction` 兜底；zoom clamp 1.0~3.0。
- **证据**：`galgame/src/pages/cg-viewer/index.ux:236-254`（注释 + 实现）、`galgame/README.md:195`；官方参数 `BlueOS开发文档.md:33946-33952`。

### 4.5【P1】IDE feature-api 定时器报错（字面 token 配对）

- **现象**：IDE 报「此 setTimeout 未正确使用 clearTimeout 关闭，请检查代码」，定位到 `st.typingTimer = setTimeout(...)`。
- **根因**：IDE 规则只做字面 token 比较：赋值捕获组得到 `typingTimer`（丢前缀），而 `clearTimeout(st.typingTimer)` 的参数是 `st.typingTimer`，字符串不等即报错。
- **修法**：统一 `armTimer/disarmTimer`（局部变量持有句柄 + 同引用 clearTimeout），全页只留一处字面 `setTimeout`；`onHide/onDestroy` 清全部。
- **证据**：`galgame/README.md:73-75,189`、`galgaoshou/README.md:368-387`、`galgaoshou/docs/PLATFORM-NOTES.md:19-36`；规则复刻脚本 `galgaoshou/tools/lint-timers.js:11-18`（算法见 §6.4）。

### 4.6【P1】`private` / `protected` 不存在；响应式数据必须 `data` 声明或 `$set`

- **现象**：从 Vela 移植时页面状态全部不生效/模板不更新；或 `this.xxx = ...` 赋值不触发渲染。
- **根因**：BlueOS 无 `private/protected`，响应式数据必须先在 `data` 静态声明，或用 `this.$set(key,value)` 动态添加（`BlueOS开发文档.md:25310`）；`data` 属性名不能以 `$`/`_` 开头，不能用 `for/if/show/tid` 保留字（`:20712`）。
- **修法**：状态统一放 `data`；模板不绑定的会话状态放普通实例属性并在 `onInit` 初始化（Reader 的 settings/routeState/currentScene 等）。
- **证据**：`galgaoshou/src/pages/Reader/index.ux:155-175`、`galgaoshou/docs/PORT-CONTRACT.md:131-135`、`galgaoshou/README.md:288-289`；静态校验禁 `private:/protected:` `galgaoshou/tools/validate-pages.mjs:552-555`。

### 4.7【P1】`position: relative` 容器整棵子树不渲染

- **现象**：首页背景图正常，logo/进度/全部按钮不显示（模拟器/实机共性）。
- **根因**：平台不支持 `position: relative`，且模拟器中 relative 容器的整棵子树可能不渲染。
- **修法**：根节点 + 全屏 absolute 子层；定位元素直接挂 `.page`；纵向 `bottom`；不要用 `.home-content` 这种 relative+flex 包裹。
- **证据**：`galgame/README.md:180`、`galgaoshou/docs/PLATFORM-NOTES.md:46-49`、`galgaoshou/README.md:391-398`；校验规则 `galgaoshou/tools/validate-pages.mjs:36-41`。

### 4.8【P1】`overflow / z-index / box-shadow / filter / 多值 border-radius / top:auto` 不支持或无效

- **现象**：写了不报错但不生效；或 IDE 报 `border-radius` 值无效 / 不支持 `overflow`。
- **根因**：平台 CSS 子集限制；`border-radius` 只支持单值；`top:auto` 会被丢弃。
- **修法**：裁剪用固定尺寸+出屏隐藏；层级用 DOM 顺序（后写的层在上）；阴影用边框/半透明背景模拟；圆角写单值；跨设备差异用媒体查询/运行时 deviceType。
- **证据**：`galgame/README.md:181-182`、`galgaoshou/README.md:389-398`、`galgaoshou/docs/PLATFORM-NOTES.md:38-40`；静态校验 `galgaoshou/tools/validate-pages.mjs:36-47,616-621`。
- 补充：官方通用样式表里 `opacity` 是支持的（`BlueOS开发文档.md:33334`），但参考工程**不用 opacity 做遮罩/显隐**：半透明层一律用 `rgba()` 背景色，显隐用 `if` 销毁；可点层必须极淡背景（见 4.9）。这是规避性实践，未观测到 opacity 本身报错。

### 4.9【P1】完全透明的 div 收不到 touch/click

- **现象**：全屏手势层/点击层点击无反应。
- **根因**：完全透明 div 在部分机型/模拟器上不参与命中测试。
- **修法**：给可点层极淡背景 `rgba(0,0,0,0.02)`（参考 A 用 `rgba(16,10,16,0.02)`），文字/按钮仍可正常显示。
- **证据**：`galgame/README.md:192`、`galgame/src/pages/detail/index.ux:1205-1212`、`galgame/src/pages/cg-viewer/index.ux:450-457`；`galgaoshou/src/pages/Reader/index.ux:1058-1065`。

### 4.10【P1】`scroll` 没有 `scrollTo`；长对白不能做滚动跟随

- **现象**：Vela 的 `scroll` 跟随滚动/`scrollTo` 在 BlueOS 无效；长对白底部被圆边裁掉。
- **根因**：`scroll` 组件没有 `scrollTo()` 方法（方法只有 `getScrollRect`/`revealScrollbar`，官方 `BlueOS开发文档.md:30117-30125`；但有可绑定的 `scroll-top/scroll-bottom/scroll-left/scroll-right` 属性）；`list` 有 `scrollTo({index})`，别混淆（`:29972-29987`）。
- **修法**：长对白「分页点击」；设置/关于等长内容用 `<scroll scroll-y="true" bounces="true">` + flow 内容；不要程序化滚动。
- **证据**：`galgame/README.md:36,183,190`、`galgaoshou/README.md:291,409`；官方 scroll 属性 `BlueOS开发文档.md:30060-30068`、list.scrollTo `:29972-29987`；校验禁 `scrollTo()` `galgaoshou/tools/validate-pages.mjs:558`。

### 4.11【P1】触摸坐标 `pageX` 恒为 0

- **现象**：模拟器上拖拽/滑动无位移或乱跳。
- **根因**：部分引擎 touch 对象的 `pageX/pageY` 恒为 0。
- **修法**：`clientX/clientY` 优先，`pageX/offsetX` 兜底；位移再乘 `coordScale = 466 / rect.width` 归一化到设计 px。
- **证据**：`galgame/README.md:196`、`galgame/src/pages/cg-viewer/index.ux:295-315`；`galgaoshou/README.md:408`。

### 4.12【P1】触摸坐标是物理 px，样式 px 是设计单位

- **现象**：方屏（物理 390 / 设计 466）上点按分区/滑动阈值/拖拽距离全部错位。
- **根因**：TouchEvent 坐标物理像素，样式 px 基于 `designWidth`。
- **修法**：先按 `getBoundingClientRect` 的宽度归一化，再做点按分区/滑动阈值/拖拽换算（见 §3.9 的 `coordScale`）。
- **证据**：`galgame/README.md:191`、`galgame/src/pages/cg-viewer/index.ux:268-291,340-354`。

### 4.13【P1】`onInit` 及之前不能调 feature API

- **现象**：IDE 报 feature-api 错误 / 冷启动读存档偶发失败。
- **根因**：生命周期要求 API 调用在 `onReady/onShow/事件回调`。
- **修法**：`onInit` 只做纯数据初始化；storage/file/router/prompt 全部放 `onReady` 之后。
- **证据**：`galgame/README.md:184`、`galgaoshou/tools/validate-pages.mjs:570-580`、`galgaoshou/docs/PORT-CONTRACT.md:134-135`。

### 4.14【P1】`storage.get` 读不存在的 key 走 fail

- **现象**：每次冷启动都像第一次启动，设置/设备 ID 丢失。
- **根因**：`storage.get` 在 key 不存在时通常走 **fail** 而不是 success；只在 success 分支初始化会永远读不到默认值再写回。
- **修法**：fail 分支也执行初始化 + `storage.set` 写回；读 JSON 时 success 里再 `try/catch`。
- **证据**：`galgame/README.md:187`、`galgame/src/common/js/save-store.js:34-50`、`galgaoshou/src/pages/Home/index.ux:43-64`。

### 4.15【P1】圆屏底部字幕安全区

- **现象**：圆屏最底行文字被圆边裁切；方屏布局直接套用圆屏常量导致半套布局。
- **根因**：圆屏可见区是半径 233 的圆；底部文本块四角到圆心 (233,233) 必须 ≤215 设计 px；媒体查询只能改样式、改不了分页常量。
- **修法**：圆屏对白面板 406×290/radius 40、正文 310×144 并上移（角距 213.6 <215）；分页 `TEXT_LAYOUTS.round` 同步 310×144；方屏 base 334×144；每行额外留 12px 安全余量。
- **证据**：`galgame/README.md:80-81,190`、`galgame/src/pages/detail/index.ux:1418-1454`、`galgame/src/common/js/paginate.js:20-49`；几何校验 `galgame/scripts/verify/layout_check.py:4-12`；官方圆屏可用宽度建议 `galgaoshou/docs/PORT-CONTRACT.md:156-157`。

### 4.16【P1】方屏/圆屏媒体查询是编译期折叠

- **现象**：同一份源码双设备出包后，一个设备的样式覆盖丢失/互相污染；`top:auto` 不生效。
- **根因**：`@media screen and (device: watch-square)` 在单次构建只保留当前设备规则；`top:auto` 被平台丢弃。
- **修法**：媒体查询只做纯样式微调；运行时布局/分页用 `$device.deviceType` + `layoutClass`；跨设备定位用 `bottom`/显式 px。
- **证据**：`galgame/README.md:181`、`galgaoshou/README.md:293,340-341`；构建产物对照见 §3.9.C。

### 4.17【P2】`slider` 没有 `step`；项目改用 `- / +` 步进按钮

- **现象**：想用 slider 做字号/速度调节，发现没有 step，change 回调 `progress` 是连续值。
- **根因**：BlueOS slider 属性只有 `min/max/value/type/show-block`，事件是 `{progress, isFromUser}`，没有 step（官方 `BlueOS开发文档.md:32303-32348`）。
- **修法**：设置页用 `- / +` 按钮（48×48）+ 三个互斥 `if` 的档位按钮；对值做 `stepValue()` 取整；预览框用 `style="{{ previewStyle }}"` 内联绑定字号。
- **证据**：`galgaoshou/src/pages/Settings/index.ux:2-10,33-39,47-58,171-213`、`galgame/src/pages/settings/index.ux:116-159`；静态校验禁 slider `step` `galgaoshou/tools/validate-pages.mjs:474-476`。

### 4.18【P2】`switch` / `input` 可用，但要按官方语义用

- **事实**：`switch` 存在（属性 `checked`，事件 `change {checked}`，官方 `BlueOS开发文档.md:32352-32415`）；`input` 存在（`type: button/checkbox/radio/text/date/speak`，事件 `change`，官方 `:31750-31796`）；参考工程**没用到 switch**，开关类设置都用互斥按钮/`if` 文案（`galgaoshou/src/pages/Settings/index.ux:194-202`）。input 只用于「隐藏 + focus 拉输入法」（`galgame/src/pages/saves/index.ux:738-744`）。
- **建议**：目标工程设置页继续用按钮方案（与参考一致、样式可控）；需要文字输入时才用隐藏 input。

### 4.19【P2】`scrollview` 不存在；组件名是 `scroll`

- 官方组件表：容器组件为 `div/list/list-item/stack/swiper/scroll`（`BlueOS开发文档.md:30012-30019`）；`scroll-view`/`textarea`/`rich-text` 在官方文档中无对应组件（grep 0 命中）。
- 替代：`scroll`（属性 `scroll-x/scroll-y/bounces`，官方 `:30060-30068`）；多行文本用多个 `text`/`div`+`lines` 控制，不用 textarea。
- 其它可用组件：`image/text/span/a/progress/canvas/webgl/video` 等基础/画布组件、`swiper`、`stack`、`slider`、`switch`、`input`、`picker`、`vw-*` 系统风格组件（官方目录见 `BlueOS开发文档.md:27699+,29830+,30344+,30604+,31674+`）。

### 4.20【P2】IDE/构建工具链坑（退出码、并发、签名、.txt）

- **退出码不可信**：打包器把 tailwind 警告写 stderr，进程退出码可能为 0（失败）或 1（成功）；必须以日志 `finish compile in` + dist 新 rpk 判定（`galgaoshou/README.md:139-141`、`galgame/README.md:160`）。
- **并发构建偶发失败**：同机多个 blueos-pack 并发时随机页面报 `[plugin-ux] Could not load ... Cannot read properties of undefined (reading 'style')`（日志无 finish）；修法=串行 + 构建前等待静默 + 重试加 `--force`（`galgame/scripts/verify/README.md:118-123`、`galgame/scripts/verify/build_check.ps1:67-71,113-132`；`galgaoshou/README.md:153-154`）。
- **缺签名**：release 需要 `sign/private.pem`+`sign/certificate.pem`（`galgaoshou/README.md:156-180`）。
- **`.txt` 不进包**：随包数据必须 `.json`（§3.6）。
- **官方本地文档过期**：示例 import 写 `@blueos.app.router`（`BlueOS开发文档.md:21373`），实际必须 `@blueos.app.appmanager.router`；`deviceInfo.deviceType` 注释写 `'watch'`（`:8032`），而 `$device.deviceType` 是 `watch-round/watch-square`。**以类型定义 + 两个实机工程为准。**

### 4.21【P2】参考工程内部文档漂移（写目标工程时别照抄错）

- `galgame/README.md:99,126,197` 提到隐藏诊断页 `pages/diag`，但当前 `src/pages/` 只有 7 个页面、`src/manifest.json` 也没有注册 diag（`galgame/src/manifest.json:37-69`；`glob src/pages/**/index.ux` 实测 7 个）。**diag 页已不存在**，需要诊断时自己新建临时页。
- `galgame/README.md:108` 自己承认 `assert_build.js` 有 4 项圆屏 CSS 期望值与当前页面不一致（陈旧断言），跑构建校验时可能误报。
- `galgaoshou/README.md:20` 记 release rpk 10.40 MB，但当前 `dist/watch-round/release/*.rpk` 实测 10,684,222 B（≈10.19 MiB）；以文件实测为准，README 数字会随资源优化漂移。
- `galgaoshou/tools/preview.mjs:26-33` 注释写方屏设计高度 537.85，实际应为 466×450/390≈537.69（`galgame/src/pages/cg-viewer/index.ux:31-32` 用 537.7）。

---

## 5. 资源优化流水线（单列）

### 5.1 参考 A：`scripts/build_assets.py`（源 Vela 资源 → BlueOS 优化资源，幂等）

**用途与命令**

```bash
# 默认：自动调色板（体积预算 15.5 MiB，硬上限 16 MiB）
python scripts/build_assets.py
# 更激进的体积预算（更多降色）
python scripts/build_assets.py --budget-mb 12
# 固定参数（bg 48 色 / ev 40 色 / 开 dither——仅调试用）
python scripts/build_assets.py --bg-colors 48 --ev-colors 40 --dither
# 覆盖源路径
python scripts/build_assets.py --source <原项目资源目录>
# 校验生成物（引用存在 / 尺寸 / 调色板 / 体积上限 / 报告）
python scripts/validate_assets.py
```

出处：`galgame/scripts/build_assets.py:7-13`、`galgame/README.md:161-165`。

**关键参数（源码常量）**

```python
TARGET_IMAGE_SIZE = 466        # bg / ev / cover 输出边长
THUMB_SIZE = 112               # th 缩略图边长
THUMB_COLORS = 64              # th 调色板色数
BODY_SIZE = (212, 520)         # body / face 保持的画布尺寸
CH_MAX_COLORS = 128            # body / face 调色板上限
OVERLAY_MAX_WIDTH = 232        # overlay 物件图最大宽度
COVER_COLORS = 128             # cover 调色板色数
ICON_SIZE = 114                # 应用图标边长
LOGO_WIDTH = 320               # 标题 logo 目标宽度
DEFAULT_BUDGET_MIB = 15.5      # 受 scn+ch 固定体积限制
HARD_LIMIT_MIB = 16.0
PALETTE_CANDIDATES = [(128,128),(112,112),(96,96),(80,80),(64,64),(64,56),
                      (56,48),(56,40),(48,48),(48,40),(48,32),(40,32),
                      (32,24),(24,16),(16,16)]
```

出处：`galgame/scripts/build_assets.py:82-102`。

**算法（逐类）**

| 资源 | 处理 | 输出 | 证据 |
| --- | --- | --- | --- |
| bg（背景） | 源 432×514 → RGB → **中心裁正方形 432×432** → LANCZOS 放大 **466×466** → 调色板 P48（无 dither） | 99 张 / 5,330,311 B / 均值 53,842 B | `build_assets.py:185-209`、`scripts/reports/asset-build-report.md:28` |
| ev（事件 CG） | 同 bg → P40（无 dither） | 92 张 / 3,467,567 B | `asset-build-report.md:29` |
| th（缩略图） | ev RGB **contain 到 112×112 黑底** → P64 | 92 张 / 409,112 B（源 4,842,814 → 8.4%） | `asset-build-report.md:30` |
| ch（立绘 body/face） | 保持 **212×520** 画布；P 图无损重建（≤128 色，逐索引 alpha 保留） | 1883 张 / 1,878,477 B（≈100%） | `build_assets.py:212-278,769-796`、`asset-build-report.md:31` |
| ov（overlay 物件） | 等比缩到 **≤232 宽** → P≤128；另生成 1×1 透明占位 `ov/9.png` | 3 张 / 10,217 B | `asset-build-report.md:32`、`build_assets.py:798-836` |
| assets（icon/cover/logo） | icon 114×114；cover 中心裁 430×430→466×466→P128；logo 宽 320 RGBA | 3 张 / 222,240 B | `build_assets.py:839-877`、`asset-build-report.md:33` |
| scn（剧本） | 101 章：解析 runtime scene-index + resource-manifest + character-map，烘焙成紧凑 JSON 指令数组（type 0~6），扩展名改 `.json` | 101 个 / 4,617,190 B（91.3%） | `build_assets.py:540-685`、`asset-build-report.md:74-101` |
| data | `scenes.js`（章节索引 101 条 6 分类）、`cg.js`（92 条 6 分组） | 2 个 / 10,310 B | `asset-build-report.md:116-133` |

**调色板取舍（实测）**

| 方案 | bg+ev 体积 | 工程总量估算 | 结论 |
| --- | ---: | ---: | --- |
| 契约默认 128 色 + dither | 15.12 MiB | ≈21.95 MiB | ❌ 超 16 MiB |
| **最终 48/40 色、无 dither** | **8.39 MiB** | **15.22 MiB** | ✅ |
| dither 开启 | +≈15% 体积 | — | ❌ 且平涂区域明显噪点 |

出处：`galgame/scripts/reports/asset-build-report.md:37-72`；源调色板采样外推表 `:46-60`。**结论：466×466 的 bg/ev 必须降到 40~48 色并关 dither，否则爆 16 MiB。**

**产物报告**：`scripts/reports/asset-build-report.md`（体积总览/图片明细/调色板取舍/剧本烘焙/缺失清单/幂等性/兜底方案）；预览图 `scripts/reports/preview/palette-comparison.png` 等。

**兜底方案**：若运行时不能读随包资源，可 `python scripts/build_scene_bundle.py` 生成 `src/common/data/scene-bundle.js`（+4.40 MiB，超 16 MiB 上限），并把 `scene-store.js` 改为静态 import（`galgame/scripts/reports/asset-build-report.md:226-236`、`galgame/README.md:166`）。目标工程**不推荐**，只作为最后手段。

### 5.2 参考 B：`tools/optimize_images.py`（审计/无损重压缩/清理未引用/CG 重裁/校验）

**命令**

```bash
# 审计（dry-run，只统计不写）
python tools/optimize_images.py --json-out report.json
# 无损重压缩（逐文件校验后原子替换；再跑一次应显示 0 张可缩）
python tools/optimize_images.py --apply --json-out report-after.json
# 列出未引用图（dry-run）
python tools/optimize_images.py --delete-unused
# 删除（移入 %TEMP% 备份目录，可回滚；不硬删）
python tools/optimize_images.py --delete-unused --apply
# CG 重裁 + 调色板量化（dry-run 输出逐张 PSNR/体积；--apply 执行）
python tools/optimize_images.py --resize-cg
python tools/optimize_images.py --resize-cg --apply
# 最终校验（可解码 / 引用存在 / CG 尺寸）
python tools/optimize_images.py --verify
```

出处：`galgaoshou/tools/optimize_images.py:12-20,686-710`、`galgaoshou/docs/ASSET-OPTIMIZATION.md:273-284,408-420`。

**算法与门禁**

1. **无损重压缩**：Pillow 解码 → 尝试 3 种编码（`optimize=True,compress_level=9` / `optimize=True` / `compress_level=9`）取最小；仅当「更小 + 尺寸/模式不变 + RGBA 像素逐字节一致 + 写盘后可解码」才原子替换。
2. **未引用清理**：扫描 `src/**` 全部文本文件的 `/assets/images/<file>` 字面引用（排除 images 目录自身）；额外确认无动态拼接/require；零引用者移入 `%TEMP%\galgaoshou-images-deleted-backup`。
3. **CG 重裁 + 量化**：只处理剧情 `cgImage.image` 引用的 CG；`Image.LANCZOS` 缩到 **466×262**（466 宽 `object-fit:contain` 的 16:9 实际显示框）；`quantize(colors=48, method=FASTOCTREE)` 无 dither；PSNR（RGB 三通道）<30 dB 回退 64 色，再不行保留原图；写入后重新解码复核尺寸/PSNR。
4. **质量指标**：PSNR、平均/最大 ΔE76、alpha 变化统计（`optimize_images.py:471-492`）。
5. **报告**：`docs/ASSET-OPTIMIZATION.md`（含回滚路径、复现命令、逐类体积、PSNR 表）。

**关键常量**

```python
CG_TARGET = (466, 262)
CG_COLORS = 48
CG_FALLBACK_COLORS = 64
CG_PSNR_FLOOR = 30.0
```

出处：`galgaoshou/tools/optimize_images.py:67-70`。

**实测结果**

| 项 | 数字 | 证据 |
| --- | --- | --- |
| 素材 | 507 → **497 张**；8,828,965 → **8,040,707 B（−8.93%）** | `docs/ASSET-OPTIMIZATION.md:10-20` |
| 无损重压缩 | 491 张替换，−89,437 B（−1.01%）；**507/507 逐字节像素一致** | `:24-36,99-111` |
| 未引用删除 | 10 张，−280,979 B（−3.18%），可回滚 | `:304-329` |
| CG 重裁 | 133 张 576×324 → 466×262 / 48 色（1 张 64 色）；3,987,507 → 3,569,665 B（−10.48%） | `:331-357` |
| PSNR | min/mean/median = **30.49 / 35.59 / 34.97 dB**；0 张 <30 dB | `:342-352` |
| 解码内存 | 单张 746,496 → **488,368 B（−34.6%）** | `:356`、`README.md:330` |
| 最终校验 | 497/497 可解码、497 张引用全部存在、CG 133/133 为 466×262 | `:377-385` |

**可直接复用的取舍**：CG 目标尺寸=显示框尺寸（contain 下的 16:9），不是全屏 466×466；背景才用 cover 到 466×466。若 CG 做 cover 466×466 实测只再省 264,498 B 但会裁掉两侧画面（`ASSET-OPTIMIZATION.md:234-236`），且 466×466 解码内存比 466×262 高约 **78%**（[推导]：868,624 vs 488,368）。

### 5.3 体积预算与解码内存预算（给目标工程的建议值）

**实测像素 → 解码内存（RGBA 当量 = w×h×4）**

| 素材 | 尺寸 | 解码内存 | 说明 |
| --- | --- | ---: | --- |
| 背景 / 事件 CG（cover 满屏） | 466×466 | **868,624 B ≈ 0.83 MiB** | 参考 A bg/ev 输出尺寸；`build_assets.py:82` |
| CG（contain 16:9，参考 B 优化后） | 466×262 | **488,368 B ≈ 0.47 MiB** | `ASSET-OPTIMIZATION.md:356` |
| CG（优化前） | 576×324 | 746,496 B ≈ 0.71 MiB | `ASSET-OPTIMIZATION.md:200` |
| 立绘 | 212×520 | **440,960 B ≈ 0.42 MiB** | `build_assets.py:85` |
| 缩略图 | 112×112 | 50,176 B ≈ 0.05 MiB | `build_assets.py:83` |
| 3 立绘 + 背景 + CG 同时在场 | — | **≈2.9 MiB**（868,624 + 3×440,960 + 868,624） | [推导]；参考 B 的「最坏单场景≈1.9 MiB + CG 746 KiB」口径 `ASSET-OPTIMIZATION.md:208` |

**包体预算建议（目标工程）**

| 项 | 建议上限 | 依据 |
| --- | --- | --- |
| 素材总量 | ≤ 8–10 MiB | 参考 B 7.67 MiB + 剧本 1.78 MB 已可出 10.19 MiB release rpk；参考 A 15.22 MiB 逼近 16 MiB 上限 |
| 剧本 JSON | ≤ 2 MiB | 参考 A 4.4 MiB（101 章）/ 参考 B 1.78 MiB（4537 场景）；按目标剧本规模定 |
| src 资源合计 | ≤ 16 MiB | 参考 A 契约硬上限（`asset-build-report.md:22,92-94`） |
| release rpk | ≈ src 体积量级 | A 15.22 MiB→14.88 MiB；B ≈9.5 MiB→10.19 MiB（实测） |
| 单帧解码内存 | ≤ 4 MiB | 最坏 CG 场景 ≈2.9 MiB（[推导]），给系统/纹理留余量 |

### 5.4 未引用图清理（两种可复用做法）

1. **构建期只复制被引用图**（参考 A）：`build_assets.py` 解析 runtime 的 scene-index/resource-manifest/character-map，只把剧本实际命中的源图复制到 `src/common/img`（源 2080 → 复制 2080，剪枝 0 因为源本身无冗余；报告 `asset-build-report.md:134-147`）。**适用**：有一手源工程 + 映射表。
2. **已有工程事后清理**（参考 B）：扫 `src/**` 文本引用 → 零引用清单 → 移入 `%TEMP%` 备份（可回滚）→ 再跑 `--verify` 确认 497/497 引用存在。**适用**：目标工程已有一堆历史图。

清理后必须重跑：`node tools/validate-story.mjs`（图片存在性）、`python tools/optimize_images.py --verify`、构建产物抽检。

### 5.5 可直接改用的资源脚本骨架（目标工程）

```python
# tools/optimize_images.py 的核心参数（照抄参考 B）
CG_TARGET = (466, 262)      # 目标屏 466 宽、contain 16:9 的显示框
CG_COLORS = 48              # 无 dither；比参考 A 的 40 色更稳
CG_FALLBACK_COLORS = 64
CG_PSNR_FLOOR = 30.0

# 背景（cover 满屏）用参考 A 的做法：
#   源图 → RGB → 中心裁正方形 → Image.LANCZOS 到 466×466 → quantize(48, MEDIANCUT, 无 dither)
#   保存：im.save(out, "PNG", optimize=True)

# CG（contain）用参考 B 的做法：
#   源图 → RGBA → Image.LANCZOS 到 466×262 → quantize(48, FASTOCTREE) → optimize 重存
#   PSNR = 10*log10(255^2/MSE_rgb)（参考图=原图 LANCZOS 到目标尺寸）
```

出处：`galgame/scripts/build_assets.py:185-209`、`galgaoshou/tools/optimize_images.py:67-70,494-510`。

---

## 6. 构建与验证工具链（单列）

### 6.1 blueos-pack：绝对路径、版本、CLI 选项

- 路径：`D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js`
- 版本：`blueos-pack 1.0.12-beta.13`；`engines.node >= 18`；本机实测 node `v24.21.0`、vite `5.4.21`。
- 证据：`blueos-pack/package.json`；`galgaoshou/tools/build.mjs:32`；`galgame/scripts/reports/verify/logs/build-20261102-210433-watch-round.log:1`。

**两个子命令（`bin/index.js` 实测源码）**

| 子命令 | 关键选项 | 行为 |
| --- | --- | --- |
| `build` | `--debug`、`-f/--force`（禁缓存）、`--device-type <type>`、`--dpi <n>`、`--check-image-size`、`--enable-snapshot [value]`（watch 默认 true）、`--assets-include`、`--rpk-path dev`（默认） | debug 构建；`NODE_PHASE: dev`；输出 `dist/<device>/debug/` |
| `release` | 同 `build`，另 `--rpk-path prod`（默认） | release 构建；需要 `sign/`；输出 `dist/<device>/release/` |

证据：`blueos-pack/bin/index.js` 的 commander 定义（build/release 两段）；`galgaoshou/tools/build.mjs:194-197`。

### 6.2 `tools/build.mjs`：参数、成功判定、dist 布局、常见失败

```bash
node tools/build.mjs --debug   --device watch-round     # = npm run build:round
node tools/build.mjs --debug   --device watch-square
node tools/build.mjs --release --device watch-round
node tools/build.mjs --release --device watch-square
# 自定义打包器
$env:BLUEOS_PACK_BIN = "D:\BlueOSStudio\...\blueos-pack\bin\index.js"
```

- 打包器定位顺序：`BLUEOS_PACK_BIN` → `D:\BlueOSStudio\...` → `C:\Program Files\...` → `%LOCALAPPDATA%\Programs\BlueOSStudio\...`（`galgaoshou/tools/build.mjs:31-36,86-102`）。
- 实际命令：`node <packer> build|release --device-type <device> [--debug] -f`（`build.mjs:194-197`；`-f` 默认加，重试/冷编译用）。
- 成功判定：`SUCCESS_MARKER='[INFO] finish compile'` 且 `dist/<device>/` 下找到本次新生成的 `.rpk`（`mtime >= startedAt-5s`）；否则打印关键 ERROR 行并 exit 1（`build.mjs:38,150-160,249-277`）。
- dist 布局：`dist/<device>/<debug|release>/<package>.<mode>.<version>.rpk`。实测参考 A `dist/watch-round/release/mndyy.galgame.lico.release.production.1.1.1.rpk`；参考 B `dist/watch-round/release/gal.gaoshou.lico.release.production.1.0.rpk`。debug 命名参考 README：`gal.gaoshou.lico.debug.1.0.rpk`（`galgaoshou/README.md:149,240-243`）。
- **同一设备不要并发构建**；不同 device 可并行（`build.mjs:19-20`、`galgaoshou/README.md:153-154`）。

**常见失败与处理**

| 失败 | 现象 | 处理 | 证据 |
| --- | --- | --- | --- |
| 成功但退出码 0 | 日志无 `finish compile` | 以日志为准；打印 tail 30 行 + 关键 ERROR | `build.mjs:162-168,262-276` |
| 并发/缓存竞态 | `[plugin-ux] Could not load ... Cannot read properties of undefined (reading 'style')`，随机页面，无 finish | 串行 + 等待其它 blueos-pack 进程退出 + 重试 `--force`（最多 3 次） | `galgame/scripts/verify/README.md:118-123`、`galgame/scripts/verify/build_check.ps1:109-132,72-97` |
| 缺 release 签名 | 「缺少 release 签名私钥文件」 | 生成/放置 `sign/private.pem`+`sign/certificate.pem` | `galgaoshou/README.md:156-180` |
| 页面编译错 | 日志 `[ERROR]`/`BError` | 以首条 ERROR 定位；先跑 validate-pages/lint-timers | `galgame/scripts/verify/build_check.ps1:149-152` |

### 6.3 产物断言（`assert_build.js` / build_check）

- `build_check.ps1`：复制 `src/ + package.json + tsconfig.json + .ide/` 到 `%TEMP%\galgame-verify\build-<stamp>`（**不在工程 build/ 里编译**，避免多人互相覆盖）→ 双设备构建 → `assert_build.js` 断言产物 → JSON 报告（`galgame/scripts/verify/build_check.ps1:1-16,52-64`）。
- `assert_build.js` 断言类型（`galgame/scripts/verify/assert_build.js:1-16`）：
  1) `build/<device>/pages/detail/index.css.json` 的 CSS 数值（`.line` 334×144、`.line-22/26/30` 行高、`.dialogue` 410×230/radius 30、圆屏 `.layout-round` 310×144 等）；
  2) 双设备 base CSS 一致（方屏不被圆屏数值污染）；
  3) 与改动前备份 CSS 逐值 diff（可选）；
  4) `cg-viewer` 产物含新交互的编译痕迹（纯 px 缩放、`.cg` 无百分比尺寸、`@longpress`/`dragMode`、`clientX` 优先、`.drag-tip`）。
- 常用命令：`node scripts/verify/assert_build.js --build-root <dir>/build --devices watch-round,watch-square --stage final --json out.json`（`galgame/scripts/verify/README.md:64`）。
- 构建产物结构：`build/<device>/{manifest.json, packageInfo.json, app.js, app.css.json, pages/<Page>/{index.js,index.template.json,index.css.json}, assets/images, common/scn}`（实测；`galgaoshou/build/watch-round/`）。

### 6.4 `lint-timers` 规则算法（逐字复刻 IDE）

规则来源：`apiParser.getTimerInfo(text, method)` + `apiValidation.validateClearTimer`（IDE 扩展内实现）。

```
对每个 setTimeout 调用：
  正则 (this\.\w+|\w+)?\s*=\s*(\w*.)?setTimeout|setTimeout\s*\(
  捕获组 1 = fn；因此 `st.typingTimer = setTimeout(...)` 得到 fn='typingTimer'（丢前缀）
对每个 clearTimeout 调用：
  正则 clearTimeout\s*\(\s*([^)]+)\s*\)  → fn = 参数原文（如 'st.typingTimer'）
判定：每个 setTimeout 必须在 clearTimeout 列表中存在 fn 字符串完全相等的一项；
      否则 IDE 报 feature-api Error「未正确使用 clearTimeout 关闭，请检查代码」。
setInterval/clearInterval 同规则。
```

实现要点：扫 `src/**/*.ux`（跳过 node_modules/build/dist）；`--strict` 时「孤立 clear」也算失败；退出码 0/1/2/3（`galgaoshou/tools/lint-timers.js:64-78,104-145,147-210`）。

**可复制的最小通过写法**（见 §3.14）：全页仅 `armTimer` 内一处 `setTimeout`，`clearTimeout(timer)` 用同一局部变量；句柄存模块级 `st`。

**基线复跑示例**：`node tools/lint-timers.js --src <备份目录>`；参考 A 在旧代码上正确复现 5 条错误（`galgame/scripts/verify/README.md:132-134`）。

### 6.5 `validate-pages.mjs` 规则清单（可直接照抄到目标工程）

| 类别 | 规则 | 证据 |
| --- | --- | --- |
| 文件 | `<template>/<script>/<style>` 三块存在且闭合 | `validate-pages.mjs:425-430` |
| 模板 | 标签配平（支持显式自闭合 `<image/>`、`<!-- -->` 注释） | `:154-220,433-457` |
| 结构 | `<list>` 直接子组件只能是 `<list-item>`；`<list-item>` 必须有 `type`；`<slider>` 不得有 `step` | `:459-477` |
| 事件 | 允许 `click/longpress/change/touchstart/touchmove/touchend/touchcancel`；禁止 `@swipe`；事件引用的方法必须在 `<script>` 中存在；`<image>` 不得绑事件 | `:34,487-525` |
| 静态图 | `<image src="/assets/...">` 文件必须存在；不得用 `static` 属性 | `:484-486,527-539` |
| script | 禁止 `private:`/`protected:`/`@system.`/`file.readText`/`@swipe=`/`.scrollTo(`；`onInit` 内不得调 `storage/router/prompt/file`；`data` 可声明 `auto/load/mode` 接路由参数 | `:552-580,567-569` |
| style | 禁止 `@media (shape:`、`@import`、scss `$var`、`lang="scss"` | `:591-605` |
| 平台 CSS | 禁 `position:relative`、`overflow`、`z-index`、`box-shadow`、`filter`、多值 `border-radius`、`top:auto` | `:36-47,607-623` |
| 尺寸 | `.page` 必须 `width:466px`（`100%` 降为 warning）；全屏/定位层 `width:100%` warning | `:625-660` |
| 能力声明 | 代码 import `@blueos.storage.file` 时 manifest.features 必须声明 `blueos.storage.file` | `:675-696` |
| 页面注册 | `router.entry` 必须在 `router.pages` 里；5 个预期页面必须注册 | `:698-712` |

> 重要 nuance：`file.readText` 的禁令只作用于**页面 `<script>`**；参考工程把读文件收敛到 `common/story/loader.js`（非页面脚本）从而通过校验。目标工程也应把 file 访问收敛到公共模块。

### 6.6 `validate-story.mjs` 规则清单（有剧本 JSON 时照抄）

- 恰好 36 个 `chunk-XXX.json`，分块 `start/count` 连续，场景总数 4537，与 `story/index.js` 的 `chunks[]` 一一对应。
- 旧 `story/chunks/` 目录与 chunk JS 必须已删除；`src` 下不得再静态 import 剧情分块 JS/JSON。
- `nodeCount/chunkSize/chapters` 与分块一致，24 章 `start` 递增。
- 每个场景：对白/选项、背景、立绘、overlay、cg 图片路径合法（`/assets/images/...`）且文件存在。
- `choices.nextScene`、`dialogues.toScenes` 按相对跳转语义检查目标范围；END 结局存在；`choiceGroup/choiceCompleteScene/safeNextChapter` 合法。
- `loader.js` 异步 API 导出齐全，且不得再导出 `getScene/parseChunk`；`engine.js` 导出存在。
- 错误最多输出 30 条、警告 14 条（上游数据语义）。

证据：`galgaoshou/tools/validate-story.mjs:1-50,75-137`；结果 `galgaoshou/README.md:235`。

### 6.7 Node 侧逻辑测试技巧（在 Node 里跑 `.ux` 内的逻辑）

参考 B 的两套测试是「无模拟器也能验证全剧情」的关键，可直接照抄：

**A. 纯函数模块测试（`test-engine.mjs`）**

```
1) 工程 package.json 不是 type:module → 无法直接 import src 下的 .js
2) 把 engine.js / story 目录复制到 os.tmpdir() 临时工程，写 package.json {"type":"module"}
3) 内部 import 的 .js 改写成 .mjs；把 @blueos.storage.file 换成同步 fs stub
4) 动态 import 后跑用例：stageLayout/overlayLayout/filterChoices/nextDialogueTarget/
   canSkipScene/buildSaveData/normalizeSaveData/formatSavedAt + loader 异步/缓存/去重/LRU/
   预取/clearStoryCache/IO 失败
```

证据：`galgaoshou/tools/test-engine.mjs:4-19,64-140`；结果 44/44 `galgaoshou/README.md:237`。

**B. 页面逻辑测试（`test-reader.mjs`，在 Node 里实例化页面）**

```js
// 1) 从 .ux 抽出 <script>
function extractScriptBlock(text) {
  const open = /<script\b[^>]*>/i.exec(text)
  const close = /<\/script\s*>/i.exec(text.slice(open.index + open[0].length))
  return text.slice(open.index + open[0].length, open.index + open[0].length + close.index)
}

// 2) 替换 @blueos.* 为内存 stub、公共模块为 .mjs 副本
pageScript = pageScript
  .replace(/from\s+['"]@blueos\.app\.appmanager\.router['"]/g, "from './stubs/router.mjs'")
  .replace(/from\s+['"]@blueos\.storage\.storage['"]/g, "from './stubs/storage.mjs'")
  .replace(/from\s+['"]@blueos\.window\.prompt['"]/g, "from './stubs/prompt.mjs'")
  .replace(/from\s+['"]\.\.\/\.\.\/common\/(reader-settings|story\/loader|story\/engine|story\/paginate)\.js['"]/g,
           "from './common/$1.mjs'")

// 3) 实例化：把 export default 的方法挂到普通对象，data 深拷贝，注入 $device/$app/$element
function makeInstance(options = {}) {
  const { params = {}, settings = { textSpeed: 0, textSize: 22, autoPlay: false, autoPlaySpeed: 'medium' },
          storageEntries = {}, deviceType = 'watch-round' } = options
  stateModule.resetState()
  if (tempTimers) tempTimers.reset()
  stateModule.state.storage.map.set('settings', JSON.stringify(settings))
  Object.entries(storageEntries).forEach(([k, v]) => stateModule.state.storage.map.set(k, v))
  const definition = readerModule.default
  const instance = {}
  Object.keys(definition).forEach((key) => { if (key !== 'data') instance[key] = definition[key] })
  const rawData = typeof definition.data === 'function' ? definition.data() : definition.data
  Object.assign(instance, JSON.parse(JSON.stringify(rawData || {})))
  Object.assign(instance, params)          // 路由参数
  instance.$device = { deviceType }        // 圆/方屏
  instance.$app = { exit() {} }
  instance.$element = () => ({ scrollTo() {} })
  return instance
}

// 4) 假定时器：替换 globalThis.setTimeout/clearTimeout 记录回调，测试里手动 flush
// 5) file 同步 stub：URI '/common/scn/chunk-XXX.json' → fs.readFileSync(工程 src/common/scn/...)
//    这样页面 loadScene(...,cb) 在测试中同步完成；sceneAt(index) 可当 getScene 用
```

证据：`galgaoshou/tools/test-reader.mjs:84-100,200-235,237-294,301-314`；结果 45/45、遍历 4537 场景（`galgaoshou/README.md:238`）。

> 目标工程建议：**引擎/分页/存档全部写成无 UI 依赖的纯函数模块**（参考 B 的 `engine.js/paginate.js/loader.js`），页面只做绑定；这样 80% 逻辑可 Node 测，剩 20% 用模拟器/真机回归。
>
> **若纯函数写在 `.ux` 的 `<script>` 顶层**（如 `detectShape/armTimer`）：Node 里同样先 `extractScriptBlock()` 抽 script、写 `page.mjs` 后 `import()`；但顶层函数不会导出（只有 `export default` 可见），测试只能通过页面实例/默认导出间接覆盖。因此**建议把可测纯函数下沉到 `common/**/*.js`**（两个参考工程都这么做：`galgaoshou/src/common/story/engine.js`、`paginate.js`；`galgame/src/common/js/paginate.js`），页面只留生命周期绑定。参考 A 的 `ux_common.py` 也是把 `paginate.js` 复制成临时 `.mjs` 后用真实 `node` 调函数，避免在 Python 里重写 JS 公式（`galgame/scripts/verify/ux_common.py:1-20`）。

### 6.8 官方构建对 `.ux` 的编译约束（照做可避免大部分构建错）

1. **模板只能一个根节点**（`BlueOS开发文档.md:21390`）；`component` 只支持 `index.ux`（`:20515`）。
2. **样式**：官方文档说支持 `@import`/less/scss（`:20892,21239`），但参考工程统一**纯 CSS、页面内 `<style>` 直写**，并把 `@import`/`lang="scss"`/scss 变量列为校验错误（`galgaoshou/tools/validate-pages.mjs:591-605`、`galgaoshou/README.md:294`）。原因：避免预处理/导入带来的构建差异与 IDE 报错。**目标工程也建议纯 CSS。**
3. **样式只支持 CSS 子集**：单值 `border-radius`、无 `overflow/z-index/box-shadow/filter`、`position` 仅 fixed/absolute/relative（且 relative 实测子树不渲染）、flex 只支持列出的属性（`BlueOS开发文档.md:33320-33347`）。
4. **媒体查询**：`@media screen and (device: watch-square)` 编译期折叠；`@media (shape: rect)` 是 Vela 写法，BlueOS 报错/不支持（`galgame/README.md:181`、`galgaoshou/tools/validate-pages.mjs:592`）。
5. **模板表达式**：`{{var}}` 插值、`if`/`for`/`tid`、事件绑定 `@click="fn($item.x)"`、`$item/$idx/$event`；`data` 属性名不能以 `$`/`_` 开头、不能用 `for/if/show/tid`；响应式数据必须 `data` 声明或 `$set`（`BlueOS开发文档.md:25268-25310,25432-25513,20712`）。
6. **模块 import 位置**：全部写在 `<script>` 顶部；本地模块必须相对路径 + `.js` 后缀；`@blueos.*` 模块不能出现在 `<template>/<style>`；不支持 `require`/Node 模块（`galgaoshou/docs/PORT-CONTRACT.md:139-140,159`）。
7. **产物形态**：每页编译成 `index.js/index.template.json/index.css.json`（debug 加 `.js.map`）；CSS 属性名 camelCase；模板的 `if/for` 被编译成 `$shown`/`for` 字段——写产物断言时按这个格式解析（实测 §3.1）。
8. **`--enable-snapshot`**：watch 默认开启，可能生成 `index.snapshot`；如果 CI 断言包体，需把该文件计入（`blueos-pack/bin/index.js` 的 build/release 选项；`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:108`）。

### 6.9 可复制到目标工程的验证脚本骨架

**建议目录**（照抄参考 B，改路径即可）：

```
tools/
├─ lint-timers.js          # 逐字复刻 IDE 定时器规则（§6.4）
├─ validate-pages.mjs      # 页面静态校验（§6.5）
├─ validate-story.mjs      # 剧本数据校验（§6.6，有剧本时）
├─ test-engine.mjs         # 纯函数 + loader 测试（§6.7A）
├─ test-reader.mjs         # 页面实例化全剧情测试（§6.7B）
└─ build.mjs               # 双设备 debug/release 构建 + 成功判定（§6.2）
```

**最小门禁顺序**（参考 B `package.json:7-17`、参考 A `verify_all.ps1:1-16`）：

```bash
node tools/lint-timers.js --root .          # 0 error
node tools/validate-pages.mjs               # 0 error
node tools/validate-story.mjs               # 有剧本时
node tools/test-engine.mjs                  # 全 PASS
node tools/test-reader.mjs                  # 全 PASS
node tools/build.mjs --debug   --device watch-round
node tools/build.mjs --debug   --device watch-square
node tools/build.mjs --release --device watch-round
node tools/build.mjs --release --device watch-square
```

**如何断言构建真的成功**（复制 `build.mjs` 核心）：

```js
const SUCCESS_MARKER = '[INFO] finish compile'
child.on('close', (code) => {
  const hasMarker = log.includes(SUCCESS_MARKER)
  const rpk = pickRpk(options.device, startedAt)   // dist/<device> 下 mtime >= startedAt-5s 的 .rpk
  if (hasMarker && rpk) { console.log('[build] ✅', rpk.file, rpk.size); process.exit(0) }
  console.error('[build] ❌ 未检测到成功标记或没有新 rpk', keyErrorLines(log))
  process.exit(1)
})
```

出处：`galgaoshou/tools/build.mjs:38,150-160,249-277`；参考 A 的等价判定 `galgame/scripts/verify/build_check.ps1:149-152`。

### 6.10 报告与产物位置（复用参考工程习惯）

| 工具 | 报告 |
| --- | --- |
| lint timers | `scripts/reports/*lint*.json` / `tools` 控制台输出（参考 B 无落盘，可选 `--json`） |
| validate-pages/story | 控制台 + 退出码；参考 B 无 JSON |
| test-engine/test-reader | 控制台 `x/y` 统计 + 退出码 |
| build | `dist/<device>/<mode>/*.rpk`；参考 A 另存 `scripts/reports/verify/logs/build-*.log`、`assert-build-*.json`、`build-check-*.json` |
| 资源 | 参考 A `scripts/reports/asset-build-report.md` + `preview/*.png`；参考 B `docs/ASSET-OPTIMIZATION.md` |

---

## 7. 页面 UI 复用模式（单列）

### 7.1 组件可用性矩阵（BlueOS vs Vela 常用项）

| Vela 组件/写法 | BlueOS 情况 | 替代/写法 | 证据 |
| --- | --- | --- | --- |
| `div/text/image` | ✅ 可用 | `<image>` 不能绑事件，点击放覆盖 `div` | `galgame/README.md:183`；官方 `BlueOS开发文档.md:28682+` |
| `<scroll>` | ✅ 可用（无 `scrollTo` 方法；有 `scroll-top/left/bottom/right` 属性） | 长文本分页；设置/关于用 `scroll-y` | 官方 `:30023-30068`、方法仅 `getScrollRect/revealScrollbar` `:30117-30125`；参考 `galgame/src/pages/settings/index.ux:120`、`galgame/src/pages/about/index.ux:36` |
| `<scroll-view>` | ❌ 无此组件 | 用 `<scroll>` | 官方组件表 `:30012-30019`（grep `scroll-view`=0） |
| `<list>/<list-item>` | ✅ 可用（list 有 `scrollTo({index})`；item 必须 `type`） | 列表/存档/CG 格子 | 官方 `:29860-29987`；参考 `galgame/src/pages/saves/index.ux:601-632` |
| `<slider>` | ✅ 存在但**无 step**，`change {progress,isFromUser}` | 用 `- / +` 步进按钮 + `stepValue()` | 官方 `:32303-32348`；参考 `galgaoshou/src/pages/Settings/index.ux:2-10,33-39` |
| `<switch>` | ✅ 存在（`checked` + `change {checked}`） | 参考工程未用；开关类设置用互斥按钮 | 官方 `:32352-32415`；对照 `galgaoshou/src/pages/Settings/index.ux:194-202` |
| `<input>` | ✅ 存在（`type: button/checkbox/radio/text/date/speak`）；无 textarea | 隐藏 input + `$element.focus()` 拉输入法 | 官方 `:31750-31796`、输入法 `:9479-9532`；参考 `galgame/src/pages/saves/index.ux:738-744` |
| `<swiper>` | ✅ 存在（默认支持表冠） | 轮播；目标工程可不用 | 官方 `:30224+`、`:33905-33911` |
| `<stack>` | ✅ 存在（层叠容器） | 可做图层，但参考工程用 absolute 直接子层 | 官方 `:30198+` |
| `<picker>` | ✅ 存在（时间/日期选择器，默认支持表冠） | 目标工程可不用 | 官方 `:33909` |
| `<canvas>/<video>/<progress>/<vw-*>` | ✅ 存在 | 按需 | 官方目录 `:27699+,30344+,30604+` |
| `@swipe` 事件 | ❌ 无 | 自己用 `touchstart/move/end`；能手写就少用 | `galgaoshou/docs/PORT-CONTRACT.md:136-137`；校验 `validate-pages.mjs:496-499` |
| `onBackPress`（返回拦截） | ✅ 页面生命周期，但需 manifest `followHand:"disable"` 才生效 | 阅读页返回 true；菜单开着时先关菜单 | 官方 `:2262-2265`；参考 `galgaoshou/src/pages/Reader/index.ux:242-252`、`galgaoshou/src/manifest.json:42-46` |
| `onKey`（按键） | ✅ 页面生命周期（`keyCode 0/1`、`keyAction 0/1/2`） | 上键翻页/下键菜单；参考工程未用，需真机确认 | 官方 `:2310-2341` |
| `scrollTo()`（scroll 方法） | ❌ 无 | `scroll-top` 绑定 / 分页 | `galgaoshou/README.md:291,409`；官方方法列表 `:30117-30125` |
| `<image static>` | ❌ 无 `static` 属性 | 直接 `src="/assets/images/..."` | 官方/校验 `validate-pages.mjs:484-486` |
| `position: relative` 布局 | ❌ 实测子树不渲染 | 根 + absolute 扁平层 | §4.7 |
| `opacity` 做遮罩 | ⚠️ 属性存在，但参考工程不用 | 半透明用 `rgba()`；显隐用 `if` | 官方 `:33334`；实践 `galgame/src/pages/index/index.ux:123-130`（scrim 用 rgba） |

### 7.2 Home 页模式（首页）

**结构**：`.page` 直接子节点 = 全屏 `image.cover` → `div.scrim`（半透明遮罩）→ `div.panel`（只做底部面板背景）→ `image.logo` → `text.progress` → `text.primary` → 2×2 `text.btn` → `text.exit`。所有定位元素 absolute + 显式 px，纵向 `bottom` 锚定。

```html
<div class="page">
  <image class="cover" src="/assets/images/cover.png"></image>
  <div class="scrim"></div>
  <div class="panel"></div>
  <image class="logo" src="/assets/images/logo.png"></image>
  <text class="progress" @longpress="onDiag">{{ resumeCopy }}</text>
  <text class="primary" @click="onContinue">{{ primaryText }}</text>
  <text class="btn btn-new" @click="onNewGame">新游戏</text>
  <text class="btn btn-save" @click="onSaves">存档</text>
  <text class="btn btn-settings" @click="onSettings">设置</text>
  <text class="btn btn-gallery" @click="onGallery">CG</text>
  <text class="exit" @click="onExit">退出</text>
</div>
```

- 关键 CSS 数值（参考 A）：`.page{width:466px;height:100%}`；`.cover{width:466px;height:100%;object-fit:cover}`；`.panel{left:0;bottom:0;width:466px;height:242px;background:rgba(23,17,25,.92);border-radius:28px}`；`.primary{left:93;bottom:174;width:280;height:52;radius:26}`；`.btn{width:134;height:50;radius:25}`，四象限 `left:93/239`、`bottom:114/54`；`.exit{left:154;bottom:18;width:158;height:36}`（`galgame/src/pages/index/index.ux:108-221`）。
- 逻辑：`onReady/onShow/onRefresh` 都刷新自动存档进度；`refreshToken` 防止异步回调乱序（`galgame/src/pages/index/index.ux:30-60`）；有存档→`继续阅读` + `params:{auto:'1'}`，否则从第一场景开始（`:62-88`）。
- 参考 B 的 Home 同构，仅高度/底部值不同（`galgaoshou/src/pages/Home/index.ux:126-248`）。

### 7.3 Reader/Detail 页模式（核心）

**模板分层（全部 `.page` 直接子节点，后写在上）**：

```
image.bg（背景，object-fit:cover）
image.cg（事件 CG，object-fit:contain，if）
div.stage > div.char ×3（立绘，body+face 两层 image，object-fit:fill）
image.ovl（overlay）
div.dialogue（只做对白面板背景）
text.speaker / text.line / text.next-hint（对白，layoutClass 控制圆方屏）
div.input-layer（全屏点击层，@click=onTap @longpress=onLongPress，rgba 0.02 背景）
div.menu-trigger（顶部三横条菜单按钮）
div.loading / div.choice-layer / div.menu-layer / div.end-layer（if 按需创建）
```

- 证据：`galgame/src/pages/detail/index.ux:970-1055`；参考 B `galgaoshou/src/pages/Reader/index.ux:798-878`。
- 字体大小档位：`.line-22/.line-26/.line-30`，行高 30/36/41，`textSizeClass` 切换（`galgame/src/pages/detail/index.ux:1182-1193`）。
- 立绘槽位：单人 253×620、双人 220×540、三人 192×470（`galgame/src/pages/detail/index.ux:1105-1140`）；参考 B 用 bottom 锚定 + 方屏媒体查询（`galgaoshou/src/pages/Reader/index.ux:906-951,1311-1367`）。
- 状态机：`renderLine()` 顺序消费节点（label/chapter/bg/ev/dialogue/select/next），遇到 SELECT 停；`advancePageOrLine()` 先翻页再下一行；`goNextScene()` 查下一章；`finishGame()` 结局层；`persistAutoSave()` 每 10 句/隐藏/销毁（`galgame/src/pages/detail/index.ux:535-594,728-736,776-797,817-822`）。
- 打字机：`TYPEWRITER_TICK=30ms`，按速度每 tick 1~3 字；`textSpeed=0` 立即显示；`finishTyping()` 后 `canContinue=true` 并调度自动播放（`:61,631-669`）。参考 B 用「按 elapsed 计算进度」更平滑（`galgaoshou/src/pages/Reader/index.ux:498-516`）。
- 自动播放：`getAutoAdvanceDelay(text,speed)` clamp 1400~9000ms（`galgame/src/common/js/reader-settings.js:71-75`）。
- 选项：`showSelect()` 把选项拆成标签/表达式；点击后 `applyExp(flags, exp)` 改好感度，再 `jumpToLabel`（`galgame/src/pages/detail/index.ux:740-772`、`scene-store.js:146-170`）。
- 跳过：跳过场景=找下一个背景节点；跳过章节=按好感度 `getNextScene`（`:893-926`）。

### 7.4 Settings 页模式（无 slider 的步进设置）

- 结构：标题 absolute → `div.scroll-wrap > scroll > div.content`（flow：速度行/提示/字号行/预览框/自动速度行）→ 底部 `actions-row`（保存/重置/关于）→ `back-btn`（`galgame/src/pages/settings/index.ux:116-159`）。
- 行内控件：`label + '-' + value + '+'`，按钮 48×48，速度/字号步进逻辑在纯函数里（`stepTextSize/stepTextSpeed`，`galgame/src/common/js/reader-settings.js:52-66`；参考 B 的通用 `stepValue`，`galgaoshou/src/pages/Settings/index.ux:33-39`）。
- 预览：`style="{{ previewStyle }}"` 内联 `font-size/line-height`，`lines:2 + text-overflow: ellipsis`（`galgame/src/pages/settings/index.ux:135-138,255-264`）。
- 保存：`normalizeReaderSettings` → `storage.set` → `showToast('设置已保存')`（`:86-102`）。
- 方屏：媒体查询只加高 scroll 容器（291/281px），底部操作区 bottom 锚定不动（`:327-334`；`galgaoshou/src/pages/Settings/index.ux:381-389`）。

### 7.5 Saves 页模式（list + 长按删除 + pendingSave + 弹窗）

- 列表：`<list>` 里依次放固定 `type="auto"`（自动存档）、`type="manual"` + `for="{{saveRows}}"`（手动存档，`@click` 读取/覆盖、`@longpress` 删除）、`type="new"`（保存模式下的新建存档）、`type="empty"`（空态）。**同 type DOM 结构一致**（`galgaoshou/src/pages/Saves/index.ux:1-48`、`galgame/src/pages/saves/index.ux:597-637`）。
- 长按删除：`requestDeleteSlot(slot)` 记录 `suppressedSlotClick = slot`（防止长按后又触发 click），显示确认弹窗；`confirmDelete()` 从 `recoveryData.splice` 并写回（`galgaoshou/src/pages/Saves/index.ux:178-210`、`galgame/src/pages/saves/index.ux:193-222`）。
- 保存流程：Reader 菜单「保存进度」把当前 save 写入 `pendingSave` → `router.push('/pages/Saves',{mode:'save'})` → 存档页读 `pendingSave`，点「新建存档」/覆盖写入 `recoveryData` → 离开时 `storage.delete('pendingSave')`（`galgame/src/pages/detail/index.ux:841-853`、`galgame/src/pages/saves/index.ux:110-120,172-192,223-229`）。
- 弹窗：`div.scrim`（rgba 0.62）+ `div.dialog`（280×172、radius 18）绝对定位，用 `if` 控制显隐（`galgame/src/pages/saves/index.ux:643-651,875-936`）。
- 云存档：参考 A 用 `@blueos.network.fetch` + PHP 后端（`galgame/src/common/js/cloud-store.js`、`server/README.md`）。**目标工程 GalGod 无云存档，整块可删**；如果未来要加，需要 manifest 声明 `blueos.network.fetch`、服务端返回 HTTP 200 + JSON code、并处理 `storage.get` fail 初始化 player_id（`galgame/README.md:50-69,186-188`）。

### 7.6 Gallery / CG 格子模式（两列 list + 缩略图）

- 数据：`makeRows(group)` 把 items 每 2 个一组压成一行 `{leftIndex,leftSrc,leftTitle,rightIndex,...}`，模板 `for="{{rows}}"` 渲染一行两个 `.cell`（`galgame/src/pages/gallery/index.ux:28-44,118-131`）。
- 缩略图用 112×112 的独立小图（不在列表里解码大图），`object-fit:contain` + 深色底 + 圆角 10（`:202-208`；资源说明 `galgame/README.md:171`）。
- 分组选择：`pickerVisible` 弹层（`if`）+ `for` 行；点分组重建 rows（`:65-93,134-141`）。
- 点格子 → `router.push({uri:'/pages/cg-viewer',params:{groupId,index}})`（`:97-107`）。
- 空态：`hasItems=false` 时显示「暂无图像」（`:132`）。
- 如果目标工程有 CG 鉴赏，可直接照抄 gallery + cg-viewer 两页；cg-viewer 的缩放/长按拖动见 §3.9/§3.11/§3.12。

### 7.7 About 页模式（长文 scroll）

- 结构：标题 → `scroll-wrap > scroll[scroll-y] > content`（flow column：标题/副标题/信息行 `for`/分节标题/长段落/警告）→ `back-btn`（`galgame/src/pages/about/index.ux:32-57`、`galgaoshou/src/pages/About/index.ux:1-80`）。
- 长段落用多个 `<text>` + `line-height`，不要用 textarea/rich-text；`border-bottom:1px solid` 做分节线（`galgame/src/pages/about/index.ux:131-141`）。
- 方屏加高 scroll 容器（`galgame/src/pages/about/index.ux:177-184`）。

### 7.8 通用视觉规范（从参考工程抄）

| 项 | 值/做法 | 证据 |
| --- | --- | --- |
| 页面底色 | `#160f16` / `#120d13` / `#171119` | `galgame/src/pages/index/index.ux:113`、`galgaoshou/src/pages/Saves/index.ux:272-275` |
| 主粉色 | `#b95079` | `galgame/src/pages/index/index.ux:171` |
| 浅粉文字 | `#ffd8e6` / `#f5e1e8` | `galgame/src/pages/index/index.ux:148` |
| 次按钮底 | `#412536` / `#302b33` / `#4a414b` | `galgame/src/pages/index/index.ux:184,215` |
| 主按钮 | 280×52 / radius 26；次按钮 134×50 / radius 25；返回 240×52 / radius 14 | `galgame/src/pages/index/index.ux:164-221`、`:313-326` |
| 内容列宽 | 280px（设置/存档/关于），左侧 93px 居中 | `galgame/src/pages/settings/index.ux:170,181-185` |
| 字号 | 标题 28-30、正文 24-26、次要 18-22、最小 13-17 | `galgame/src/pages/detail/index.ux:1182-1193`、`galgame/src/pages/saves/index.ux:1001-1065` |
| 面板/圆角 | 面板 radius 18-28；圆屏对白框 radius 40 | `galgame/src/pages/saves/index.ux:883-894`、`galgame/src/pages/detail/index.ux:1427-1433` |

---

## 8. 给目标工程的实施顺序（建议）

1. **脚手架对齐**：改 `tsconfig.json`（§2.4）、`app.d.ts`（§2.3）、`manifest.json`（features/deviceTypeList/designWidth/router，§2.2）、`.ide/settings.json`（§2.6）。
2. **公共层**：`common/js/constants.js`、`reader-settings.js`、`paginate.js`、`save-store.js`；剧本访问拆成 `scene-store`/`story-loader`（§3.6/§3.16/§3.17）。
3. **Home + Settings + Saves + About**：四个静态页先跑通路由/storage/返回/列表（§7.2/§7.4/§7.5/§7.7）。
4. **Reader/Detail**：先跑通「背景+对白+点击翻页」，再加打字机/自动播放/选项/菜单/存档（§7.3）。
5. **资源管线**：先定目标屏尺寸（bg cover 466×466 / CG contain 466×262 / 缩略图 112×112），再跑优化脚本 + 未引用清理（§5）。
6. **工具链**：lint-timers → validate-pages → test-engine → test-reader → build.mjs 双设备四组合（§6）。
7. **真机回归**：重点 `开始→连续翻页→选项→存档→退出`、圆屏字幕底行、表冠、长按拖动、圆方屏切换（§4）。

---

## 9. 证据索引、文档漂移与未验证项

### 9.1 关键事实索引（按主题）

| 主题 | 首选证据 |
| --- | --- |
| 定时器 IDE 规则 | `galgaoshou/tools/lint-timers.js:11-18,104-145`；`galgame/README.md:73-75,189` |
| 页面结构/绝对定位 | `galgame/src/pages/index/index.ux:2-14`；`galgaoshou/docs/PLATFORM-NOTES.md:44-57` |
| 圆方屏 + 媒体查询折叠 | `galgame/README.md:181`；`galgaoshou/src/pages/Reader/index.ux:91-94,177-179`；§3.9.C 的 build 产物实测 |
| 表冠 | `galgame/src/pages/cg-viewer/index.ux:236-266,416-427`；`BlueOS开发文档.md:33926-33961` |
| 触摸/拖动 | `galgame/src/pages/cg-viewer/index.ux:295-381` |
| 分页 | `galgame/src/common/js/paginate.js:20-86`；`galgaoshou/src/common/story/paginate.js:12-73` |
| storage/存档 | `galgame/src/common/js/save-store.js:34-64`；`galgame/src/common/js/constants.js:19-32` |
| 剧本外置/loader | `galgaoshou/src/common/story/loader.js:28-251`；`galgaoshou/docs/OPTIMIZATION-CONTRACT.md:21-50` |
| manifest/features 映射 | `galgaoshou/src/manifest.json:1-64`；`galgaoshou/build/watch-round/manifest.json`；`galgame/build/watch-round/manifest.json` |
| 签名 | `galgaoshou/README.md:156-180` |
| 构建命令/判定 | `galgaoshou/tools/build.mjs:31-38,192-197,249-277`；`galgame/README.md:154-167` |
| 产物断言 | `galgame/scripts/verify/assert_build.js:1-16`；`galgame/scripts/verify/build_check.ps1:178-237` |
| Node 测试 | `galgaoshou/tools/test-engine.mjs:4-19`；`galgaoshou/tools/test-reader.mjs:84-314` |
| 资源优化（A） | `galgame/scripts/build_assets.py:82-102,185-209`；`galgame/scripts/reports/asset-build-report.md` |
| 资源优化（B） | `galgaoshou/tools/optimize_images.py:67-70,471-510`；`galgaoshou/docs/ASSET-OPTIMIZATION.md` |
| 实机定量 | `galgame/scripts/reports/verify/real-device-issues.md` |
| 平台限制 | `galgaoshou/README.md:349-430`、`galgaoshou/docs/PLATFORM-NOTES.md`、`BlueOS开发文档.md` 对应章节 |

### 9.2 明确的文档漂移/未验证项（不要照抄）

1. 参考 A 的 `pages/diag` **已不存在**（README 提，src/manifest 无；§4.21）。
2. 参考 A `assert_build.js` 有 4 项陈旧圆屏 CSS 期望（`galgame/README.md:108`）。
3. 官方本地文档示例 import `@blueos.app.router` 是错的（`BlueOS开发文档.md:21373`）。
4. `deviceInfo.deviceType` 注释写 `'watch'`，与 `$device.deviceType` 的 `watch-round/watch-square` 不一致（`:8032` vs `:20787`）。
5. `position: relative` 官方文档列为支持（`:33340`），但参考工程实测子树不渲染（以实测为准）。
6. 官方文档说 `delta` 低速恒为 ±1（`:33949`），真机可能更大（以实机修复为准）。
7. `keepScreenOn`（brightness.setKeepScreenOn）两个参考工程都**未实测**，本文按官方文档+类型给出，目标工程需真机回归。
8. `galgaoshou/tools/preview.mjs` 注释 537.85 与实际 537.69 不一致（§4.21）。
9. rpk 体积/包体数字随资源与构建参数漂移，以 `dist/` 实测为准。

---

## 10. 命令速查卡

```powershell
# ===== 环境 =====
$PACK = "D:\BlueOSStudio\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js"
node -v                                  # 参考实测 v24.21.0（blueos-pack 要求 >=18）

# ===== 构建（双设备 × debug/release）=====
node $PACK build   --device-type watch-round  --debug -f
node $PACK build   --device-type watch-square --debug -f
node $PACK release --device-type watch-round  -f
node $PACK release --device-type watch-square -f
# 用参考 B 的封装（推荐：自动定位打包器 + 成功判定 + 错误摘要）
node tools/build.mjs --debug   --device watch-round
node tools/build.mjs --release --device watch-square

# 成功判定：日志 [INFO] finish compile in ... 且 dist/<device>/<mode>/*.rpk 是新的

# ===== 校验/测试 =====
node tools/lint-timers.js --root .        # 0 error
node tools/validate-pages.mjs             # 0 error
node tools/validate-story.mjs             # 有剧本 JSON 时
node tools/test-engine.mjs                # 纯函数 + loader
node tools/test-reader.mjs                # 页面逻辑（Node 实例化 .ux script）
python tools/optimize_images.py --verify  # 素材可解码 + 引用存在

# ===== 资源优化 =====
# 参考 A 风格（源工程 → 目标屏重裁 + 调色板）
python scripts/build_assets.py --budget-mb 12
python scripts/validate_assets.py
# 参考 B 风格（已有工程审计/清理/重裁）
python tools/optimize_images.py --delete-unused --apply
python tools/optimize_images.py --resize-cg --apply
python tools/optimize_images.py --verify

# ===== 真机/模拟器回归（参考 A 工具链）=====
powershell -NoProfile -File scripts/verify/verify_all.ps1
powershell -File scripts/verify/build_check.ps1
powershell -File scripts/verify/cg_visual_check.ps1 -Stage final
```

**最后提醒**：目标工程是**新工程**，不是照搬参考工程代码。参考价值最大的是：①扁平化+显式 px 的页面骨架；②`armTimer/disarmTimer` 定时器写法；③剧本 JSON 外置 + loader；④分页 + 圆方屏安全区；⑤`build.mjs`/`lint-timers`/`validate-pages`/Node 测试这一套门禁；⑥资源重裁+调色板+PSNR 的量化流程。两个参考工程的页面代码量大、业务耦合重，**抄模式不抄整页**。
