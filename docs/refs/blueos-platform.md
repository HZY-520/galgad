# BlueOS 平台速查（GalGod 移植参考）

> 唯一依据：`C:\Users\Administrator\BlueOSProjects\galgad\BlueOS开发文档.md`（来源 developers-watch.vivo.com.cn，抓取时间 2026-05-29，共 34022 行）。
> 行号规则：本文件所有 `L1234` 均指 **read 工具显示的行号**（与 grep 一致）。
> 原则：只记录文档中确有的事实；文档没有的项统一列在 §12「文档缺口」，不臆测。带「原文」的句子为文档原文摘录。

---

## 0. 速查表（写代码时先看这里）

### 0.1 import 路径 / feature 声明 / 核心签名

| 能力 | import 路径 | manifest 声明 | 关键调用 | 行号 |
|---|---|---|---|---|
| router | `@blueos.app.appmanager.router`（API 页）<br/>`@blueos.app.router`（指南/示例） | **无需声明** | `router.push({uri,params,transition})`、`router.replace`、`router.back()`、`router.clear()`、`router.getState()`、`router.setTransition` | L12203、L12195、L26450、L12212、L12314、L12353、L12388、L12411、L12441 |
| storage | `@blueos.storage.storage` | `{ "name": "blueos.storage.storage" }` | `storage.set({key,value})`、`storage.get({key,default})`、`storage.getSync({key})`、`storage.delete({key})`、`storage.clear()`、`storage.key({index})` | L4260、L4251、L4347、L4269、L4313、L4491、L4457、L4527 |
| file | `@blueos.storage.file` | `{ "name": "blueos.storage.file" }` | `file.readText({uri})`、`file.writeText({uri,text})`、`file.readArrayBuffer({uri})`、`file.writeArrayBuffer({uri,buffer})`、`file.access({uri})` | L3577、L3568、L3959、L3859、L4016、L3909、L4076 |
| prompt | `@blueos.window.prompt` | `{ "name": "blueos.window.prompt" }` | `prompt.showToast({message, duration})`（duration 0 短 / 1 长，默认 0） | L11707、L11698、L11716、L11729 |
| 屏幕常亮/亮度 | `@blueos.hardware.display.brightness` | `{ "name": "blueos.hardware.display.brightness" }` | `brightness.setKeepScreenOn({keepScreenOn:true})`、`setValue({value:0-255})`、`getValueSync()`、`wakeScreenOn({screenOn:true})` | L7177、L7168、L7376、L7261、L7229、L7412 |
| 屏幕管理 | `@blueos.hardware.display.screen` | `{ "name": "blueos.hardware.display.screen" }` | `screen.getScreenOffTime()`（返回秒 1-999）、`screen.getAodStatus()`（0/1） | L12694、L12685、L12703、L12735 |
| 设备信息 | `@blueos.hardware.deviceInfo` | `{ "name": "blueos.hardware.deviceInfo" }` + `permissions:[{"name":"watch.permission.DEVICE_INFO"}]` | `device.getInfo({success})`、`device.getInfoSync()` | L7966、L7957、L7976、L7986、L8050 |
| 内置对象 | 无需 import | 无 | `$device.deviceType`、`$res('image.xxx')`、`$page`、`$app.$def`、`this.$element(id)`、`this.$set(k,v)`、`this.$watch(k,handler)` | L20784-20787、L2784、L20802、L20818-20819、L20831 |
| console | 无需导入 | 无需声明 | `console.log/debug/info/warn/error(message)` | L7897、L7904、L7912 |

### 0.2 manifest.json 最小骨架（字段全部来自 L20370-20384、L20453）

```json
{
  "package": "com.company.module",
  "name": "应用名",
  "icon": "/assets/images/logo.png",
  "versionName": "1.0",
  "versionCode": 1,
  "features": [{ "name": "blueos.storage.file" }],
  "deviceTypeList": ["watch-round", "watch-square"],
  "appCategory": ["games"],
  "config": { "designWidth": 466 },
  "router": {
    "entry": "pages/Index",
    "pages": {
      "pages/Index": { "component": "index", "path": "/Index", "launchMode": "standard", "followHand": "enable" }
    }
  },
  "display": { "backgroundColor": "#000000" },
  "permissions": [{ "name": "watch.permission.DEVICE_INFO" }]
}
```

- `package` 推荐 `com.company.module`（L20078）；`name` 6 个汉字以内（L20092、L20371）；`icon` 提供 114x114（L20372），规则正方形、无白边（L20109）。
- `versionName` 为「主版本.次版本」，`versionCode` 为从 1 自增的整数（L20126-20129）。
- `features`：绝大部分接口都需要在这里声明，否则不能调用（L20147、L20375）。
- `deviceTypeList` 默认 `watch`，可选 `watch,watch-square,watch-round,tv,car,phone`（L20378）。
- `appCategory` 必填，最多 2 个分类，未填系统置为 `['other']`（L20381、L20391）；游戏类取值 `games`（L20400）。
- `config.designWidth`：页面设计基准宽度，建议 466（L20453）。
- `router.pages` 的 key 必须是 `src` 下**页面目录的相对路径**（L20178、L20207）；`component` 与 ux 文件名一致，**目前仅支持 index.ux**（L20515）。上方骨架假设页面目录为 `src/pages/Index`；文档 file-organization 示例树的页面目录是 `src/Demo`，那时 key 为 `Demo`（L20178-20199）。
- 页面未配置路由则不参与编译；一个目录下最多一个主页面文件（L20171）。

### 0.3 页面接收路由参数 / 数据

- 接收参数：在页面 ViewModel 的 **`data` 中声明同名属性**即可，`this.key` 与模板 `{{key}}` 都可用（L26553-26578）。
- `router.push` 的 `params` 值**统一转换为 String 类型**（L12231）。
- 响应式数据必须先 `data` 静态声明或用 `this.$set` 动态添加，不能直接 `this.x = ...` 新增（L25310）。
- `data` 属性名不能以 `$` 或 `_` 开头，不要使用 `for, if, show, tid` 等保留字（L20712、L20745）。
- 页面级对象：`$app`、`$page`、`$valid`、`$device`（L20784-20787）；`$app.$def` 取 app.ux 暴露对象（L20802、L21411）。

### 0.4 生命周期一览

| 级别 | 回调 | 触发时机/要点 | 行号 |
|---|---|---|---|
| 应用（app.ux） | onCreate | 应用创建时 | L2144 |
| 应用 | onDestroy | 应用销毁时 | L2157 |
| 应用 | onShow | 应用显示在前台 | L2170 |
| 应用 | onHide | 应用退到后台 | L2183 |
| 页面 | onInit | 页面初始化完成，**只触发一次** | L2200 |
| 页面 | onReady | 页面创建完成可显示，**只触发一次** | L2213 |
| 页面 | onShow | 页面打开或从后台切前台（应用在后台时不触发） | L2226 |
| 页面 | onHide | 页面切后台或关闭（应用在后台时页面被关闭不触发） | L2239 |
| 页面 | onDestroy | 页面跳转离开（退出页面栈） | L2252 |
| 页面 | onBackPress | 用户执行返回；**仅 `followHand:"disable"` 时生效**；返回 boolean（true=自行处理）；**不支持 async** | L2265、L2282 |
| 页面 | onRefresh | 页面重新打开；**在 onShow 之前执行**；参数 `query`（deeplink/uri query 或 router.push 的 params） | L2289、L2292、L2306 |
| 页面 | onKey | 按键；`keyCode` 0=下键(电源键)/1=上键；`keyAction` 0=按下/1=短按弹起/2=长按弹起；`repeatCount` | L2313、L2329-2331 |
| 页面 | onConfigurationChanged | 系统语言变化，`event.type === 'locale'` | L2349、L2373 |
| 页面 | onPalmOver | 手掌覆盖；返回 true 表示不再传给 launcher | L2389、L2404 |
| 自定义组件 | onInit / onReady / onDestroy | 数据驱动完成 / 模板创建完成 / 销毁 | L2429、L2442、L2455 |

> 文档没有给出完整调用顺序表，唯一明确顺序是「onRefresh 在 onShow 之前执行」（L2289）。见 §12。

### 0.5 CSS 红线（写样式前必读）

- 只支持 Flex 布局，通用样式白名单见 L33312-33341；**不要写 `flex: 1`**（L33347）。
- `display` 只能是 `flex` 或 `none`（L33335）；不支持 `content-box`、不能指定 `box-sizing`（L25704）。
- `position` 支持 relative/absolute/fixed（默认 relative），但**父容器为 list、swiper 时不生效，scroll 不支持 position**（L25794、L33340）。
- 选择器只支持 `.class`、`#id`、tag、逗号并列、后代、直接后代（L20938-20944）；伪类只支持 `:active`（L20928）。
- 后代选择器性能差，官方要求直接用类名（L21810-21839）。
- 长度单位：数值=px（按 designWidth 逻辑缩放）；字符串需带单位；支持百分比（L33028-33029）。
- px 换算公式：`设计稿1px / 设计稿基准宽度 = 框架样式1px / 项目配置基准宽度`（L25739-25741）。
- `background` 不能与 `background-color`、`background-image` 同时使用（L33327）；`background-image` 只支持本地图片，不支持网络图（L33330）。
- 动画：`transform` 只支持 translate/translateX/translateY/scale/scaleX/scaleY/rotate（L32530-32538）；`animation-fill-mode` 的 `backwards`、`both` 暂不支持（L32561）；`@keyframes` 只支持 background-color/opacity/width/height/transform，width/height 不支持百分比，且 0% 与 100% 必须显式写出（L32603-32614）。
- scroll 组件不支持 margin、padding 样式（L30078）。
- list-item 不支持 position 样式（L29868）。

