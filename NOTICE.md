# 素材版权说明 / Assets Notice

本仓库的 **MIT 协议只覆盖代码**。以下内容**不属于** MIT 协议的授权范围。

> 这句话**故意不写进 LICENSE 里**：GitHub 识别协议是把 LICENSE 跟官方模板做相似度匹配，
> 在 MIT 正文后面追加任何内容都会拉低相似度、导致仓库页面上显示不出 MIT 标识。
> 所以 LICENSE 里只有纯 MIT 文本，范围说明放在这里。

## 不在 MIT 范围内的内容

| 路径 | 内容 | 版权 |
|---|---|---|
| `src/common/story/` | 剧本文字（5,457 句台词） | 原作 GalGod 及其开发方 |
| `src/common/img/b/` | 背景 38 张 | 同上 |
| `src/common/img/s/` | 立绘 55 张 | 同上 |
| `src/common/img/c/` | CG / SDCG 34 张 | 同上 |
| `src/common/img/t/` | CG 鉴赏缩略图 9 张 | 同上（由上面裁切而来） |
| `src/common/home.png` | 标题画 | 同上 |
| `src/common/icon.png` | 应用图标 | 同上 |

这些都是从 PC 版 **GalGod 1.0.0** 解包并转码而来的衍生文件，版权归原作
**GalGod** 及其开发方「**诺提拉观察所**」所有。

收录它们**只是为了让仓库能直接构建出可运行的包**——代码本身不依赖任何具体素材，
换一套剧本和图片照样能跑。

## 使用限制

- 请勿用于任何商业用途。
- 本项目为非官方、非商业性的个人移植作品，与 **AstroBox**、**小米（Xiaomi）**
  均无关联，亦未获得其授权、赞助或认可。
- 如版权方有异议，删除上表中列出的目录与文件即可；
  此时仓库仍可通过 `tools/gen_story.py` / `tools/gen_assets.py`
  从你自己的原始素材重新生成。
- 如有侵权，请联系删除。

## 在 MIT 范围内的内容

`src/pages/`、`src/common/reader.js`、`src/common/assets.js`（生成物但属代码）、
`src/common/cglist.js`（生成物但属代码）、`src/app.ux`、`src/manifest.json`、
`tools/`、以及所有文档。详见 [LICENSE](LICENSE)。

---

## 本移植（vivo BlueOS）说明

- 本目录是上述 Vela 工程的 vivo 蓝河（BlueOS）手表移植版，代码部分同样以 MIT 协议开源。
- 图像资源按 466 设计宽重新裁切/调色板压缩（见 tools/gen_assets.py），剧本由 tools/import_story.mjs 从源工程转存为 .json，内容未作删减。
- 移植作者：本工程由个人学习/技术研究用途维护，非官方版本，与 vivo、小米均无隶属关系。

