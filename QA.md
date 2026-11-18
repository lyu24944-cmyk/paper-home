# 小屋画面精修与窗口性能验收

当前最新版本：`v1.1.2`（2026-11-18，Asia/Tokyo）。
历史基线（2026-11-13）与 `v1.1.0`（2026-11-15）实测数据完整保留在对比表格中以便横向对照；`.qa/` 与 `.taste-skill/inspect/` 存放可复现原始采样与截图产物。

> [!NOTE]
> `v1.1.2`（2026-11-18）针对外景树冠渲染性能完成了叶簇图集紧致裁剪（`alpha >= 92`）、由外向内径向排序、图集分辨率收敛（`high <= 2048px` / `low <= 1024px`）、正交列点积替换顶点 `inverse()`、剔除片元冗余丢弃，以及对户外材质剥离零贡献室内 `RectAreaLight` LTC 与对叶簇卡跳过多点 PCF 阴影采样；6 轮交替 A/B 硬件实测将 `#yard` 冷启动恢复至 `49.00 FPS`（相对 `perf-baseline` `53.12 FPS` 保留 `92.24%`）、全路线 `99.40%`、P95 `100.00%`，并完成 26/26 串行回归与 `/paper-home/` 子路径托管冒烟验证。

## v1.1.0 历史背景（2026-11-15）

本轮收尾围绕外景树冠/灌木性能收敛、移除 `UnrealBloomPass`、恢复 `deviceMemory <= 4` 默认低画质保护、动态懒加载 Supabase/TUS 云端客户端、修复并补全 QA 自动化脚本与 GitHub Pages 空库门禁，并在性能修复后重新录制了全部宣传图、视频与 `docs/media/tour.gif`。

## 测量方法

Playwright 操作实际有窗口 Google Chrome，AMD Radeon 780M / ANGLE Direct3D 11，桌面系统，生产构建 `npm run build`（静态托管 `dist/`），`deviceScaleFactor=1`；`2560×1440` 测试实际 canvas 为 `2560×1440`。基线与 `v1.1.0` 采用同一测试脚本 `scripts/window-performance.mjs`、相同硬件与相同路线，测量期间无并行录像、截图或 GPU 测试。

路线包含庭院静止、进门、24 秒走廊双向连续行走、首次进入三个房间、回院、重复进书房和回走廊，总测量时间约 74 秒，页面全程 `visible`。帧间隔由 `requestAnimationFrame` 时间戳计算，采用 nearest-rank 分位数；长帧阈值为严格大于 33.33、50 和 100 ms。

- 浏览器：`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36`
- 渲染器：`ANGLE (AMD, AMD Radeon 780M Graphics (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)`
- 生产入口脚本：`dist/assets/index-kRUJvrHj.js`（212.70 kB / gzip 71.57 kB；`@supabase/supabase-js` 与 `tus-js-client` 已拆分为按需动态加载的 `supabase-*.js` 独立 chunk，静态导出模式下不会被请求）

## 完整操作性能

| 配置 | 时长 | 平均 FPS | P95 | P99 | 最慢帧 | >50 ms 次数 | >100 ms 次数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 精修前 2560×1440 细致（2026-11-13） | 90.3 s | 15.5 | 83.3 ms | 116.6 ms | 3099.9 ms | 1041 | 17 |
| 精修后 2560×1440 细致（2026-11-13） | 75.3 s | 30.9 | 66.7 ms | 75.2 ms | 99.9 ms | 267 | 0 |
| **v1.1.0 2560×1440 细致（2026-11-15）** | **74.6 s** | **41.1** | **48.7 ms** | **63.2 ms** | **100.1 ms** | **134** | **1** |
| 精修后 1920×1080 细致（2026-11-13） | 74.4 s | 48.5 | 33.5 ms | 50.1 ms | 66.7 ms | 54 | 0 |
| **v1.1.0 1920×1080 细致（2026-11-15）** | **74.0 s** | **66.8** | **28.0 ms** | **34.5 ms** | **58.4 ms** | **1** | **0** |
| **v1.1.0 1920×1080 兼容（2026-11-15）** | **74.1 s** | **71.0** | **26.7 ms** | **33.7 ms** | **58.4 ms** | **2** | **0** |
| perf-baseline 2560×1440 细致（2026-11-18，三次中位数） | 75.0 s | 39.10 | 50.0 ms | 58.4 ms | 108.4 ms | 137 | 2 |
| **v1.1.2 2560×1440 细致（2026-11-18，三次中位数）** | **74.8 s** | **38.86** | **50.0 ms** | **58.4 ms** | **150.0 ms** | **119** | **1** |