### 0.6 组件白名单（文档列出的全部组件）

- 容器：`div`、`list`、`list-item`、`stack`、`swiper`、`scroll`（L30014-30019）；另有拓展组件 `cellular-list`、`drawer`、`drawer-navigation`（L30346、L30510、L30471）。
- 基础：`a`、`image`、`text`、`span`、`marquee`、`progress`、`arc-text`、`barcode`、`qrcode`、`canvas`（L28688-28699）。
- 表单：`input`、`label`、`picker`、`slider`、`switch`、`artboard`（L32047-32054）。
- 系统风格：`vw-alert`、`vw-button`、`vw-empty`、`vw-icon`、`vw-slide`、`vw-title`、`vw-list`、`vw-list-item`、`vw-loading`（L30623-30631）。
- 动画类：`image-animator`、`animated-vector`（L28047、L27768）；物理引擎 `physics-engine`（L28708）。
- **没有 `scrollview` 组件**（见 §12）。

### 0.7 事件白名单

- 通用事件：`touchstart`、`touchmove`、`touchend`、`touchcancel`、`click`、`longpress`，均支持冒泡（L32785-32792）。
- 写法：`on{eventName}` 或 `@{eventName}` 等价（如 `onclick` / `@click`，L32740）。
- 事件回调末尾自动追加一个 `evt` 参数（L25425）。
- 表冠旋转：`rotation` 事件（通用事件，L33939），参数 `direction/delta/velocity/duration/state`（L33946-33952）；焦点方法 `this.$element(id).requestFocus(true)`（L33961、L34004-34005）。
- 文档**没有** `onswipe`、`onlongpress`（写作 `longpress` 事件）之外的手势事件的独立条目；`swipe` 只作为 swiper 的属性 `enableswipe` 出现（L30271）。

### 0.8 屏幕适配速查

- 设备类型：`$device.deviceType`，取值 `watch-square`（方形手表）或 `watch-round`（圆形手表）（L20787）；模板中可用 `if="$device.deviceType == 'watch-round'"`（L2656-2657）。
- `device.getInfo()` 返回的 `deviceType` 是「当前蓝河应用引擎的设备类型，手表版为 'watch'」（L8032）——与 `$device` 的两值枚举不同，别混用。
- 媒体查询：`@media screen and (device: watch-square) or screen and (device: phone) { ... }`（L21139、L2633）；`device` 可选 `phone、watch、car、tv、pad、watch-square、watch-round`，**watch 默认 watch-square**（L21356）。
- dp 是绝对尺寸：`屏幕宽度dp值 = 设备屏幕分辨率的宽度 / DPR`（L2596）；DPR 表 ldpi 0.75 / mdpi 1 / hdpi 1.5 / xhdpi 2 / xxhdpi 3 / xxxhdpi 4（L2603-2610）。
- 等比缩放靠 `config.designWidth`（L2554）；文档示例 designWidth=466 时 `width:233px` 等于屏幕宽一半（L2567）。
- 窗口/屏幕尺寸从 `device.getInfo()` 的 `screenWidth/screenHeight/windowWidth/windowHeight/screenDensity` 取（L8023-8028）。
- 资源按设备/分辨率匹配：`resources/res-watch-402x402-round.json` 之类，权重 分辨率(1000) > 表盘形状(100) > 屏幕密度(10)（L2687-2705）；`$res('image.xxx')` 读取（L2784）。

### 0.9 性能/定时器红线

- 所有 `setTimeout`/`setInterval` 必须在页面销毁时用 `clearTimeout`/`clearInterval` 匹配清除（强烈级），并给出反例/正例（L23198、L23204-23245）。
- 事件监听器必须在退出页面时注销（L23249）。
- 避免后代选择器（L21810）；避免 CSS ID 选择器（L22696）；循环指令不与条件指令叠加（L22757）；列表项加 `tid` 指定渲染标识（L25513、L23055）。
- 图片物理尺寸必须与显示区域像素尺寸严格匹配，禁止超分辨率图（L23114）；优先 8 位色深 PNG（L23124）；svg 只用于动画/动态改属性（L23140）。

### 0.10 文档缺口（详见 §12）

`scrollview` 组件、swipe 事件、圆屏安全区/safeArea、466×466 与 432×514 机型专属说明、`/common` 应用资源目录的正式定义、`file.readText` 读资源路径的明确支持、prompt 除 showToast 之外的接口、窗口 window API、IDE 定时器配对 lint 规则、data 的 public/protected/private 限制、blueos-pack 命令行 —— **文档未找到**。

---

## 1. 项目结构与构建

### 1.1 目录结构（L20040-20052、L21615-21627）

```text
├── scripts                   工具脚本文件
├── src
│   ├── assets                公用资源
│   │   ├── images            图片资源
│   │   └── styles            应用样式
│   ├── pages                 页面目录
│   │   ├── Demo              应用首页
│   │   └── DemoDetail        应用详情页
│   ├── app.ux                入口文件 / 全局逻辑与应用生命周期
│   └── manifest.json         项目配置文件（图标、页面路由等）
├── jsconfig.json             js 配置文件，用于语法校验
└── package.json              定义项目需要的各种模块及配置信息
```

- `app.ux` 用于全局 JavaScript 逻辑和应用生命周期管理（L20062、L21624）。
- 页面文件放在各自页面目录，文件名不必与父文件夹相同，**推荐 index.ux**（L20187、L20226）；`component` 目前仅支持 index.ux（L20515）。
- 只有在 `manifest.json` 的 `router` 里配置过的 ux 页面才参与编译（L20171）。

### 1.2 构建/打包（文档只描述 BlueOS Studio 图形化流程）

- 开发工具为 BlueOS Studio，可开发、调试、打包蓝河应用（L21510、L21585）。
- 安装依赖前需准备 Node 环境；在 IDE 内点「安装依赖」→「重新启动编译」，之后保存即实时预览（L21604-21608）。
- 调试面板：实时预览、UI 调试、网络调试、内存调试、日志、自动化测试（L21540、L21546、L21549）。
- 打包得到 **rpk** 包（L21556）；流程：点「打包」→ 选包类型（release/debug）和环境变量（production/development/test）→ 生成在 `dist` 目录（L21722-21727）。
- release 包需填写信息生成签名后再打包（L21725）。
- 编译期环境变量 `process.env.NODE_ENV`：开发 `development`、正式 `production`（L19258、L19267-19268）；用法示例 L19276-19284。
- `jsconfig.json` 用于语法校验（L20051）。
- 文档**没有** `blueos-pack`、CLI 命令、模拟器命令行用法；只有 IDE 操作（见 §12）。

---

## 2. manifest.json 完整 schema

### 2.1 顶层字段（L20368-20384）

| 属性 | 类型 | 必填 | 说明 | 行号 |
|---|---|---|---|---|
| package | string | 是 | 应用包名，与原生应用包名不同，推荐 `com.company.module` | L20370 |
| name | string | 是 | 应用名称，6 个汉字以内 | L20371 |
| icon | string | 是 | 应用图标，提供 114x114 即可 | L20372 |
| versionName | string | 否 | 版本名称，如 "1.0" | L20373 |
| versionCode | number | 是 | 版本号，从 1 自增 | L20374 |
| features | [] | 否 | 接口列表，绝大部分接口需在此声明 | L20375 |
| config | object | 是 | 系统配置（designWidth 等） | L20376 |
| router | object | 是 | 路由信息 | L20377 |
| deviceTypeList | Array<string> | 否 | watch / watch-square / watch-round / tv / car / phone | L20378 |
| display | object | 否 | UI 显示相关配置 | L20379 |
| permissions | [] | 否 | 权限申请，如 `[{"name":"watch.permission.LOCATION"}]` | L20380 |
| appCategory | [] | 是 | 应用类别，最多 2 个 | L20381 |
| customData | Record<string,string> | 否 | 自定义字段，≤30 字符，`packageManager.getCustomData()` 读取 | L20382 |
| distrubuteRules | object | 否 | 分发规则（minAPILevel） | L20383 |
| widgetProvider | [] | 否 | 注册 widgetProvider（智慧服务卡片用） | L20384 |

### 2.2 AppCategory（L20394-20419）

business / education / pastime / finance / **games** / lifestyle / medical / music / news / photography / reference / social / sports / travel / utilities / video / weather / navigation / book / shopping / podcasts / audiobooks / radio / other。
未填时系统设置为 `['other']`（L20391）；最多 2 个分类（L20381）。

