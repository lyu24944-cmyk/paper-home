# 小屋线上部署、本地开发与账号恢复说明

本文档说明如何将 `paper-home` 接入你自己的 **Supabase**（单管理员登录、Postgres、私有存储桶、Edge Functions）与 **Cloudflare Pages**（静态前端托管），以及如何在本地开发和恢复管理员账号。

> **安全边界**：`SUPABASE_SERVICE_ROLE_KEY` 仅保存在 Supabase Edge Functions 服务端密钥及你本地执行初始化脚本时使用，**切勿**以 `VITE_` 前缀写入前端环境变量或提交到 Git 仓库。

---

## 一、本地开发与构建命令

在 `paper-home/` 目录下运行：

```bash
# 安装依赖
npm install

# 复制环境变量模板，填写 Supabase 项目地址与 Anon Key
cp .env.example .env.local

# 本地开发服务器（默认 http://127.0.0.1:4318/）
npm run dev

# 构建生产产物 dist/（先运行 assets:verify，再执行 tsc -b && vite build）
npm run build

# 本地预览构建产物（http://127.0.0.1:4319/）
npm run preview
```

本地验证脚本：

```bash
# 镜头路线与视口几何校验（75,144 个采样点）
npm run check:camera

# 完整 CMS 功能自动化校验（本地构建测试包并驱动无头 Chrome 与模拟 Supabase 服务）
npm run check:cms
```

---

## 二、准备 Supabase（免费方案起步）

当前免费方案限制提醒（参考 [Supabase 定价说明](https://supabase.com/pricing)）：
- 免费项目文件存储总额度 **1 GB**，单文件上传上限 **50 MB**；不开启自动付费升级，达到限制时需清理旧素材、压缩文件或手动升级。
- 免费项目长期不活跃可能会暂停，因此不作为持续在线等级保证。

### 1. 关闭公开注册并创建管理员账号
1. 登录 [Supabase Dashboard](https://supabase.com/dashboard) 创建一个新项目（Free Plan）。
2. 进入 **Authentication -> Sign In / Providers -> Email**：
   - 关闭公开注册（或确保前端无注册入口，且 `supabase/config.toml` 已配置 `enable_signup = false`）。
   - 关闭 **Enable anonymous sign-ins**。
3. 进入 **Authentication -> Users -> Add user -> Create new user**：
   - 输入你的管理员邮箱与强密码（建议勾选 Auto Confirm User）。
   - 记录该用户的 **UUID**，稍后写入 `public.admin_users`。

### 2. 部署数据库结构与 Edge Functions

如果本机已安装 [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)：

```bash
cd paper-home

# 1. 登录并关联你的 Supabase 项目（替换为真实 Project Ref）
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>

# 2. 推送表结构、私有桶 `cottage-media`、RLS 策略及原子版本 RPC
npx supabase db push

# 3. 绑定唯一管理员用户 UUID（或在 SQL Editor 中执行）
# insert into public.admin_users (user_id) values ('<ADMIN_USER_UUID>') on conflict do nothing;

# 4. 设置 Edge Function 密钥（Supabase 默认会注入 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY；若手动覆盖可检查 secrets list）
# 5. 部署 5 个 Edge Functions（使用 config.toml 中的 verify_jwt = false，函数内部调用 requireAdmin / public 检查）
npx supabase functions deploy public-content --no-verify-jwt
npx supabase functions deploy admin-content --no-verify-jwt
npx supabase functions deploy admin-mutate --no-verify-jwt
npx supabase functions deploy media-sign --no-verify-jwt
npx supabase functions deploy media-cleanup --no-verify-jwt
```

> 若未安装 Docker 也不影响 `db push` 与 `functions deploy`；若不方便用 CLI，也可以直接在 Supabase Dashboard SQL Editor 按顺序依次运行 `supabase/migrations/202611140001_cottage_cms.sql`、`202611140002_hardening.sql` 与 `202611140003_site_settings_now_quotes_and_hardening.sql` 全文，再手动在 Edge Functions 面板创建这 5 个函数。

---

## 三、将本地内容或初始数据迁入云端

如果你已经在**本地工作室模式**（`npm run dev`）里编辑好了自己的作品、手记、个人介绍与图片/视频（保存在 `local-data/` 目录），只需一条命令即可全部同步到你自己的 Supabase 项目：

```bash
cd paper-home
$env:SUPABASE_URL="https://<YOUR_PROJECT_REF>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<YOUR_SERVICE_ROLE_KEY>"
$env:ADMIN_EMAIL="<YOUR_ADMIN_EMAIL>"

# 将 local-data/ 中的作品、手记、个人资料及媒体同步至 Supabase（保留本地发布状态；追加 --as-drafts 可先全部存为草稿）
npm run sync:supabase
```

如果你只想在本地快速生成一套中性示例后再同步：

```bash
npm run init:sample
npm run sync:supabase
```

> 补充：仓库中也保留了 `scripts/seed-initial.mjs`，供作者本人从本地 `.qa/seed/` 缓存导入原始示例元数据（`seed/initial-content.json`）。普通开源使用者请优先使用 **本地编辑 + `npm run sync:supabase`**。

执行完成后，在网站中打开 **「小屋地图 -> 主人登录」** 登录你的管理员账号，即可继续在线编辑、预览、发布或撤回内容。

---

## 四、部署前端到 Cloudflare Pages

参考 [Cloudflare Pages React 部署指南](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)，仅部署网站源码与运行素材（`paper-home/` 目录），**不要上传**本地媒体工作区（`local-data/`）或测试缓存（`.qa/`）：

1. 基于本仓库点击 **Use this template** 创建你自己的 GitHub 仓库（如 `<your-github-username>/paper-home`），在 Cloudflare Pages 连接该仓库。
2. 在 Cloudflare Pages 构建配置中设置：
   - **Root directory**（若仓库根即 `paper-home` 则留空，否则填 `paper-home`）
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
3. 在 **Settings -> Environment variables**（Production 与 Preview）中添加**仅两个**公开变量：
   - `VITE_SUPABASE_URL` = `https://<YOUR_PROJECT_REF>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<YOUR_SUPABASE_ANON_KEY>`
4. 触发部署完成后，在 Supabase Dashboard -> **Authentication -> URL Configuration** 中将你的 `https://*.pages.dev` 与自定义域名加入 **Site URL** / **Redirect URLs**。

---

## 五、管理员账号恢复说明

1. **忘记密码**：在 Supabase Dashboard -> **Authentication -> Users** 中找到你的管理员邮箱，点击发送密码重置邮件或由后台直接更新密码；前端刻意不提供公开注册或自助注册入口，防止他人注册账号。
2. **更换管理员邮箱 / 恢复权限**：若需要更换主人登录账号，在 Supabase Auth 创建或定位新的目标用户 UUID 后，于 SQL Editor 中更新 `public.admin_users`：
   ```sql
   insert into public.admin_users (user_id) values ('<NEW_USER_UUID>') on conflict do nothing;
   -- 如需停用旧账号管理权限：
   -- delete from public.admin_users where user_id = '<OLD_USER_UUID>';
   ```
3. **存储额度与旧素材清理**：删除内容或替换图片/视频后，系统会自动将不再被草稿或公开快照引用的文件加入清理队列并在存储桶释放空间；若网络中断留下待清理项，登录后打开「小屋地图」点击 **「重试清理」** 即可。