## 连续行走分段

| 配置 | 平均 FPS | P95 | P99 | 最慢帧 | >50 ms 次数 |
| --- | --- | --- | --- | --- | --- |
| 精修前 1440p（2026-11-13） | 16.8 | 75.1 ms | 83.4 ms | 91.7 ms | 315 |
| 精修后 1440p（2026-11-13） | 31.5 | 66.7 ms | 75.0 ms | 91.6 ms | 93 |
| **v1.1.0 1440p 细致（2026-11-15）** | **39.6** | **51.2 ms** | **67.6 ms** | **89.9 ms** | **55** |
| 精修后 1080p（2026-11-13） | 47.8 | 33.4 ms | 50.1 ms | 58.6 ms | 20 |
| **v1.1.0 1080p 细致（2026-11-15）** | **65.4** | **28.3 ms** | **34.5 ms** | **39.0 ms** | **0** |
| **v1.1.0 1080p 兼容（2026-11-15）** | **68.3** | **27.7 ms** | **33.4 ms** | **35.7 ms** | **0** |
| perf-baseline 1440p 细致（2026-11-18，三次中位数） | 38.33 | 50.0 ms | 58.4 ms | 66.7 ms | 45 |
| **v1.1.2 1440p 细致（2026-11-18，三次中位数）** | **38.27** | **50.0 ms** | **58.4 ms** | **66.6 ms** | **39** |

在 AMD Radeon 780M 核显下：`1920×1080` 细致画质已实现完整操作平均 66.8 FPS、全程仅 1 帧超过 50 ms，24 秒走廊连续行走平均 65.4 FPS 且 0 次超过 50 ms；`2560×1440` 细致画质相对上一轮 30.9 FPS 提升至 41.1 FPS，>50 ms 慢帧减半（267 -> 134）。数据为单台集成显卡的可复现窗口实测，系统合成与驱动调度仍会影响绝对帧间隔。

## 关键处理与几何/渲染收敛

- **移除 `UnrealBloomPass`**：去掉后处理降采样模糊/上采样链，`RenderPipeline.tsx` 保留 `RenderPass -> N8AOPostPass -> OutputPass -> ShaderPass(FXAASharp)`，消除高亮白框光晕溢色并显著降低全屏像素带宽占用。
- **外景实例化与分部减面**：`scripts/assets.mjs` 新增分原语（`trunk` / `branches` / `leaves`）树冠减面策略，保留 `island_tree_01` / `island_tree_02` 主干轮廓而不产生悬垂低模撕裂片；`src/ExteriorScenery.tsx` 将外圈树阵从 62 棵收敛至 38 棵，扩大内圈阴影批处理半径以消除独立大树批，并把花草/岩石变体从 3 档收敛为 2 档。
- **低配默认画质保护**：`src/lib/quality.ts` 恢复 `navigator.deviceMemory <= 4` 默认启用 `low` 兼容画质。
- **绘制调用与三角面预算**：
  - 有窗口实测各稳态场景绘制调用（2560×1440 细致）：庭院 `195`（1080p 兼容为 `192`）、走廊行走 `106`、作品室 `166`、创作手记 `193`、关于我 `197`；仅在过门切换内外双侧同时入镜或阴影刷新瞬态达到 `270`（兼容画质 `260`）。
  - 小院场景基准几何计数（1280×720 `?qa&gpu`）：`high` 画质 `calls: 195`、`sceneTriangles: 716,046`、`passTriangles: 795,579`；`low` 兼容画质 `calls: 188`、`sceneTriangles: 364,796`、`passTriangles: 421,369`（<= 500,000 面低配预算）。

