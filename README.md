# 我的小屋 · 写实住宅与庭院

以完整住宅为入口的中文个人网站原型。当前版本按确定的写实方向重做：自然白昼、11×15 米单层住宅、完整坡屋顶与庭院、受光室内和可逆的镜头路线。文章与收藏仍是示例，交付为本地可操作预览。

当前生产预览：[打开小屋](http://127.0.0.1:4319/)。默认细致画质；右上角可切换兼容画质、减少动态模式和小屋地图。

本轮精修：开场分别计算住宅、庭院和树的范围；窗户改用清晰薄玻璃与环境反射，窗后陈设保持常驻；窗光朝向室内，木材、灰泥、纸张和金属使用不同粗糙度。门廊、窗框、书桌和展廊补充连接细节。竖屏展廊提供单幅聚焦与明确切换，展开画作后也可继续翻看。

## 运行

需要 Node.js 22.12+。

```powershell
npm install
npm run dev
```

开发地址为 http://127.0.0.1:4318/。本机原端口 4317 曾被系统拒绝绑定，因此开发端口调整为 4318。

```powershell
npm run build
npm run preview -- --port 4319
```

`build` 前会检查本地素材 SHA-256；如果缺少素材清单，会先下载并处理资源。完整重建素材使用 `npm run assets:prepare`；仅复核素材使用 `npm run assets:verify`。首次重建素材需要网络，运行时使用本地文件。

## 使用

- 在小院点击入口按钮或木门，沿石路进入走廊。
- 电脑滚轮、触控上滑或前进／后退按钮驱动行走；方向键、PageUp、PageDown 和空格也可操作。
- 走廊依次经过左侧收藏展廊、右侧书房和左侧空白房间。可点击三维门，或靠近后使用进入按钮。
- 地图支持直接跨房间导航；房间返回走廊会恢复原来的行走位置；点击左上角小屋名称可返回小院。
- 展廊作品可直接点击。书房文章、收藏目录、Escape 关闭、改名和环境声继续可用。
- 竖屏展廊使用上一幅／下一幅浏览原位作品；点击作品名称展开大图。大图内支持前后切换。
- 减少动态模式直接提交稳定终点；转场中调整窗口或进入后台也会落到确定的终点。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| `src/layout.ts` | 米制住宅布局、门位、CameraPose、TransitionState、完整路径与包围盒取景 |
| `src/Camera.tsx` | GSAP 姿态插值、逆向退镜、状态提交、后台恢复、DPR 策略 |
| `src/World.tsx` | 外壳、屋顶、门廊、门窗、庭院、植物及三个房间 |
| `src/Geometry.tsx` | 倒角与实体构件、物理尺寸 UV、按材质合并静态几何 |
| `src/RenderPipeline.tsx` | HDR 渲染、40% GTAO、FXAA、OutputPass、性能采样 |
| `src/diagnostics.ts` | 编译、纹理上传、阴影刷新和缓冲区尺寸变更记录 |
| `src/resources.ts` | 本地 PBR／glTF／HDR 加载与两档模型 |
| `src/App.tsx` | 页面交互、导航锁、加载与重试、地图、阅读、改名和声音 |
| `src/content.ts` | 示例文章、作品和兼容的 Place 标识 |
| `scripts/assets.mjs` | Poly Haven 下载、校验、减面、去重、WebP 与 Meshopt 压缩 |

## 验证与交付

实测方法、范围和限制见 [QA.md](QA.md)。素材来源、作者和许可见 [ASSETS.md](ASSETS.md)，完整文件哈希见 `public/assets/realistic/manifest.json`。

精修验收产物位于 `.qa/polish/after/`，前轮窗口基线位于 `.qa/polish/before/`。`npm run check:polish` 检查七种窗口和逐幅看画，包括 4:5 比例临界点；`npm run check:interactions` 检查完整路线和交互；`npm run check:edge-cases` 检查触控、DPR 和加载恢复。`npm run check:window-performance` 在有窗口 Chrome 中运行一分钟以上的操作路线，报告平均 FPS、P95/P99、最大帧间隔和长帧数量。使用 `QA_WIDTH`、`QA_HEIGHT`、`QA_DPR`、`QA_QUALITY` 环境变量更改配置；性能测试期间关闭截图、录像和其他图形测试。`node scripts/pass-profile.mjs` 使用可用的 WebGL GPU 计时扩展分通道诊断；检查完成后使用 `npm run qa:report` 重建本轮验收记录。

- `.qa/realistic/complete-transitions.webm`：完整操作与转场录像。
- `.qa/realistic/comparison-yard.png`、`comparison-hall.png`：相同相机位置、四元数和视场角的前后对照。
- `.qa/realistic/verification.json`：路线分段、状态、窗口与操作验证。
- `.qa/realistic/performance.json`：780M 硬件加速实测原始数据。
- `.qa/realistic/camera-check.json`：6 种窗口、120 组路线、75,144 个相机采样点检查。

没有增加可访问房间、后台、账号、上传、留言或公网部署。名字保存在当前浏览器；环境声由本地 Web Audio 合成。原单平面树木素材保留在旧版存档中，当前主场景不引用。