### 2.3 FeatureInfo（L20429-20441）

| 属性 | 类型 | 说明 |
|---|---|---|
| name | string | feature 名称，见各接口文档顶部 |

示例：`{ "name": "blueos.storage.file" }`（L20437-20440）。

### 2.4 Config（L20451-20463）

| 属性 | 类型 | 说明 | 行号 |
|---|---|---|---|
| designWidth | number | 页面设计基准宽度，按实际设备宽度缩放元素，**建议 466** | L20453 |

示例 `{ "designWidth": 466 }`（L20459-20463）。
另：后台运行需在 `config.background.features` 里声明模块（L2856-2887），如 `blueos.multimedia.audio`、`blueos.communication.network.request` 等（L2859-2866）；示例含 `config.logLevel: "trace"`（L2874-2887）。

### 2.5 Router / Page / LaunchMode（L20476-20531）

| 属性 | 类型 | 默认 | 必填 | 说明 | 行号 |
|---|---|---|---|---|---|
| router.entry | string | - | 是 | 首页名称（src 下页面目录相对路径） | L20478 |
| router.pages | Record | - | 是 | key=页面名称，value=Page 配置，key 不要重复 | L20479、L20207 |
| Page.component | string | - | 是 | 与 ux 文件名一致，目前仅支持 index.ux | L20515 |
| Page.path | string | `/<页面名称>` | 否 | 页面路径，必须唯一 | L20516 |
| Page.launchMode | enum | standard | 否 | singleTask / standard | L20517、L20530-20531 |
| Page.followHand | string | enable | 否 | disable 不支持右滑跟手；enable 支持 | L20518 |

- `singleTask`：每次打开已有目标页并回调 onRefresh，清除该页之上其他页面；没打开过则新建（L20530、L2489）。
- `standard`：每次打开新页面，多次打开同一地址会存在多个相同页面（L20531）。
- 页面栈行为完整示例（PageA→B→C→B→C→A）见 L2522-2535。
- launchMode 静态声明位置为 `router.pages` 内的页面配置（L2480、L2496-2516）。

### 2.6 Display（L20544-20556）

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| backgroundColor | string | #000 | 窗口背景颜色，作用范围为应用全部页面 |

### 2.7 PermissionInfo / PermissionName（L20560-20644）

`permissions: [{ "name": "watch.permission.LOCATION" }]`（L20380、L20579）。

| 权限名 | 模块 | 说明 | 错误码 |
|---|---|---|---|
| watch.permission.LOCATION | @blueos.hardware.geolocation | 位置信息 | 400 拒绝、402 未声明 |
| watch.permission.STEP_COUNTER | @blueos.hardware.sensor | 计步传感器 | 400、402 |
| watch.permission.DEVICE_INFO | @blueos.hardware.device | 设备信息 | 400、402 |
| watch.permission.RECORD | @blueos.multimedia.record | 录音 | 400、401、402 |
| watch.permission.BLUETOOTH | @blueos.communication.bluetooth.bluetooth@vivo.bluetooth | 蓝牙 | 400、402 |
| watch.permission.READ_HEALTH_DATA | @blueos.health.health@vivo.health | 健康数据 | 400、402 |

（L20639-20644）

### 2.8 DistrubuteRules / WidgetProvider（L20591-20627）

- `distrubuteRules.minAPILevel`：number，默认 1，只有支持该 APILevel 的系统版本才能被分发（L20593、L20601）。
- `widgetProvider`：`name`（必填）、`path`（必填，js 文件路径），示例 `{ "name": "music", "path": "/widgetProvider/index.js" }`（L20615-20626）。

---

## 3. UX 文件三段式与脚本对象

### 3.1 三段式（L21368）

ux 后缀文件由 **javascript 代码 + template 模板 + style 样式** 三部分组成。示例中 `<script>` 在前、`<template>`、`<style>` 顺序（L21371-21400）。

```html
<script>
  import router from '@blueos.app.router'
  export default {
    data: { title: '示例页面' },
    routeDetail() { router.push({ uri: '/DemoDetail' }) },
  }
</script>

<template>
  <!-- template 里只能有一个根节点 -->
  <div class="flex flex-col justify-center items-center">
    <text>欢迎打开{{title}}</text>
  </div>
</template>

<style>
@tailwind utilities;
</style>
```

- **template 里只能有一个根节点**（L21390）。
- 示例中 `<style>` 内出现 `@tailwind utilities;`（L21399、L21708），说明模板类名可走 tailwind 风格，但文档没有 tailwind 的独立章节。
- `app.ux` 编译后会包含 manifest 配置信息，**不要删除 `/**manifest**/` 注释标识**（L21408）。
- `app.ux` 的 `<script>` 可引入公共脚本并暴露到 app 对象，页面中通过 `this.$app.$def.util` 访问（L21411、L21414-21426）。

### 3.2 语法与模块（L20663-20696）

- 支持 **ES6** 语法（L20663）。
- 支持 ES6 module（`import`）与 CommonJS（`require`）（L20670）；示例：

```ts
// require
const fetch = require('@blueos.communication.network.fetch')
// import
import fetch from '@blueos.communication.network.fetch'
```

（L20673-20681）
- JS 代码引用推荐用 import，如 `import utils from '../Common/utils.js'`（L20688-20692）。
- **蓝河应用环境不是 node 环境，不要引用 node 原生模块**，如 `import fs from 'fs'`（L20696）。

### 3.3 页面/组件对象（L20703-20831）

| 对象/属性 | 类型 | 说明 | 行号 |
|---|---|---|---|
| data（页面级） | Object / Function | 页面数据模型；属性名不能以 `$`/`_` 开头，不能用 for/if/show/tid 保留字；为函数时返回对象；data 声明的属性会被外部数据覆盖 | L20712 |
| data（自定义组件） | Object / Function | 同上 | L20745 |
| props | Array / Object | 外部可传属性；属性名规则同上；模板中须用短横线命名（`propA` → `prop-a`） | L20746 |
| $app | Object | 应用对象 | L20784 |
| $page | Object | 页面对象 | L20785 |
| $valid | Boolean | 页面对象是否有效 | L20786 |
| $device | { deviceType: string } | watch-square 方形手表 / watch-round 圆形手表 | L20787 |
| $app.$def | Object | app.ux 中暴露的对象 | L20802 |

### 3.4 方法与事件（L20810-20867）

| 方法 | 参数 | 说明 | 行号 |
|---|---|---|---|
| this.$element(id) | id: String | 获取指定 id 组件，调用其组件方法 | L20818 |
| this.$set(key, value) | key/value | 动态添加数据属性（响应式） | L20819 |
| this.$watch(data, handler) | 属性名、函数名 | 属性必须在 data 中定义，handler 必须在 script 定义；支持 'a.b.c'，不支持数组索引 | L20831 |
| this.$app.exit() | 无 | 退出应用、结束应用生命周期；依赖 feature `blueos.app.app` | L20846、L20849 |
| this.$page.setStopGestureQuit(n) | Number | 是否屏蔽手势返回：1 屏蔽、0 不屏蔽；依赖 feature `blueos.app.router` | L20864、L20867 |

---

## 4. 生命周期

### 4.1 应用生命周期（L2137-2190）

| 回调 | 说明 | 行号 |
|---|---|---|
| onCreate | 监听应用创建，应用创建时调用，无参数 | L2144 |
| onDestroy | 监听应用销毁，应用销毁时调用，无参数 | L2157 |
| onShow | 应用显示在前台时调用，无参数 | L2170 |
| onHide | 应用退到后台时调用，无参数 | L2183 |

写在哪：`app.ux` 用于全局 JavaScript 逻辑和应用生命周期管理（L20062），app.ux 示例 L21414-21426。生命周期总图和说明入口 L2135。

### 4.2 页面生命周期（L2193-2404）

- **onInit**：页面完成初始化时调用，只触发一次（L2200）。
- **onReady**：页面完成创建可以显示时触发，只触发一次（L2213）。
- **onShow**：页面被打开、或从后台切到前台时触发；应用处于后台时打开页面但页面未在前台显示则**不触发**（L2226）。
- **onHide**：页面切后台或关闭时触发；应用处于后台时页面被关闭则**不触发**（L2239）。
- **onDestroy**：页面跳转离开（退出页面栈）时触发（L2252）。
- **onBackPress**：用户执行返回时触发；**只有当前页面配置 `followHand: disable` 该接口才生效**（L2265）；返回 `boolean`，true 表示页面自己处理返回逻辑，false/不返回走默认逻辑；**不支持 async**（L2282）。
- **onRefresh**：页面重新打开；**在 onShow 之前执行**；launchMode 为 `singleTask` 时多次打开触发（L2289、L2292）；参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| query | Object | deeplink、router.push 等传入 uri 的 query 解析对象，或 router.push 传入的 params 对象 |

（L2304-2306）
- **onKey**：按键触发时回调，参数 `event`（L2313、L2321）：