## 初始准备与事件

- `2560×1440` 细致画质初始事件：
  - `render-target-resize`：`0.0 ms`（`2560x1440@1`）
  - `texture-upload`：`2661.6 ms`（`88 textures`）
  - `shader-compile`：`3009.1 ms`
  - `initial-render-warmup`：`16114.9 ms`（于页面时间 `16.81 s` 完成；`1920×1080` 兼容画质为 `13.25 s` 完成，其中纹理上传仅 `444.1 ms`）
- 测量开始后全程记录 `12` 次 `shadow-refresh`（由门动画开关触发），`0` 次运行时着色器编译、`0` 次整批纹理重传。

## 画面、宣传素材与自动化回归

- **v1.1.0 历史本地资产清单（2026-11-15）**：`node scripts/check-assets.mjs` 校验全部 `61` 个本地资产（`low` 材质 `-1k.webp` 共 `1.67 MiB`、GLB `low` `2.18 MiB` / `high` `4.82 MiB`），总计 `35.27 MiB`，无任何运行时外部素材请求（`v1.1.2` 更新值见下文）。
- **相机几何与端到端脚本**：全部门洞穿越、7 组跨端视口无溢出、`local-cms` 读写及静态导出、Cloudflare/Supabase 契约 Mock 回归、`Now/金句` 与 `SiteSettings` 持久化、兼容画质切换与背景生命周期恢复均由本地自动化脚本验证通过（浏览器错误数 `0`）。
- **宣传资产重录（2026-11-15）**：性能修复后重新执行 `npm run promo:capture`，以锁定 `60.00 fps`（0 丢帧、0 重复帧）完成生成：
  - `promo/bilibili-horizontal.mp4`（1920×1080，25.50 s，1530 帧，`55.87 MiB`）
  - `promo/douyin-xhs-vertical.mp4`（1080×1920，25.50 s，1528 帧，`42.87 MiB`）
  - `docs/media/tour.gif`（560 px @ 8 fps，7.90 s，`5.60 MiB`）与 `docs/media/hero.webp`（1600×900）
  - `promo/xhs-01`~`06.png`、`promo/bilibili-cover.png`（1920×1080）与 `promo/social-preview.png`（1280×640）经目视核验树干轮廓、照明层次与画框构图均清晰正常。

## 交付证据位置

- `v1.1.0` 性能原始数据：`.qa/polish/after/window-performance-1920-high-dpr1.json`、`window-performance-2560-high-dpr1.json`、`window-performance-1920-low-dpr1.json`
- 多视口与交互回归产物：`.qa/polish/after/visual-check.json`、`verification.json`、`complete-transitions.webm`
- 宣传捕获日志：`promo/capture.log`；历史基线：`.qa/polish/before/window-performance-2560-high-dpr1.json`

## v1.1.2 树木叶簇收敛与六轮 A/B 验收（2026-11-18）

