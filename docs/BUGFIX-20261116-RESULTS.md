# F01—F21 实证验收报告

最后 F15 Vite 构建保护补修后，26/26 项串行回归、正常顶层构建、隔离本地顶层构建及干净副本三项定向验证均退出 0。早前完整干净 CI 17/17 通过，但早于该补修；最新代码没有重新执行完整 17 步链路。未执行生产迁移、真实云端内容同步、远端发布或 Git 提交。**庭院冷启动 FPS 仍仅为旧版 75.01%，不能宣称每阶段无性能回归。**

## 逐项修复

### F01 / P0 / 通过

- 位置：scripts/private-data-guard.mjs:42
- 根因：Vite 静态路由绕过 CMS 鉴权读取私有数据。
- 触发/复现：LAN 无 PIN 请求普通/编码/@fs/链接路径及自定义数据目录。
- 修复：静态服务前 canonical 路径拦截，追加默认 deny 规则，拒绝 public/输出内数据目录。
- 回归：`node scripts/regression/f01-security.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F02 / P0 / 通过

- 位置：supabase/migrations/202611160001_safe_media_cleanup.sql:102
- 根因：引用检查与文件删除、元数据确认分离，失败会误删或假报成功。
- 触发/复现：入队后保存引用、并发 worker、Storage 停机、数据库删除触发器失败、租约重领。
- 修复：SQL 写入协调锁、引用触发器、deleting 状态、token 领取/确认/失败重试；旧异常引用阻断清理。
- 回归：`node scripts/regression/f02-cleanup.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F03 / P0 / 通过

- 位置：src/components/LazyModalBoundary.tsx:5
- 根因：lazy import 拒绝会向根组件冒泡导致白屏。
- 触发/复现：分别阻断详情、编辑、明信片模块请求。
- 修复：各类懒弹窗独立边界，关闭释放锁并恢复焦点，显式重新加载入口。
- 回归：`node scripts/regression/f03-lazy.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F04 / P1 / 通过

- 位置：scripts/foliage-bake.mjs:5
- 根因：整组减面使大量叶片丢失，形成碎点。
- 触发/复现：四方向原始树冠遮罩、high/low 庭院/木椅/窗外/夜雨和三轮性能。
- 修复：离线叶簇卡片保留原树种/位置/木质枝干，严格面数预算，顶点阶段剔除未选视角。
- 回归：`node scripts/regression/f04-trees.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F05 / P1 / 通过

- 位置：src/App.tsx:738
- 根因：过渡忙时丢弃新 hash，旧房间又覆写 URL。
- 触发/复现：进入过渡时注入带天气、灯光、item/focus 的新深链。
- 修复：保留最新完整请求，以请求身份防止旧任务清空新请求，待过渡/内容就绪后执行。
- 回归：`node scripts/regression/f05-f07-routing.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F06 / P1 / 通过

- 位置：src/App.tsx:1705
- 根因：分享房间取自拍摄相机，关联跳转后与内容所属房间不同。
- 触发/复现：书房手记→作品→明信片，以及作品→手记；分别冷启动链接。
- 修复：分享种类由 gallery/study 目标区分，携带 item/标题/所属房间，拍摄地点独立。
- 回归：`node scripts/regression/f05-f07-routing.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F07 / P1 / 通过

- 位置：src/lib/deeplink.ts:104
- 根因：晴天被省略，接收者保存的雨天覆盖链接。
- 触发/复现：保存 rain 后打开新生成的 clear 分享。
- 修复：新链接明确序列化 clear/rain，保留旧链接的缺省语义。
- 回归：`node scripts/regression/f05-f07-routing.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F08 / P1 / 通过

- 位置：src/components/MediaPickers.tsx:35
- 根因：常驻编辑器接收旧异步上传/保存结果，污染新会话。
- 触发/复现：保留真实上传响应，关闭编辑器、新建表单后再释放旧响应。
- 修复：编辑器按会话卸载、记录 key 隔离；异步 alive/取消检查；迟到资产引用感知回收。
- 回归：`node scripts/regression/f08-session.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F09 / P1 / 通过

- 位置：src/lib/media.ts:360
- 根因：视频检查阶段尚无 controller，取消后迟到结果仍启动上传。
- 触发/复现：延迟真实 MP4 元信息解析，检查期间取消。
- 修复：校验 AbortSignal、generation 失效、迟到 controller 取消；本地/TUS 启动、恢复、登记均检查取消。
- 回归：`node scripts/regression/f09-cancel.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F10 / P1 / 通过

- 位置：src/Camera.tsx:29
- 根因：隐藏页面只 kill tween，留下中间位置和已聚焦状态。
- 触发/复现：聚焦 120 ms 后隐藏页面；另测 resize 与轻柔模式切换。
- 修复：保存目标并完成到当前尺寸下的确定终点，同步清理 tween。
- 回归：`node scripts/regression/f10-focus.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F11 / P1 / 通过

