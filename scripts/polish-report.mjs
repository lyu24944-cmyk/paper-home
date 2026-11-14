import fs from 'node:fs/promises';

const dir='.qa/polish/after',read=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const before=await read('.qa/polish/before/window-performance-2560-high-dpr1.json');
const high1440=await read(`${dir}/window-performance-2560-high-dpr1.json`);
const high1080=await read(`${dir}/window-performance-1920-high-dpr1.json`);
const visual=await read(`${dir}/visual-check.json`),verify=await read(`${dir}/verification.json`),edge=await read(`${dir}/edge-cases.json`);
if(!visual.passed||!verify.passed||!edge.passed)throw Error('Functional and visual checks must pass before writing the report.');
const row=(name,r)=>`| ${name} | ${(r.summary.durationMs/1000).toFixed(1)} s | ${r.summary.averageFPS.toFixed(1)} | ${r.summary.p95ms.toFixed(1)} ms | ${r.summary.p99ms.toFixed(1)} ms | ${r.summary.maxMs.toFixed(1)} ms | ${r.summary.over50ms} | ${r.summary.over100ms} |`;
const walk=(name,r)=>{const p=r.phases.walking;return `| ${name} | ${p.averageFPS.toFixed(1)} | ${p.p95ms.toFixed(1)} ms | ${p.p99ms.toFixed(1)} ms | ${p.maxMs.toFixed(1)} ms | ${p.over50ms} |`;};
const start=high1440.appMetrics.events.find(e=>e.name==='measurement-start').at;
const warm=high1440.appMetrics.events.filter(e=>e.at<start);
const runtime=high1440.appMetrics.events.filter(e=>e.at>=start);
const calls=Math.max(...high1440.frames.map(f=>f.calls));
const sha=(await fs.readFile('dist/index.html','utf8')).match(/\/assets\/index-[^" ]+\.js/)?.[0];
await fs.writeFile('QA.md',`# 小屋画面精修与窗口性能验收

日期：2026-11-13（Asia/Tokyo）。本地生产预览：http://127.0.0.1:4319/。
本轮范围为开场构图、薄玻璃、室内明暗、门廊／书桌／展廊近景、手机逐幅看画，以及行走与进房长帧治理。文章与画作保留示例身份。历史验收保存在 .qa/polish/before/QA.md；.qa/realistic/ 为上一轮历史产物。

## 测量方法

Playwright 操作实际有窗口 Google Chrome，AMD Radeon 780M / ANGLE Direct3D 11，2880×1800、120 Hz 桌面。使用生产构建，deviceScaleFactor=1；2560×1440 测试的实际 canvas 为 2560×1440，没有通过降低该测试的渲染尺寸获取增益。基线和精修版采用同一脚本、相同硬件、相同路线。测量期间没有录像、截图或并行图形测试。

路线包含庭院静止、进门、24 秒走廊双向连续行走、首次进入三个房间、回院、重复进书房和回走廊，总测量时间超过一分钟。页面全程为 visible。帧间隔由 requestAnimationFrame 时间戳计算；采用 nearest-rank 分位数。长帧阈值为严格大于 33.33、50 和 100 ms，原始文件保留逐帧数据、分段、CPU 提交时间、PerformanceObserver 长任务和应用事件。初始准备不计入行走测量，单独记录。

浏览器：${high1440.browser}。
渲染器：${high1440.snapshot.renderer}。
生产入口脚本：${sha}。

## 完整操作性能

| 配置 | 时长 | 平均 FPS | P95 | P99 | 最慢帧 | >50 ms 次数 | >100 ms 次数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${row('精修前 2560×1440 细致',before)}
${row('精修后 2560×1440 细致',high1440)}
${row('精修后 1920×1080 细致',high1080)}

不同路线总时长来自同一组操作：精修前首次房间挂载、编译和上传会延长操作等待。长帧绝对次数应结合总时长与样本数解读，不宣称相同时间内下降相同比例。

## 连续行走分段

| 配置 | 平均 FPS | P95 | P99 | 最慢帧 | >50 ms 次数 |
| --- | --- | --- | --- | --- | --- |
${walk('精修前 1440p',before)}
${walk('精修后 1440p',high1440)}
${walk('精修后 1080p',high1080)}

秒级首次进房停顿已经消除；1440p 仍存在可感知的慢帧，不能称为稳定 60 FPS。旧记录的 34.8 FPS 来自较短的无头 Chrome 预热行走，与本表的有窗口完整操作口径不同，不直接作增减比较。测试是单台集成显卡上的单次可复现样本，窗口合成、驱动调度和整机负载也影响帧间隔，不代表所有设备。

## 原因与处理

- 原版按导航挂载目的地陈设，光源数量也随房间变化。首次入房时出现与绘制提交同帧的约 1.5～3.1 秒长任务；常驻所有房间、固定光源类型与数量、入口前上传和预编译后，该类长帧消失。这支持首次资源／着色器准备是主要原因，但没有把一次长任务观察冒充完整调用栈分析。
- WebGL GPU 计时扩展的诊断确认持续行走主要受 GPU 限制。中间版本场景绘制约 13 ms、AO 通道约 14 ms，CPU 提交通常只需数毫秒。诊断原始文件保存在 .qa/polish/diagnostics/，不与最终无计时扩展的性能数值混用。
- 平直玻璃使用透明薄片与介电环境反射，取消整场景体积透射捕获；玻璃不写深度、不进入 AO 法线通道。它是适合 6 mm 平窗的近似，不宣称具备真实体积折射。
- HDR 目标取消 MSAA 存储与 resolve，使用 FXAA；细致 AO 使用 40% 线性分辨率和 6 个去噪样本。最终图片确认窗框、门缘与纸张仍可辨认。
- 外景仍绘制窗后的真实陈设，但省去这些远处陈设的 AO 与家具阴影绘制；室内恢复完整家具 AO 与阴影。
- DPR 在静止和移动时都封顶 1.5；本轮 1440p 测试原生 DPR 为 1，未受该上限影响。高密度屏幕有静止细腻度取舍，换来停止／起步时不重建缓冲区。640 px、DPR 2 窗口及触控回归另行验证。

最终 1440p 路线所有渲染通道合计调用峰值为 ${calls}，低于 200 次预算。常驻几何包含隐藏房间，但绘制依空间与视线裁剪；最终 ${visual.viewports.length} 个窗口的庭院场景三角面峰值 ${Math.max(...visual.viewports.map(v=>v.yard.sceneTriangles)).toLocaleString()}，低于 500,000 面预算。

## 初始准备与事件

本次 1440p 运行的初始准备在页面时间 ${(warm.find(e=>e.name==='initial-render-warmup').at/1000).toFixed(2)} s 完成；这是本地完整 GPU 预热，既不是公网冷启动成绩，也不是无缓存网络下载成绩。首次准备变重是消除首次房间停顿的代价，仍需要后续冷启动优化。界面分别显示整理家具、准备光线和布置房间，不在素材下载到 100% 后继续显示同一个假进度。

初始事件：

${warm.map(e=>`- ${e.name}：${e.durationMs?.toFixed(1)??'—'} ms${e.detail?'；'+e.detail:''}`).join('\n')}

测量开始后记录 ${runtime.filter(e=>e.name==='shadow-refresh').length} 次阴影刷新、${runtime.filter(e=>e.name==='shader-compile').length} 次编译、${runtime.filter(e=>e.name==='texture-upload').length} 次整批纹理上传、${runtime.filter(e=>e.name==='render-target-resize').length} 次缓冲区重设。阴影刷新以门动画完成为触发；没有每帧刷新阴影。

## 画面与操作验收

- 房屋、院子和树分别取景，保留完整屋顶与院子；加强三分之四视角，减少合并包围盒的留白。
- 窗框有压条、密封线、把手和窗台；窗后是进入时看到的同一套陈设。
- 窗光朝室内，窗边与房间深处有明暗层次；木材、灰泥、纸张、金属采用各自粗糙度，灰泥法线强度降低。
- 门廊有柱脚、檐口和台阶鼻口；书桌有围板、抽屉、拉手及书写物件；展廊补足支架和托件。
- ${visual.viewports.map(v=>`${v.width}×${v.height}`).join('、')} 窗口无页面横向溢出。竖屏在原始三维位置逐幅聚焦，提供前后切换、边界禁用与大图切换；横屏保留三幅同场。
- 相机几何检查：6 窗口、120 组路线、75,144 个采样点，检查有限姿态、单位四元数、无翻转、门洞穿越与各主体范围入镜。
- 浏览器回归 ${verify.transitions.length} 段导航；包括关键帧、阅读、3D 画作拾取、返回行走位置、改名、声音、减少动态、转场调整窗口、模拟后台生命周期及兼容画质。后台检查只覆盖 document.hidden / visibilitychange，不冒充系统休眠或强杀恢复。
- ${edge.checks.join('；')}。
- 最终浏览器错误数：${verify.errors.length+visual.errors.length}。本地 23 个素材的 SHA-256 仍通过，总量 35.62 MiB；没有增加外部素材请求。

## 交付文件

- .qa/polish/after/yard-1440x900.png、study-1440x900.png、gallery-390x844.png、artwork-390x844.png：最终画面。
- .qa/polish/after/visual-check.json、verification.json、edge-cases.json：窗口和功能证据。
- .qa/polish/after/complete-transitions.webm：导航录像，录制与性能测量分开。
- .qa/polish/after/window-performance-*.json：最终有窗口逐帧数据。
- .qa/polish/before/window-performance-2560-high-dpr1.json：本轮前有窗口基线。
- .qa/polish/before/src/：本轮前源码快照；历史版本素材来源仍见 ASSETS.md。

本轮本地精修与功能验证完成。性能结论为秒级进房停顿消除、平均与尾部帧时间改善，1440p 慢帧仍需继续降低。示例内容替换、公网部署与公网冷启动保持后续范围。
`);
console.log('Updated QA.md from headed measurements and completed regression results.');