| 参数 | 类型 | 说明 |
|---|---|---|
| keyCode | Number | 0：下键(电源键)，1：上键 |
| keyAction | Number | 0 按下、1 短按弹起、2 长按弹起 |
| repeatCount | Number | 长按时连续按下事件递增，首个为 0 |

（L2329-2331，示例 L2338-2342）
- **onConfigurationChanged**：监听系统语言改变，`event.type` 目前只支持 `'locale'`（L2349、L2373，示例 L2380-2384）。
- **onPalmOver**：监听手掌覆盖，返回 `true` 表示不将事件继续传给 launcher，其他值/不返回则继续传递（L2389、L2404，示例 L2411-2414）。

### 4.3 自定义组件生命周期（L2419-2462）

| 回调 | 说明 | 行号 |
|---|---|---|
| onInit | 数据驱动化完成时触发 | L2429 |
| onReady | 模板创建完成时触发 | L2442 |
| onDestroy | 组件销毁时触发 | L2455 |

自定义组件=通过 import 标签引入的 ViewModel 组件（L2422）。

### 4.4 后台运行（L2807-2888）

- 通常应用切后台即暂停；音乐/运动类可申请后台运行（L2819）。
- 条件：manifest 声明了后台运行接口，且至少一个已声明接口正在运行（L2830-2834）。
- 实践建议：后台接口的导入与后台执行放到 **app.ux**，不要放页面（L2849）。
- 支持的模块表：`blueos.multimedia.audio`（音频播放）、`blueos.multimedia.record`、`blueos.multimedia.media`、`blueos.communication.network.request`、`blueos.hardware.geolocation`、`blueos.bluetooth.ble`（L2859-2866）；配置示例 L2872-2887。

---

## 5. 路由

### 5.1 接口声明与导入（L12192-12204）

- 接口声明：**无需声明**（L12195）。
- 导入：

```ts
import router from '@blueos.app.appmanager.router'
// 或
const router = require('@blueos.app.appmanager.router')
```

（L12203）
- 指南页示例使用 `import router from '@blueos.app.router'`（L26450、L26507、L21373）。两处路径不一致，按文档原样记录，见 §12。
- 页面方法 `$page.setStopGestureQuit` 声明依赖 feature `blueos.app.router`（L20864-20867）。

### 5.2 router.push(OBJECT)（L12212-12310）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| uri | String | 是 | 见下方三种格式 |
| params | Object | 否 | 跳转数据；目标页用 `this.param1` 方式使用，值统一转成 String |
| transition | Object | 否 | 转场动画，优先级高于 router.setTransition |

（L12228-12232）

uri 三种格式（L12230）：
1. 以 `/` 开头 = 应用内页面路径，例 `/about`；
2. 不以 `/` 开头 = 应用内页面名称，例 `About`；
3. 特殊值 `/` = 跳转到 path 为 `/` 的页面，没有则跳转首页。

示例（L12273-12310）：

```ts
router.push({ uri: '/about', params: { testId: '1' } })       // path 切换
router.push({ uri: 'About', params: { testId: '1' } })        // name 切换
router.push({ uri: 'hap://app/com.vivo.bind/pages/bindmain?key=value' }) // deeplink
```

transition 结构：`{ forward: { enter, exit }, back: { enter, exit } }`（L12239-12258）。

### 5.3 其余 router 方法

| 方法 | 说明 | 行号 |
|---|---|---|
| router.replace(OBJECT) | 跳转页面，当前页面无法返回；参数 uri/params 同 push | L12314、L12334-12335 |
| router.back() | 返回上一页面（可连续调用） | L12353、L12363-12384 |
| router.clear() | 清空所有历史页面记录，仅保留当前页面（栈顶） | L12388、L12406 |
| router.getState() | 返回 `{ index, name, path }`：当前页在页面栈位置、页面名称、页面路径 | L12411、L12423-12425 |
| router.setTransition(OBJECT) | 设置应用默认转场动画，结构同上 | L12441、L12453-12454 |

内置动画别名（L12505-12513）：`slideInLeft`（打开）、`slideOutRight`（关闭）、`fadeIn`、`fadeOut`、`none`、`zoomIn`、`zoomOut`。

### 5.4 组件 a / 接收参数（L26365-26585）

- `a` 组件通过 `href` 跳转应用内页面（L26373），支持 `/PageParams/receiveparams`、`PageParams/receiveparams`、`/`（首页）三种写法（L26382-26387）。
- 传参用 `?key=value`，支持变量：`href="/PageParams/receiveparams?key={{title}}"`（L26397、L26418-26420）。
- **接收参数：在页面 ViewModel 的 `data` 属性中声明要用的属性**（L26553），示例 `data: { key: '' }`，`onInit` 里 `this.key`，模板 `{{key}}`（L26559-26585）。

---

## 6. 数据绑定与模板指令

### 6.1 数据绑定（L25263-25326）

- 绑定写法 `{{varname}}`，数据变化自动更新 UI（L25278）。
- **响应式数据必须先在 data 上静态声明，或使用 `this.$set` 动态添加**；不能直接 `this.title = 'hello'` 新增（L25310，错误示例 L25317-25326）。

### 6.2 事件绑定（L25330-25428）

- `onclick`、`onchange` 可简写为 `@click`、`@change`（L25345）；两种写法等价（L32740）。
- 事件可传自定义参数 + 末尾自动追加 evt：`onclick="onClickHandler2('参数1', argName)"`，回调签名 `(arg1, arg2, evt)`（L25361、L25382-25384、L25425）。
- 列表内传参示例：`onclick="handle($idx,$item,total)"`（L25404）。

### 6.3 for 列表渲染（L25432-25603）

- 基础：`for="{{list}}"`，默认元素变量 `$item`、索引 `$idx`（L25448-25457）。
- 自定义元素名：`for="{{value in list}}"`（L25465）。
- 自定义索引和元素名：`for="{{(index, value) in list}}"`（L25482）。
- 常数循环：`for="{{value in 10}}"`、`for="{{(index,value) in 5}}"`，等价 0..n-1（L25496-25502）。
- `tid` 属性指定循环项唯一 ID，用于 DOM 复用/性能优化，未指定默认 `$idx`（L25513）：
  - tid 指定的属性必须存在，否则可能运行异常（L25597）；
  - 必须唯一，否则性能问题（L25599）；
  - **不支持表达式**（L25601）。
- 注意：for 只能循环数组不能循环对象；for 与 if 同标签时 **if 优先**，不建议共存；自定义变量名不能以 `$`/`_` 开头（L25594）。

### 6.4 if / show（L25605-25685）

- 条件渲染两种：`if/elif/else` 与 `show`；if 为 false 时组件从 DOM 移除，show 仅不可见但仍在 DOM（L25613、L25681-25685）。
- `if/elif/else` 必须是相邻兄弟节点（L25623）；示例 L25626-25642。
- show 等同 `visible=none`，主要用于原生组件声明；新版本支持在自定义组件上声明（等同作用于其根节点）（L25652、L25655-25658）。

### 6.5 文本容器限制（L25876）

`div` 是最常用的 Flex 容器；`text`、`a`、`span`、`label` 是文本容器组件；**其它组件不能直接放置文本内容**（L25876）。

---

## 7. 组件

### 7.1 容器组件

#### div（L29832-29856）
- 基本容器，支持子组件、通用属性/样式/事件（L29840）。
- 样式额外支持：`flex-direction`（默认 row，父容器为 div、list-item 时生效）、`flex-wrap`、`justify-content`、`align-items`、`align-content`（L29850-29856）。

#### list-item（L29860-29906）
- `<list>` 的子组件，宽度默认充满 list，支持子组件；支持 div 样式但**不支持 position 样式**（L29868）。
- 属性 `type`（必填，自定义字符串）：相同 type 的 list-item 必须具备完全一致的 DOM 结构，内部慎用 if/for（L29883）。
- 样式 `column-span`（默认 1，list 多列显示用）（L29895）。
- Slots：`right`（左滑后右端显示）（L29904）。

#### list（L29908-29989）
- 列表视图容器，**仅支持 `<list-item>` 子组件**（L29916）。
- 属性（L29938-29945）：

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| type | normal/fisheye/grid | normal | 布局方式，不可动态变更 |
| scrollbar | boolean | false | 是否启用滚动条 |
| title | boolean | false | 第一个 list-item 作为标题，上滑渐隐 |
| circular | boolean | false | 是否循环展示，true 时部分滚动事件不可用 |
| alignmentnum | number | 3 | 鱼眼布局一屏对齐数量 3-7 |
| bounces | boolean | true | 是否启用回弹 |

- 样式：`flex-direction`（column/row，默认 column）、`columns`（列数，默认 1）（L29957-29958）。
- 事件：`scrollbottom`、`scrolltop`、`scrollindex`（参数 `{first,last}` 可视范围索引）（L29965-29969）。
- 方法：`scrollTo({index, behavior})`，behavior 支持 smooth/instant/auto（L29973-29987）。

