# 本地素材与来源

当前主场景的写实材质、植物和日光环境来自 Poly Haven，许可为 [CC0](https://polyhaven.com/license)。资源在准备／构建阶段下载和处理，运行时不请求 Poly Haven 或其他外站。

| 用途 | 资源与来源 | 作者 | 许可 | 交付分辨率／模型档位 |
| --- | --- | --- | --- | --- |
| brick | [red_brick_03](https://polyhaven.com/a/red_brick_03) | Rob Tuytel | CC0-1.0 | 4k / 1 米每幅 |
| roof | [roof_tiles_14](https://polyhaven.com/a/roof_tiles_14) | Rob Tuytel | CC0-1.0 | 2k / 1.5 米每幅 |
| plaster | [plastered_wall_02](https://polyhaven.com/a/plastered_wall_02) | Charlotte Baglioni | CC0-1.0 | 2k / 2.23 米每幅 |
| wood | [wood_floor](https://polyhaven.com/a/wood_floor) | Dimitrios Savva | CC0-1.0 | 4k / 1.7 米每幅 |
| stone | [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) | Rob Tuytel | CC0-1.0 | 2k / 2 米每幅 |
| grass | [grass_ground](https://polyhaven.com/a/grass_ground) | Charlotte Baglioni | CC0-1.0 | 2k / 2.51 米每幅 |
| island_tree_01 | [island_tree_01](https://polyhaven.com/a/island_tree_01) | Rob Tuytel、Rico Cilliers | CC0-1.0 | high: 123,752 面；low: 36,545 面 |
| potted_plant_02 | [potted_plant_02](https://polyhaven.com/a/potted_plant_02) | Rico Cilliers | CC0-1.0 | high: 21,992 面；low: 6,992 面 |
| kloofendal_48d_partly_cloudy_puresky | [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal、Jarod Guest | CC0-1.0 | 1K HDR |

原始下载文件的 URL、作者、MD5，以及最终托管文件的 SHA-256、字节数，都记录在 [manifest.json](public/assets/realistic/manifest.json)。当前共 41 个文件，合计 37.28 MiB（含 6 组表面材质各 1 份 `1024×1024` 轻量版 `*-1k.webp`，共 1.67 MiB）；浏览器按当前画质选择贴图分辨率与模型档位（手机及微信等内置浏览器默认加载兼容画质）。

模型通过 glTF Transform 完成焊接、减面、去重、清理、WebP 纹理编码和 Meshopt 压缩。原始树 1,599,403 面，未进入运行时。所有重建代码见 `scripts/assets.mjs` 与 `scripts/assets-1k.mjs`；下载缓存保留在 `.qa/realistic/raw`，未经处理的模型不位于 `public`。

住宅外壳、构件、家具、草簇与纹理 UV 由本项目几何代码生成。作品纸的轻微弯曲由网格顶点表达。门牌与欢迎牌使用本地 Canvas 高分辨率文字图集。

三幅演示插画由项目既有 src/sketch.ts 生成；文章为既有示例。HomeHand 为既有 LXGW WenKai TC 字体子集，作者 LXGW，使用 public/fonts/OFL.txt 所附许可。

旧 public/assets/garden-tree.png 为上一轮 imagegen 生成图片，当前 World.tsx 不引用；其提示词及生成记录见 .qa/visual-update/ASSETS.md。它保留用于旧版相同机位对照，不属于本轮 CC0 素材清单。

宣传视频背景音乐 `scripts/assets/bgm-a-short-walk-with-you.ogg` 选用 Purrple Cat（`purrplecat.com`）创作的 *A Short Walk With You*（源自专辑 *Up All Night*，Wikimedia Commons 镜像 `File:Purrple_Cat_-_A_Short_Walk_With_You.ogg`），采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可协议，仅用于 `npm run promo:capture` 生成 `promo/` 宣传视频成片音轨，不进入应用构建包与运行时网络请求。