- 位置：supabase/migrations/202611160002_required_versions.sql:2
- 根因：缺省/coercion 与 SQL NULL 比较允许绕过版本检查，超范围值触发数据库错误。
- 触发/复现：缺失、NULL、0、负数、小数、字符串、超 int32 版本；合法过期版本。
- 修复：HTTP 统一正 int32 版本，创建严格 0；非法 400、过期 409；SQL 显式拒绝 NULL 并明确比较。
- 回归：`node scripts/regression/f11-versions.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F12 / P1 / 通过

- 位置：scripts/sync-supabase.mjs:63
- 根因：同 slug 复用云端 ID，却把本地 ID 写进手记关联。
- 触发/复现：云端同 slug 不同 ID；分别跳过和 --force 导入。
- 修复：全部项目先预检 ID 映射，统一重写手记草稿与发布快照，映射失败先于内容写入。
- 回归：`node scripts/regression/f12-sync.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F13 / P1 / 通过

- 位置：supabase/migrations/202611160003_transactional_import.sql:2
- 根因：直接 upsert 不更新版本，媒体 upsert 可覆盖已登记二进制/删除状态。
- 触发/复现：导入前取得版本，再并发编辑后导入；重复导入；已登记媒体再次同步。
- 修复：service-only 事务 RPC 校验预检版本，递增内容/排序版本与时间；媒体身份不可覆盖。
- 回归：`node scripts/regression/f13-import.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F14 / P1 / 通过

- 位置：src/lib/media.ts:16
- 根因：清缓存不使在途请求失效，旧 finally 还可能移除新任务。
- 触发/复现：旧签名挂起→清 admin 缓存→新请求→乱序完成。
- 修复：public/admin 独立 epoch，结果写入与 finally 同时检查任务身份。
- 回归：`node scripts/regression/f14-cache.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F15 / P1 / 通过

- 位置：scripts/local-cms-store.mjs:1185；scripts/local-cms-plugin.mjs 的 configResolved / writeBundle / 错误恢复及 closeBundle。
- 根因：导出跳过缺失素材并覆盖完整旧产物，Windows 目录替换可能失败；Vite 在 writeBundle 前清空 outDir，独立导出原子化不足以保护旧完整构建。
- 触发/复现：缺失/错误类型/非 ready/缺缩略图；瞬时和永久 EPERM 更名注入；实际 Vite 缺素材、编译失败、预检后删除源文件。
- 修复：验证公开引用闭包及文件后暂存、原子替换和失败恢复；configResolved 在 Vite 清空输出前验证不可变快照并备份完整旧输出，构建/渲染失败或未完成时恢复，清理暂存；恢复受阻时保留唯一完整副本并报路径。
- 回归：`node scripts/regression/f15-export.mjs`、`node scripts/regression/f15-build.mjs`、`node scripts/regression/f15-atomic-io.mjs` 均退出 0，已包含在本次 26/26 串行回归中。干净副本也执行实际 Vite 构建保护回归并退出 0。

### F16 / P1 / 通过

- 位置：scripts/local-sessions.mjs:3
- 根因：LAN PIN 仅在请求头中，图片/视频无法使用该鉴权，缺少界面入口和会话。
- 触发/复现：真实 LAN 地址登录、草稿图/视频 Range、退出、错误 PIN 限流、网络失败及迟到 health。
- 修复：一小时随机 HttpOnly/SameSite=Strict Cookie，登录/退出失效缓存，CLI PIN 头兼容，不持久保存 PIN。
- 回归：`node scripts/regression/f16-lan.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F17 / P2 / 通过

- 位置：scripts/local-cms-store.mjs:210
- 根因：仅清理 .part，最终孤儿文件残留；清理错误容易被忽略。
- 触发/复现：24 小时最终文件、活动租约、finalize 后取消、迟到写入、坏链接遍历错误、HTTP 200 带 errors。
- 修复：上传租约/完成状态/取消墓碑；宽限期回收并排除引用；错误返回且界面保留重试、不宣布成功。
- 回归：`node scripts/regression/f17-orphans.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F18 / P2 / 通过