#### scroll（L30023-30194）
- 竖向或水平滚动容器；**竖向滚动需设置定高，水平滚动需设置定宽**（L30031）。
- 支持子组件，也支持嵌套 scroll（L30038）。
- 属性：`scroll-x`、`scroll-y`（默认 false）、`scroll-top`、`scroll-bottom`、`scroll-left`、`scroll-right`、`bounces`（默认 false）（L30060-30068）。
- **不支持 margin、padding 相关样式**（L30078）。
- 吸附样式：`scroll-snap-type`（x/y + mandatory/proximity，默认 proximity）、`scroll-snap-align`（none/start/center/end）、`scroll-snap-stop`（normal/always）（L30095-30099）。
- 事件：`scrolltop`、`scrollbottom`、`scroll`（参数 `{scrollX, scrollY}`）（L30110-30114）。
- 方法：`getScrollRect({success({width,height})})`、`revealScrollbar({success})`（L30123-30194）。

#### stack（L30198-30220）
- 基本容器，子组件层叠排列，后一个覆盖前一个；支持子组件、通用属性、div 样式、通用事件（L30206、L30213、L30220）。

#### swiper（L30224-30340）
- 滑块视图容器，支持子组件（L30232）。
- 属性：`index`（默认 0）、`indicator`（默认 true）、`scrollbar`、`vertical`、`previousmargin`/`nextmargin`（px 或 %，两者之和不超过 swiper 一半）、`enableswipe`（默认 true）、`effect`（scroll/fade）（L30263-30275）。
- indicator 样式：`indicator-type`（normal/arc）、`indicator-color`、`indicator-selected-color`、`indicator-size`（默认 12px）、`indicator-[top/left/right/bottom]`、`indicator-spacing`（L30300-30307）。
- 事件：`change`（`{index}`）、`scrollbottom`、`scrolltop`（L30317-30321）。
- 方法：`swipeTo({index, behavior})`（L30330-30340）。

### 7.2 基础组件

#### text（L29749-29826）
- 文本内容写在标签内容区（L29757）；子组件仅支持 `span`（L29764）。
- 样式：`min-width`、`min-height`、`max-width`、`max-height`、`lines`（默认 -1 不限）、`color`（默认 #757575）、`font-size`（默认 30px）、`font-weight`（**当前平台仅支持 normal 与 bold**）、`text-decoration`（underline/line-through/none）、`text-align`（left/center/right）、`line-height`、`text-overflow`（clip/ellipsis，设置行数时生效）（L29806-29819）。

#### image（L28247-28483）
- **不支持子组件、事件、方法**（L28255）。
- 属性：`src`（本地/网络；格式 png、svg、.9、gif）、`alt`（占位图，只支持本地 png；传 `"blank"` 可避免远程图首次加载闪烁）（L28271-28289）。
- 样式：`object-fit`（contain/cover/fill/none/scale-down，默认 **cover**）（L28418-28435）；`width`/`height` 不设置时使用图片原始宽高（L28482-28483）。

#### 其它基础组件（L28688-28699）
`a`（超链接）、`span`（格式化文本，只能作为子组件，不支持事件，不支持换行）、`marquee`（跑马灯，默认单行）、`progress`（进度条，不支持子组件）、`arc-text`（弧形文本，超出截断）、`barcode`、`qrcode`、`canvas`。

#### canvas（L26591-27699）
画布组件，含属性/样式/方法（L26610-26624）；另有子章节方法和语法（L26678、L27651、L27662）。

### 7.3 表单组件

#### input（L31750-31974）
- 默认单行，**不支持子组件**（L31758、L31765）。
- 属性：`type`（button/checkbox/radio/text/date/speak，默认 text；可动态修改）、`checked`、`name`、`value`、`placeholder`（type 为 text/date/speak 时生效）（L31790-31796）。
- 样式：`color`（默认 #000）、`caret-color`、`font-size`（默认 43.2px）、`text-decoration`（仅 underline）、`placeholder-color`、`width`、`height`（L31827-31835）。
- 事件：`change`（type 为 button 时无 change）、`focus`（返回光标下标）（L31845-31848）。
- 方法：`setSpan({start,end,style})`（仅 color、text-decoration）、`focus()`（type 为 text/speak 生效）（L31865-31879）。

#### slider（L32260-32348）
- 滑动型输入器，不支持子组件（L32268、L32275）。
- 属性：`min`（0）、`max`（100）、`value`（0）、`type`（vertical 为垂直，不设置为水平）、`show-block`（默认 true）（L32303-32309）。
- 样式：`color`（背景条 #f0f0f0）、`selected-color`（#009688）、`block-color`、`padding-[left/right]`（默认 32px）（L32331-32336）。
- 事件：`change`，参数 `{progress, isFromUser}`，拖动过程中触发（L32346-32348）。

#### switch（L32352-32415）
- 开关选择，不支持子组件（L32360、L32367）。
- 属性：`checked`（默认 false，可触发 checked 伪类）（L32380-32382）。
- 样式：`thumb-color`、`track-color`（默认 #009385）（L32400-32403）。
- 事件：`change`，参数 `{checked}`（L32413-32415）。

#### 其它表单组件（L32047-32054）
`label`（标注）、`picker`（滚动选择器：普通/日期/时间/弧形）、`artboard`（接收笔画输入）。

### 7.4 系统风格组件（L30618-30631）

`vw-alert`（应用内弹窗）、`vw-button`（文字按钮/图标按钮）、`vw-empty`（空白页）、`vw-icon`（常用图标）、`vw-slide`（快速调节值）、`vw-title`（页面顶部标题）、`vw-list` / `vw-list-item`（列表）、`vw-loading`（加载中）。

### 7.5 表冠（旋转表冠）交互（L33870-34019）

- 只有获得表冠焦点的组件才响应表冠事件；**页面中只允许一个组件获得焦点**；默认焦点在最外层最后一个可响应表冠的组件上（L33878、L33885、L33888）。
- 默认支持表冠的组件：`list`、`swiper`、`picker`、`slider`、`scroll`（L33905-33911）。
- 通用属性：`vibration-effectEnabled`（默认 true）、`rotation-sensitivity`（1 低/2 正常/3 高）、`touch-focusable`（默认 false）（L33926-33930）。
- 通用事件 `rotation`，回调参数：`direction`（逆时针正转 true）、`delta`（单次变化量，绝对值通常 1）、`velocity`（刻度/秒）、`duration`（ms）、`state`（1 开始/2 旋转中/3 结束）（L33939、L33946-33952）。
- 通用方法 `requestFocus(true)`：让当前组件抢占焦点，优先级最高（L33961）；示例 `this.$element('picker').requestFocus(true)`（L33975-33978）、自定义 div 绑定 `@rotation`（L33999-34012）。

---

## 8. 样式（CSS）支持范围与限制

### 8.1 基本规则（L20876-20916）

- 样式布局采用 **CSS Flexbox**，针对部分原生组件有少量扩充与修改（L20882）。
- 「所有与大小相关的样式（如 width、font-size）均以基准宽度（**默认 750px**）为基础，根据实际屏幕宽度进行缩放」（L20885）。
  > 注意：manifest 章节建议 `designWidth` 用 466（L20453），屏幕适配章节示例也用 466（L2554-2574）。两处表述需以项目配置为准。
- `@import` 支持引入外部 css（L20892-20900）；支持 `style` 内联与 `class`（L20908-20916）。
- 伪类：**仅支持 `:active`**（L20928）。

### 8.2 选择器（L20932-21061）

支持：`.class`、`#id`、`tag`、`,`（并列）、后代（空格）、直接后代（`>`）（L20938-20944）。
- 只支持「CSS 声明的多个选择器中**最后一个规则的变更**对 DOM 的更新」；非末尾选择器变更不会通知 DOM 更新（L20974、L21008-21011）。
- 优先级与浏览器一致，是子集（inline、id、class、tag、后代、直接后代）：inline > #id > .class > tag（L21018-21021）；权值 ID 10000、class 100、type 1（L21025-21033）；同权值按声明顺序后者覆盖（L21061）。

### 8.3 长度/颜色类型（L33022-33041）

- `length`：number 时按 px；string 时需显式单位，当前支持 px（L33028）。
- `percentage`：如 `50%`（L33029）。
- `color`：`rgb(255,255,255)`、`rgba(255,255,255,1.0)`、HEX `#rrggbb` / `#aarrggbb`、枚举 `black`/`white`（L33041）。
- 颜色格式示例还包括 `#f0f`、`#ff00ff13`、`black,white`（L32636-32646）；完整颜色枚举表 L33047-33194。

### 8.4 通用样式白名单（L33310-33341）