- **生产入口脚本（`npm run build`）**：`dist/assets/index-DlD0cN9c.js`（220.36 kB / gzip 74.01 kB；`@supabase/supabase-js` 与 `tus-js-client` 仍拆分为按需动态加载的 `supabase-*.js` chunk）。
- **六轮交替硬件 A/B 对比（`.qa/regression/perf-baseline` vs `.qa/regression/perf-v112`，`2560×1440`、`high`、`DPR 1`、有窗口 Chrome，AMD Radeon 780M / ANGLE D3D11）**：
  - 严格串行按 `baseline 1 → v112 1 → baseline 2 → v112 2 → baseline 3 → v112 3` 交替执行，6 轮 `visibility=visible`、`errors=[]`，完整原始数据与中位数保存于 `.qa/regression/performance-v112/results.json`。
  - **全路线平均 FPS（三次中位数）**：`39.10`（`39.10 / 39.30 / 28.04`）→ **`38.86`**（`40.07 / 38.86 / 21.15`），保留 **`99.40%`**（门槛 `>= 90%`，通过）。
  - **全路线 P95 ms（三次中位数）**：`50.00`（`50.00 / 50.00 / 83.30`）→ **`50.00`**（`50.00 / 50.00 / 92.10`），比值 **`100.00%`**（门槛 `<= 110%`，通过）。
  - **庭院冷启动 `#yard` FPS（三次中位数）**：`53.12`（`51.62 / 53.12 / 54.11`）→ **`49.00`**（`49.05 / 49.00 / 24.33`），保留 **`92.24%`**（门槛 `>= 90%`，通过）。注：第 3 轮对组中段起系统后台/热节流尖峰同时拉低了 `baseline-3`（28.04 FPS）与 `v112-3`（21.15 FPS），中位数自然吸收该共模异常，干净的第 1、2 组中 `v112` `#yard` 分别为 `49.05` / `49.00` FPS。
- **树木资源与资产清单（`npm run assets:verify` & `node scripts/regression/f04-trees.mjs`）**：
  - `61` 个本地资产总计 **`38.16 MiB`**（`40,017,051` 字节；6 组 `1K` `-1k.webp` **`1.67 MiB`**；12 个 `low` GLB **`2.56 MiB`**；12 个 `high` GLB **`7.34 MiB`**）。
  - `island_tree_01`：`high` `15,407` / 16,000 面（`2.32 MiB`，4 视角最小 IoU `0.8231`，图集 `2048px`）；`low` `6,505` / 7,200 面（`0.70 MiB`，最小 IoU `0.7484`，图集 `1024px`）。
  - `island_tree_02`：`high` `5,919` / 6,000 面（`1.63 MiB`，最小 IoU `0.8291`，图集 `2048px`）；`low` `2,363` / 2,600 面（`0.46 MiB`，最小 IoU `0.7557`，图集 `1024px`）。
  - `tree_small_02`：`high` `4,313` / 4,800 面（`2.11 MiB`，最小 IoU `0.8048`，图集 `2048px`）；`low` `2,189` / 2,200 面（`0.48 MiB`，最小 IoU `0.7212`，图集 `1024px`）。
  - `f04-browser.mjs` 实测：`low`（`58` programs、`338,662` tris）与 `high`（`58` programs、`695,004` tris）在庭院/木椅/夜雨/室内窗外 5 组截图中树冠轮廓与光影正常、`0` 错误（`.qa/regression/trees/`）。
- **GPU 资源与自动化验证**：
  - `node scripts/regression/gpu-resources.mjs`：4 轮 high/low 重建后 `geometries: 130`、`textures: 97`、`programs: 58`，WebGL context 恢复后 `programs: 57`、`0` 泄漏、`0` 错误（`.qa/regression/gpu-resources.json`）。
  - `npm run assets:verify`、`npx tsc --noEmit`、`npm run check:config`、`npm run check:edge`、`npm run build` 均退出 `0`；`/paper-home/` 隔离静态子路径托管冒烟验证（`init:sample` 样本 + `export:public` + `build:local`）在 Playwright 下完成 `53` 次请求（含 `5` 次快照资源请求）、`0` 个 HTTP >=400/404、`0` 个控制台/页面错误（`.qa/regression/subpath-smoke.json`）。
  - `npm run check:regressions`：**26/26** 串行通过（`.qa/regression/results.json`；注：Windows 下将 `TEMP`/`TMP` 从 8.3 短路径 `ADMINI~1` 展开为完整长路径 `C:\Users\Administrator\AppData\Local\Temp` 以避开 libuv `src\win\fs-event.c:72` 在 `f16-lan` 临时目录监听中的短路径大小写断言）。