- 位置：scripts/local-cms-plugin.mjs:165
- 根因：suffix 被当成从 0 开始的闭区间。
- 触发/复现：bytes=-10、超大 suffix、0-0、开放结尾、越界、多区间逐字节比对。
- 修复：分别解析闭区间/开放结尾/suffix；越界 416，多区间忽略 Range 返回完整 200。
- 回归：`node scripts/regression/f18-range.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F19 / P2 / 通过

- 位置：scripts/test-runtime.mjs:25
- 根因：依赖历史 .qa/seed、可选跳过视频、固定 Chrome 路径/端口和退出清理不统一。
- 触发/复现：无私有配置与历史 .qa 的新检出；8 MiB MP4 分片及 TUS 重试。
- 修复：跟踪 7490 字节 MP4，以合法 free box 扩展为 8 MiB；共享浏览器选择、动态端口及进程清理。
- 回归：`node scripts/regression/f19-fixture.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F20 / P2 / 通过

- 位置：scripts/check-assets.mjs:7
- 根因：只检查哈希、Mock 遮盖真实 SQL/Edge、宽泛错误白名单及 Node 环境不匹配。
- 触发/复现：不可解码但哈希匹配的 GLB、真实 Supabase 故障注入、无私有输入的完整 CI 链。
- 修复：资源解码/树冠基准/照片 ROI；按请求和次数验收；真实 Auth/RLS/Storage/Edge、配置及 Edge 类型、Node 24 CI。
- 回归：`node scripts/regression/f20-gates.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

### F21 / P2 / 通过

- 位置：scripts/export-public.mjs:13
- 根因：Pages 读取被忽略的 local-data，缺失来源静默空导出；签名 URL 不能持久发布，Git 换行破坏哈希。
- 触发/复现：缺失来源、显式空快照、local/supabase 公开导出和构建、autocrlf=true 实际检出。
- 修复：显式来源、独立 site-content、公开接口下载并改写媒体、哈希清单与字节保留属性；Pages 必选且不回退。
- 回归：`node scripts/regression/f21-sources.mjs`；退出码 0。F02/F11/F12/F13 另有真实 Supabase/Edge 集成，F21 有真实双来源构建。

## 命令退出码

| 命令 | 退出码 | 证据适用范围 | 原始日志 |
|---|---:|---|---|
| npx tsc --noEmit | 0 | 早前验收记录，本次未重复执行 | .qa/final-latest/01.log |
| npm run assets:verify | 0 | 早前验收记录，本次未重复执行 | .qa/final-latest/06.log |
| npm run check:camera | 0 | 早前验收记录，本次未重复执行 | .qa/final-verification/03.log |
| npm run check:sound | 0 | 早前验收记录，本次未重复执行 | .qa/final-verification/04.log |
| npm run check:phase1 | 0 | 早前验收记录，本次未重复执行 | .qa/final-verification/05.log |
| npm run check:phase2 | 0 | 早前验收记录，本次未重复执行 | .qa/final-verification/06.log |
| npm run check:local | 0 | 交接已有：最后 F15 补修后通过，本次未重复执行 | .qa/f15-local-final.log |
| npm run check:cms | 0 | 早前验收记录，本次未重复执行 | .qa/final-verification/08.log |
| npm run check:polish | 0 | 早前验收记录，本次未重复执行 | .qa/final-recovery/01.log |
| npm run check:interactions | 0 | 早前验收记录，本次未重复执行 | .qa/final-recovery/02.log |
| npm run build (normal environment) | 0 | 本次最后 F15 补修后执行 | .qa/final-f15-closure/build-normal.log |
| npm run build:local (isolated explicit source) | 0 | 本次最后 F15 补修后执行 | .qa/final-f15-closure/build-local.log |
| npm run check:edge-cases | 0 | 早前验收记录，本次未重复执行 | .qa/final-recovery/05.log |
| npm run check:config | 0 | 早前验收记录，本次未重复执行 | .qa/final-latest/02.log |
| npm run check:edge | 0 | 早前验收记录，本次未重复执行 | .qa/final-latest/03.log |
| npm run check:regressions | 0 | 本次最后 F15 补修后执行 | .qa/final-f15-closure/regressions.log |
| npm run check:supabase | 0 | 交接已有：最后 F15 补修后通过，本次未重复执行 | .qa/f15-supabase-final.log |

本次完整回归 **26/26**，逐项记录：`.qa/final-f15-closure/regression-results.json`；总命令退出码与执行时间：`.qa/final-f15-closure/regressions.json`。两个顶层构建的执行记录为 `.qa/final-f15-closure/builds.json`，隔离构建临时目录已清理。

最后 F15 补修后的干净副本定向验证：

| 命令 | 退出码 | 原始日志 |
|---|---:|---|
| node scripts/regression/f15-build.mjs | 0 | .qa/final-f15-closure/clean-f15-build.log |
| node scripts/regression/f21-sources.mjs | 0 | .qa/final-f15-closure/clean-f21-sources.log |
| npm run check:config | 0 | .qa/final-f15-closure/clean-config.log |

只同步 local-cms-plugin、private-data-guard、public-snapshot、f15-build、f21-sources、check-regressions 六个文件；哈希一致。没有复制 .env*、local-data 或历史 .qa；原有公开 .env.example 保留。同步与执行证据为 `.qa/final-f15-closure/clean-targeted.json`。

早前完整干净检出链：`npm ci` 为 0，`npm run check:ci` 为 0，17/17 步通过；早于最后 F15 Vite 生命周期补修。**本次未重新执行完整 17 步 CI，不能把三项定向补测写成最新完整 CI 已通过。** 全部 Playwright/GPU 任务串行执行。本次未修改渲染代码，性能沿用既有相同条件的六轮数据；庭院冷启动 FPS 75.01% 的限制保留。

最初 polish/interactions 的夹具未传新建版本 0，edge-cases 还拦截了与所选画质不符的资源；已修正夹具并增加成功断言，失败日志保留在 `.qa/final-verification`，重跑证据在 `.qa/final-recovery`。

## 树木资源与性能

保持原树位/树种/实例化和 3D 木质枝干，运行时未放回百万面原模型。四向树冠遮罩全部达到 high≥80%、low≥70%。

| 树 / LOD | 原三角面 | 新三角面 / 预算 | 最低遮罩 IoU | 原 MiB → 新 MiB |
|---|---:|---:|---:|---:|
| island_tree_01 / high | 15963 | 15413 / 16000 | 82.73% | 1.38 → 3.78 |
| island_tree_01 / low | 7099 | 6511 / 7200 | 77.69% | 0.53 → 1.08 |
| island_tree_02 / high | 5949 | 5919 / 6000 | 82.26% | 1.08 → 1.77 |
| island_tree_02 / low | 2613 | 2363 / 2600 | 75.30% | 0.38 → 0.49 |
| tree_small_02 / high | 4655 | 4313 / 4800 | 80.79% | 1.08 → 3.12 |
| tree_small_02 / low | 2581 | 2189 / 2200 | 71.87% | 0.35 → 0.52 |

全部静态资源：35.27 → 41.22 MiB。

同一 AMD 780M、2560×1440、high、DPR 1、同一份公开场景数据，旧版/新版各三次，交替运行；新浏览器独立启动，计时中无截图/录制/其他 GPU 任务。

| 指标（三次中位数） | 旧版 | 新版 | 验收 |
|---|---:|---:|---|
| 全路线平均 FPS | 32.14 | 30.66 | 保留 95.39% ≥ 90%，通过 |
| 全路线 P95 ms | 66.60 | 66.60 | 比值 100.00% ≤ 110%，通过 |

**单独阶段限制：** 初始庭院 FPS 中位数 42.56 → 31.92，保留 75.01%。全路线门槛通过，庭院冷启动阶段仍有明显性能成本；完整阶段数据保存在 JSON。

第一次叶簇实现的全路线 FPS 保留率为 89.65%，未达门槛；随后将未选视角从片元丢弃改为顶点裁剪并统一实例视角，重新执行完整六轮后通过，未降低断言。初次失败数据保留在 `.qa/regression/performance-initial`。

GPU 资源：四轮 high/low 重建后几何 130、纹理 97，程序数保持有界（四轮 58，context 恢复后 57）；resize/DPR 及 WebGL context 恢复通过。截图位于 `.qa/regression/trees`，旧图位于 `.qa/audit-20261116/yard-high.png`。

## 数据库与发布

新增迁移为 `202611160001_safe_media_cleanup.sql`、`202611160002_required_versions.sql`、`202611160003_transactional_import.sql`；原三份历史迁移未修改。

生产顺序：暂停清理并等待在途任务结束 → 应用新增迁移及匹配函数 → 验证引用保护、领取/确认和失败重试 → 重新启用清理。具体操作与环境变量见 `BUGFIX-20261116.md`。

Pages 手动选择 local 或 supabase。site-content 初始为明确空快照；本地真实内容需自行公开导出、检查并提交。云端导出只使用公开 URL/key 和公开内容/签名接口，实际下载媒体，本地化 URL，不使用 service-role。缺失来源或校验失败非零退出，无来源回退。

## 尚未验证

- iOS Safari / Android 真机自动播放及低显存设备
- 生产数据库迁移与真实内容同步
- 远端 GitHub Actions / Pages 发布

真实集成使用本机 Docker 的独立 Supabase 项目（PostgreSQL 17、真实 Auth/RLS/Storage/Edge），包含 Storage 停机和数据库删除失败注入；结束后均停止隔离项目。PGlite 与 Mock UI 回归继续存在，各自不替代真实集成。