| 属性 | 支持值/说明 | 行号 |
|---|---|---|
| width / height | length 或 percentage；未设置时使用内容尺寸 | L33312-33313 |
| padding / padding-[left/top/right/bottom] | length，默认 0，不能为负 | L33314-33315 |
| margin / margin-[left/top/right/bottom] | length，默认 0，不能为负 | L33316-33317 |
| border / border-[left/top/right/bottom] | 简写 width style color | L33318-33319 |
| border-style | 仅支持 1 个值（默认 solid） | L33320 |
| border-width / 各方向 | length | L33321-33322 |
| border-color / 各方向 | color | L33323-33324 |
| border-radius | length/percentage；需同时设置 border-width、border-color 才生效 | L33325 |
| border-[top/bottom]-[left/right]-radius | 四角圆角 | L33326 |
| background | linear-gradient；不能与 background-color、background-image 同时使用 | L33327 |
| background-color / color | color | L33328-33329 |
| background-image | uri；不支持与 background-color、border-color 同用；**支持本地图片，暂不支持网络图片** | L33330 |
| background-size | contain / cover / auto / length / percentage | L33331 |
| background-repeat | repeat-x / repeat-y / no-repeat / repeat | L33332 |
| background-position | 1-4 个参数（length/percentage/left/right/top/bottom/center） | L33333 |
| opacity | number，默认 1 | L33334 |
| display | **仅 flex、none** | L33335 |
| visibility | visible / hidden | L33336 |
| flex-direction | column/row/column-reverse/row-reverse；默认 row，父容器为 div、list-item 时生效 | L33337 |
| align-items | stretch/flex-start/flex-end/center | L33338 |
| justify-content | flex-start/flex-end/center/space-between/space-around | L33339 |
| position | fixed/absolute/relative（默认 relative）；**父容器为 list、swiper 时不生效，scroll 不支持** | L33340 |
| left/top/right/bottom | length，配合 fixed/absolute 使用 | L33341 |

**注意**：flex 布局仅支持上表列出的样式，**不要使用 `flex: 1`** 等 w3c 标准属性，否则产生不可预知布局问题（L33347）。

### 8.5 页面布局（L25689-25914）

- **盒模型为 border-box**；暂不支持 content-box，也不能手动指定 box-sizing（L25704）。
- 宽高计算：`Width = width(含 padding-left+right+border-left+right)`，Height 同理（L25710-25716）。
- `px` 是相对「项目配置基准宽度」的单位，原理类似 rem（L25727）；基准宽度来自 `config.designWidth`（L25733）；换算公式 `设计稿1px / 设计稿基准宽度 = 框架样式1px / 项目配置基准宽度`（L25740），示例：设计稿 640 基准、元素 100px，项目基准 466 时写 `73px`（L25779-25786）。
- `position` 支持 relative/absolute/fixed，默认 relative（L25794）。
- 样式隔离：template 只读内联样式 + 当前 ux 的 `<style>` 与引入的 css/less/scss；**自定义组件被父组件引用时，其样式不响应父组件样式**（L25810）。
- `div` 是 Flex 容器；text/a/span/label 是文本容器；其它组件不能直接放文本（L25876）。

### 8.6 动画（L32419-32614）

- 提供 `transform` 类与 `animation` 类样式，参数格式与 CSS 对齐（L32429）。
- 样式表（L32467-32477）：`transform-origin`（仅 px，如 `50px 100px`）、`transform`、`animation-name`、`animation-delay`（s/ms）、`animation-duration`（s/ms）、`animation-iteration-count`（整数或 infinite）、`animation-timing-function`（linear/ease/ease-in/ease-out/ease-in-out/cubic-bezier(...)/step-start/step-end/steps(...)）、`animation-fill-mode`（none/forwards；backwards、both **暂不支持**，L32561）、`animation-direction`（normal/reverse/alternate/alternate-reverse）。
- `transform` 支持：translate、translateX、translateY、scale、scaleX、scaleY、rotate（L32530-32538）。
- `@keyframes` 支持属性：background-color、opacity、width/height（**不支持百分比**）、transform（L32603-32608）；**0% 与 100% 必须显式指定**（L32614）。
- 另见组件动画 `Element.animate()`（L33351-33622，接口语法 L33370-33517）与自定义字体 font-face（L33624-33746）。

### 8.7 预编译与媒体查询

- 支持 less 与 sass 预编译（L21067）；`<style lang="less" src="./lessFile.less">`（L21072）；less 需装 `less`、`less-loader`（L21250），scss 需装 `node-sass`、`sass-loader`（L21282）。
- 媒体查询语法：`@media [media-type] [and|not|only] [(media-feature)] { ... }`（L21107）；示例（L21119-21142）：

```css
@media (max-width: 30) { }                  /* level3 */
@media (width <= 30) { }                    /* level4 */
@media screen and (min-width: 400) and (max-width: 700) { }
@media (400 <= width <= 700) { }
@media screen and (device: watch-square) or screen and (device: phone) { }
```

- 媒体类型只有 `screen`（L21314）。
- 逻辑操作符：and、not、only、`,`（等价 or）、or、`<=`、`>=`、`<`、`>`（L21326-21334）。
- 媒体特性（L21346-21356）：height、min-height、max-height、width、min-width、max-width（查询时**不带单位**，支持单位 dp）、orientation（portrait/landscape）、aspect-ratio / min / max（如 `1 / 2`）、`device`（phone、watch、car、tv、pad、watch-square、watch-round；**watch 默认 watch-square**）。
- 通过 `@import url [media-type] ...` 引入带媒体查询的样式（L21154、L21162）。
- 动态修改样式四种方式：改 class、改内联 style、改绑定对象、改绑定样式字符串（L21173-21179，示例 L21184-21235）。

---

## 9. 屏幕适配（watch-round / watch-square / designWidth / DPR）

### 9.1 设备类型

- manifest `deviceTypeList` 可选 `watch,watch-square,watch-round,tv,car,phone`，默认 watch（L20378）。
- `$device.deviceType`：`watch-square` 方形手表、`watch-round` 圆形手表（L20787）。
- 模板差异布局（L2654-2658）：

```html
<div>
  <header-of-square if="$device.deviceType == 'watch-square'"></header-of-square>
  <header-of-round elif="$device.deviceType == 'watch-round'"></header-of-round>
</div>
```

- 媒体查询 `device` 特性取值同上，watch 默认 watch-square（L21356、L2633-2637）。

### 9.2 designWidth 与 px（L2551-2575）

- 在 manifest 配置 `config.designWidth` 即自动等比缩放（L2554）。
- 示例：designWidth=466 时，所有 px 按 466 基准换算，`width:233px; height:233px;` 显示为屏幕宽高的一半（L2560-2575）。
- manifest 章节：designWidth「建议使用 466」（L20453）。

### 9.3 非等比屏幕与 dp（L2579-2621）

- px 产生等比缩放；**dp 为绝对的屏幕尺寸**（L2589）。
- `屏幕宽度dp值 = 设备屏幕分辨率的宽度 / DPR`（L2596）。
- DPR 取值表（L2603-2610）：ldpi 0.75 / mdpi 1 / hdpi 1.5 / xhdpi 2.0 / xxhdpi 3.0 / xxxhdpi 4.0。
- dp 可用于常见 DOM 元素宽高，如 `width:50dp; height:50dp;`（L2616-2621）。

### 9.4 资源匹配与 $res（L2665-2803）

- 资源与应用捆绑部署，运行时访问：静态数据（JSON）、配置、图片（JPEG、WebP、GIF、动画 WebP/GIF、PNG、BMP、WBMP）（L2669）。
- 项目根目录 `resources` 文件夹放 JSON 配置；文件名以 `res` 开头、连字符加限定词；默认 `res-defaults.json`（L2672-2679）。
- 命名规则：`res-watch-分辨率-手表形状-屏幕密度.json`，限定词顺序 分辨率 > 表盘形状 > 屏幕密度；分辨率写作 `宽x高`（小写 x）；密度 ldpi/mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi；形状 square/round（L2687-2702）。
- 命中权重：分辨率 1000 > 表盘形状 100 > 屏幕密度 10（L2705-2708）；示例 `res-watch-402x402-square-ldpi.json`（权重 1110）、`res-watch-402x402-round.json`（1100）、`res-watch-square.json`（100）、`res-watch-402x402.json`（1000）、`res-watch-ldpi.json`（10）、`res-watch.json`、`res-defaults.json`（L2711-2737）。
- 配置格式（L2747-2773）：

```json
// resources/res-watch.json
{
  "image": { "logo": "/common/watch/logo.png", "banner": "/common/watch/banner.png" },
  "colors": { "headerBackGround": "#fff000" }
}
```

- `$res(path: String)`：根据配置的 resources 与当前系统参数返回对应资源（L2784）；template 与 script 都可用（L2790-2802）：

```html
<div style="background-color: {{ $res('colors.headerBackGround') }}">
  <image src="{{ $res('image.banner') }}"></image>
</div>
```

- **注意**：文档没有 466×466、432×514 这两个具体分辨率的适配说明，只有 402x402 的资源命名示例（L2714-2718）。见 §12。

---

## 10. 常用 API 细节

### 10.1 文件存储 file（L3555-4236）

- feature：`{ "name": "blueos.storage.file" }`（L3568）；`import file from '@blueos.storage.file'`（L3577）。
- **注意：文件操作仅支持 URI 写法，不支持文件绝对路径**（L3581）。

| 方法 | 参数 | 说明/限制 | 行号 |
|---|---|---|---|
| file.move | srcUri, dstUri | 不能是应用资源路径和 tmp 类型 uri | L3589、L3601-3602 |
| file.copy | srcUri, dstUri | dstUri 不能是资源路径和 tmp | L3637、L3650 |
| file.list | uri | 目录 uri，不能是资源路径和 tmp；另注「支持应用资源路径」 | L3685、L3697 |
| file.get | uri | 文件 uri，「不能是应用资源路径。支持应用资源路径」（原文自相矛盾） | L3751、L3763 |
| file.delete | uri | 不能是应用资源路径和 tmp | L3813、L3825 |
| file.writeText | uri, text, encoding(默认 UTF-8), append(默认 false) | 不支持资源文件路径和 tmp 分区；文件不存在会创建 | L3859、L3871-3877 |
| file.writeArrayBuffer | uri, buffer(Uint8Array), position(默认 0), append | 同上限制 | L3909、L3921-3927 |
| file.readText | uri, encoding(默认 UTF-8) | success 返回 `{ text }` | L3959、L3971-3984 |
| file.readArrayBuffer | uri, position, length | success 返回 `{ buffer: Uint8Array }` | L4016、L4028-4042 |
| file.access | uri | 判断文件或目录是否存在；「不能是应用资源路径和 tmp。支持应用资源路径」（原文矛盾） | L4076、L4088 |
| file.mkdir | uri | 目录 uri，不能是资源路径和 tmp | L4122、L4134 |
| file.rmdir | uri | 同上 | L4169、L4181 |

示例（L3894-3904、L4002-4011、L4060-4072）：

```ts
file.writeText({ uri: 'internal://files/work/demo.txt', text: 'test', success(){}, fail(data, code){} })
file.readText({ uri: 'internal://files/work/demo.txt',
  success(data){ console.log('text: ' + data.text) }, fail(data, code){} })
file.readArrayBuffer({ uri: 'internal://files/work/demo', position: 100, length: 100,
  success(data){ console.log(data.buffer.byteLength) } })
```

错误码：202 参数错误、300 I/O 错误、301 文件不存在（L3991-3995 等）。

### 10.2 应用沙箱目录（L2020-2120）

| 沙箱目录 | 用途 | URI |
|---|---|---|
| files | 小而重要的数据（如登录数据），持久有效 | `internal://files/` |
| cache | 缓存文件（图片/音频），可能被系统清理 | `internal://cache/` |
| mass | 大文件（下载的音频等） | `internal://mass/` |
| tmp | 临时文件，应用退出后清理 | `internal://tmp/` |
| preferences | key-val 数据，**只能通过 storage API 访问**，有大小限制 | - |

（L2042-2048、L2062-2067、L2105）
- 写沙箱示例：`file.writeText({ uri: 'internal://files/demo.json', ... })`（L2073-2083）。
- 使用原则：文件用 `blueos.storage.file` + URI 拼接，避免绝对路径；key-val 用 `blueos.storage.storage`；沙箱内图片要用 image 标签访问也须用 URI；音视频播放同样需 URI（L2114-2120）。

### 10.3 K-V 存储 storage（L4238-4603）

- feature：`{ "name": "blueos.storage.storage" }`（L4251）；`import storage from '@blueos.storage.storage'`（L4260）。

| 方法 | 参数 | 说明 | 行号 |
|---|---|---|---|
| storage.get | key（必填）、default、success/fail/complete | 读；key 不存在返回 default，未指定 default 返回长度 0 的空字符串 | L4269、L4282 |
| storage.getSync | key | 同步读，返回 String/Boolean/Number/Object/Array | L4313、L4334 |
| storage.set | key、value（String/Boolean/Number/Object/Array）、回调 | 修改存储；**value 为空字符串会删除该 key** | L4347、L4360 |
| storage.clear | 回调 | 清空存储内容 | L4457 |
| storage.delete | key、回调 | 删除存储内容 | L4491 |
| storage.key | index、回调 | 返回某个 index 的键名 | L4527 |
| 属性 storage.length | - | 存储数据项数量（只读） | L4575 |

示例（L4300-4308、L4342、L4371-4381）：

```ts
storage.set({ key: 'A1', value: 'V1', success(){}, fail(data, code){} })
const value = storage.getSync({ key: 'A1' })
storage.get({ key: 'A1', success(data){}, fail(data, code){} })
```

- fail 回调参数：`data`（失败信息 string）、`code`（FailCodeEnum）；`302` = 存储空间不足（L4591-4603）。

### 10.4 弹窗 prompt（L11685-11740）

- feature：`{ "name": "blueos.window.prompt" }`（L11698）；`import prompt from '@blueos.window.prompt'`（L11707）。
- **文档该模块只有 `prompt.showToast(OBJECT)`**（L11716）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| message | String | 是 | 要显示的文本 |
| duration | Number | 否 | 0 短时，1 长时，默认 0 |

```ts
prompt.showToast({ message: 'message' })
```

### 10.5 屏幕亮度/常亮 brightness（L7155-7509）

- feature：`{ "name": "blueos.hardware.display.brightness" }`（L7168）；`import brightness from '@blueos.hardware.display.brightness'`（L7177）。

| 方法 | 参数 | 说明 | 行号 |
|---|---|---|---|
| brightness.getValue | 回调 | 返回 `{value}` 0-255 | L7186、L7209 |
| brightness.getValueSync | 无 | 返回 value 0-255 | L7229 |
| brightness.setValue | value(0-255) | 设置亮度 | L7261、L7273 |
| brightness.getMode | 回调 | 返回 `{mode}`：0 手动、1 自动 | L7297、L7320 |
| brightness.setMode | mode(0/1) | 设置亮度模式 | L7340、L7352 |
| **brightness.setKeepScreenOn** | **keepScreenOn: Boolean** | **设置是否保持常亮** | **L7376、L7388** |
| brightness.wakeScreenOn | screenOn: Boolean | 点亮或熄灭屏幕 | L7412、L7424 |
| brightness.subscribe | callback、fail | 监听亮度，多次调用仅最后一次生效 | L7448、L7451 |
| brightness.unsubscribe | 无 | 取消监听 | L7490 |

常亮示例（L7399-7407）：

```ts
brightness.setKeepScreenOn({
  keepScreenOn: true,
  success: function () { console.log('handling success') },
  fail: function (data, code) { console.log(`handling fail, code = ${code}`) },
})
```

> 文档中**没有** window/display 模块提供 setKeepScreenOn；常亮只有 brightness 这一处（见 §13）。

### 10.6 屏幕管理 screen（L12672-12766）

- feature：`{ "name": "blueos.hardware.display.screen" }`（L12685）；`import screen from '@blueos.hardware.display.screen'`（L12694）。
- `screen.getScreenOffTime()`：获取熄屏时间，返回 Number，1-999 秒（L12703、L12722）。
- `screen.getAodStatus()`：返回 0 = AOD 关闭、1 = AOD 打开（L12735、L12757）。

### 10.7 设备信息 device（L7944-8078）

- feature：`{ "name": "blueos.hardware.deviceInfo" }`（L7957）；`import device from '@blueos.hardware.deviceInfo'`（L7966）。
- 需要权限（L7970-7978）：

```json
{ "permissions": [{ "name": "watch.permission.DEVICE_INFO" }] }
```

- `device.getInfo({success, fail, complete})`（L7986）；success 返回字段（L8009-8033）：

| 字段 | 类型 | 说明 |
|---|---|---|
| brand / manufacturer / model / product | String | 品牌/厂商/型号/代号 |
| osType / osVersionName / osVersionCode | String/Integer | 操作系统名称、版本名称、版本号 |
| platformVersionName / platformVersionCode | String/Integer | 运行平台版本名称/号 |
| language / region | String | 系统语言、系统地区 |
| deviceName / hardwareVersion / softwareVersion | String | 设备名、硬件版本、软件版本 |
| **screenWidth / screenHeight** | Integer | 屏幕宽 / 屏幕高 |
| **windowWidth / windowHeight** | Integer | 可使用窗口宽度 / 高度 |
| statusBarHeight | Integer | 状态栏高度 |
| screenDensity | Float | 屏幕密度 |
| vendorOsName / vendorOsVersion | String | 系统名称（如 BlueOS）/ 蓝河应用版本号 |
| cutout | Array | 异形屏区域（left/top/right/bottom，以竖屏为基准） |
| **deviceType** | String | 当前蓝河应用引擎的设备类型，**手表版为 'watch'** |
| screenRefreshRate | Float | 屏幕刷新率（可能非 60/90/144 标准值） |

- `device.getInfoSync()` 无参数，返回 deviceInfo 对象（L8050、L8069-8077）；`device.getApiLevel / getApiLevelSync / getRegion…` 见 L8082 起。

### 10.8 日志 console（L7878-7940）

- 接口声明：无需声明（L7897）；导入：无需导入（L7904）。
- `console.debug/log/info/warn/error(message)`；message 为 String，支持浏览器式格式化文本；**只支持普通打印**，不支持样式（L7912-7927）。

---

## 11. 性能优化要点（第 L21740-23840 章）

推荐级别定义：强烈（必须遵守）/ 建议（优先最佳实践）/ 鼓励（可选）（L21768-21774）。章节索引 L21784-21794。

### 11.1 避免高耗操作（L21798-21935）

- 避免后代选择器：页面/组件天然样式隔离，嵌套选择器触发冗余样式计算；直接使用类名（L21816-21839）。
- 精简日志：高频/冗余日志增加内存开销；避免全量序列化复杂对象（反例 `JSON.stringify(sportInfo)`）（L21849-21878）。
- 避免后台渲染指令堆积（L21882 起）。

### 11.2 响应式数据（L21936-22232）

- 消除冗余响应式数据：未使用的响应式数据仍会触发依赖收集；用普通变量/模块级常量声明非响应式数据（L21954-22003）。
- 静态属性访问规范（L22106 起）；数据结构层级优化（L22171 起）。

### 11.3 帧率（L22233-22269）

- 避免冗余背景声明（L22245）；**给 div 组件设置宽高**（L22253）；**使用图片的原始尺寸**（L22261）。

### 11.4 减少初始化开销（L22270-22416）

- 避免引入耗时自执行模块（L22282）；优化 app.ux 数据管理（L22318）；长页面分段加载（L22346）。

### 11.5 长列表（L22417-22595）

- **分离固定标题与列表容器**：固定标题不要放进 list，改为外层 div + 绝对定位（L22429-22470）。
- 避免模板内表达式，改用数据预处理（L22475-22478）。
- 规避列表循环中的自定义组件（L22515）；保持列表数据独立性（L22525）；分段懒加载（L22563）；关注 onInit 执行时间（L22586）。

### 11.6 内存泄漏（L22596-22683）

- 排查方法：两次 dump（进页面前、退出后），BlueOS Studio `Devtool->Snapshot->Profile`（L22604、L22624）。
- 常见泄漏：event 订阅了但未取消（L22634-22647）。

### 11.7 运行时性能（L22684-23095）

- 避免 CSS 中使用 ID 选择器（L22696）；避免循环指令与条件指令叠加（L22757）；合理选择条件指令（L22802）；组件层级精简（L22897）；组件抽象平衡（L22946）；页面职责单一（L22988）；指定列表渲染标识（`tid`）（L23055）。

### 11.8 图片资源（L23096-23179）

- 图片物理尺寸必须与目标显示区域像素尺寸严格匹配，禁止超分辨率图片（L23114）。
- 优先 8 位色深（256 色）PNG（L23124）。
- svg 只在有动画或动态修改属性等特殊场景使用，一般用 png（L23140）。
- 删除冗余图片（L23166）；建立资源复用体系（L23176）。

### 11.9 退出页面释放监听（L23180-23308）

- **定时器**：所有 setTimeout/setInterval 必须在页面销毁时 clearTimeout/clearInterval 匹配清除（强烈）（L23198）。反例：没记录引用、onDestroy 未清理（L23204-23217）；正例：模块级变量存 id，onDestroy 精确清除（L23224-23245）。
- **事件监听器注销**：强烈级（L23249 起）。

### 11.10 减少代码体积（L23309-23839）

- JS 封装支持 Treeshaking（L23321）；按需引入（L23428）；避免 CommonJS 规范（L23474）；使用常量优化（L23507）；谨慎引入第三方包（L23544）；慎用 `@import` 样式（L23585）；页面模板拆分策略（L23636）；Manifest 配置精简（L23692）；国际化资源优化（L23702）；箭头函数优先（L23712）；对象属性命名优化（L23742）；环境区分策略（L23774）；CSS 代码复用（L23784）。

---

## 12. 文档明确缺失/无法确认的项（移植时不要假设）

以下均经全文检索 + 相关章节通读确认，**文档中不存在**或**无法确认**：

1. **`scrollview` 组件**：容器组件只有 div、list、list-item、stack、swiper、scroll（L30012-30019），全文无 scrollview/scroll-view（检索无匹配）。
2. **`onswipe` 事件**：通用事件只有 touchstart/touchmove/touchend/touchcancel/click/longpress（L32785-32792）；swipe 只作为 swiper 的 `enableswipe` 属性出现（L30271）。
3. **圆屏安全区 / safeArea**：无任何圆屏安全区 API 或样式说明；只有 `$device.deviceType` 与 `device: watch-round` 媒体查询（L20787、L21356）。
4. **466×466 / 432×514 具体机型适配**：无。文档只有 designWidth=466 的换算示例（L2567）与 402x402 的资源命名示例（L2714-2718）。
5. **`/common` 应用资源目录的正式定义**：没有目录说明章节；仅在 resources 示例与 image 示例中出现 `/common/pad/logo.png`（L2751）、`/common/asserts/heart78.png`（L28207）。
6. **`file.readText` 读取应用内资源路径**：未明确。`readText` 只写「本地文件路径」（L3971）；`file.access`/`file.get`/`file.list` 的说明同时出现「不能是应用资源路径」与「支持应用资源路径」两句互相矛盾的话（L3697、L3763、L4088）。
7. **prompt 除 showToast 外的接口**（如 showDialog）：模块只有 showToast（L11685-11740）。
8. **window / display 窗口 API**：没有 window API 模块；常亮只有 `brightness.setKeepScreenOn`（L7376）；manifest `display` 只有 backgroundColor（L20546）。
9. **IDE/构建期定时器配对 lint 规则**：没有。只有性能规范要求定时器配对清理（L23198），属「强烈」推荐而非编译校验。
10. **data 字段 public/protected/private 限制**：没有。只有「属性名不能以 $ 或 _ 开头、不能用 for/if/show/tid 保留字」（L20712、L20745）。
11. **生命周期完整调用顺序**：无顺序表；唯一明确顺序是 onRefresh 在 onShow 之前（L2289）。
12. **onKey 其余 keyCode 含义**：只定义 0=下键(电源键)、1=上键（L2329）。
13. **router 的 feature 声明**：「无需声明」（L12195）与 `$page.setStopGestureQuit` 依赖 `blueos.app.router`（L20867）并存；import 路径在 API 页为 `@blueos.app.appmanager.router`（L12203）、指南页为 `@blueos.app.router`（L26450，另 L21373、L26507）。
14. **blueos-pack / CLI 打包命令 / 模拟器命令行**：无。只有 BlueOS Studio 图形化打包（L21722-21729）与 IDE 调试面板（L21540-21546）。
15. **编译错误/警告清单**：无。仅提到 jsconfig.json 用于语法校验（L20051）。
16. **designWidth 默认值**：未直接给默认值。样式章节称「基准宽度（默认 750px）」（L20885），manifest 章节称「建议使用 466」（L20453）。
17. **watch-round 圆屏专属组件**：无。`arc-text` 是弧形文本组件（L28696），但文档未说明它与圆屏安全区的关系。

---

## 13. 关键章节行号索引（回查用）

| 主题 | 行号 |
|---|---|
| 应用沙箱目录 | L2020-2120 |
| 生命周期（应用/页面/组件） | L2124-2462 |
| 页面启动模式 launch-mode | L2465-2536 |
| 屏幕适配 mulit | L2539-2805 |
| 后台运行 resident | L2807-2888 |
| 表盘 watchface（含 manifest/ux） | L2892-3147 |
| 文件存储 file | L3555-4237 |
| K-V 存储 localstorage | L4238-4603 |
| 系统能力 am/app | L4952-5075 |
| 屏幕亮度 brightness | L7155-7509 |
| 日志 console | L7878-7940 |
| 设备信息 device | L7944-8689 |
| 弹窗 prompt | L11685-11740 |
| 页面路由 router | L12183-12515 |
| 屏幕管理 screen | L12672-12766 |
| 编译环境变量 build-env | L19250-19292 |
| 应用配置 file-organization | L20020-20258 |
| manifest 文件 | L20311-20645 |
| javascript 代码 script | L20648-20868 |
| style 样式 | L20871-21357 |
| UX 文件 | L21360-21428 |
| 快速开始 | L21431-21737 |
| 性能优化 | L21740-23839 |
| 框架能力：数据绑定/事件/for/if-show | L25261-25687 |
| 页面布局 page-style-and-layout | L25689-25915 |
| 自定义组件/组件通信/props | L25918-26353 |
| 页面路由 switching-pages | L26354-26586 |
| 组件-容器（div/list/scroll/stack/swiper） | L29830-30342 |
| 组件-表单（input/slider/switch/picker 等） | L31674-32416 |
| 组件-基础（a/image/text/marquee/progress 等） | L27699-29828 |
| 组件-系统风格 vw-* | L30604-31673 |
| 动画样式/transform/keyframes | L32419-32616 |
| 颜色样式 | L32618-32647 |
| 通用属性 | L32650-32726 |
| 通用事件 | L32729-32898 |
| 通用方法 getBoundingClientRect | L32902-32997 |
| 通用样式 | L33001-33348 |
| 组件动画 Element.animate() | L33351-33622 |
| 自定义字体 font-face | L33624-33746 |
| 渐变样式 | L33747-33840 |
| 表冠旋转 ui-rotation | L33870-34019 |

---

*本文档只抽取 `BlueOS开发文档.md` 的事实，未引入任何文档外 API。所有条目可用所注行号直接回查原文。*
