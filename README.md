# Paper Home · A Living 3D Digital Cottage for Creators

<p align="center">
  <a href="./README.md"><strong>English</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./DEPLOY.md"><strong>Cloud Deployment (ZH)</strong></a> · <a href="./QA.md"><strong>Rendering & QA Notes</strong></a>
</p>

**Paper Home** is an architectural, tactile 3D personal website and portfolio template built with **React 19, Three.js (`@react-three/fiber`), and Vite**.

Instead of a floating 3D gimmick or a static link-in-bio page, Paper Home gives you a **real 11×15m single-story house** with 6mm physical glass windows, a courtyard tree, a central hallway, and three dedicated rooms (**Study Notes**, **Gallery**, and **About Me**) — complete with **living time-of-day lighting, rain & procedural WebAudio soundscapes, clickable room objects, and a zero-config in-browser Local Studio**.

---

## ✨ Why Paper Home Stands Out

| Capability | Typical 3D Portfolio Templates | Paper Home |
| --- | --- | --- |
| **Architectural Continuity** | Isolated scenes or skybox illusions | **True 11×15m walkable cottage** — look through the 6mm courtyard windows and see the actual Study desk and Gallery frames inside |
| **Living Time & Weather** | Frozen midday lighting | **4 physical atmospheres (`Dawn`, `Daylight`, `Sunset`, `Night`, plus `Auto` local-clock sync) + `Rain`**, with warm interior lamps glowing through the windows at dusk and night |
| **Procedural Audio & Tactile Props** | Heavy MP3 downloads & static meshes | **Zero external audio files** — WebAudio synthesizes wind chimes and filtered rain (automatically muffled when you step indoors); click the brass desk lamp, draw a bookshelf quote slip, sit on the yard bench, or stamp the wooden guestbox |
| **Editing Experience** | Edit raw JSON/TSX files in an IDE | **Built-in Local Studio CMS** — create projects, write study notes, compress images to WebP, upload chunked videos, and preview drafts right in the browser with zero cloud accounts |
| **Publishing & Hosting** | Locked to a single backend | **1-command static snapshot (`npm run build:local`)** that strips drafts and admin UI for GitHub Pages / Vercel / Netlify, or upgrade to **Supabase + Cloudflare Pages** anytime |
| **Performance & Privacy** | External CDN fonts/textures & per-frame shadow baking | **0 runtime external network requests**, procedural canvas textures, on-demand shadow map updates (`shadowMap.autoUpdate = false`), and strict mobile viewport discipline |

---

## 🚀 30-Second Quickstart (Zero Cloud Setup)

Prerequisites: [Node.js](https://nodejs.org/) 20+ and any modern desktop or mobile browser.

```bash
# 1. Clone the repo (or click "Use this template" on GitHub)
git clone <your-repo-url>
cd paper-home

# 2. Install dependencies
npm install

# 3. Start the Local Studio (or run `npm run studio` to auto-open your browser)
npm run dev
```

Open `http://127.0.0.1:4318/` to step into your cottage.

> 💡 **Want to explore with sample projects & notes pre-loaded?**
> Run `npm run init:sample` in your terminal, or open **Cottage Map (`小屋地图`) -> Enter Edit Mode (`进入编辑模式`) -> Import Sample Content (`导入示例内容`)**.

---

## 🌤️ Interactive Highlights

1. **Four Time-of-Day Atmospheres + Rain Soundscape**
   - Switch between **Dawn (`晨雾`)**, **Daylight (`晴昼`)**, **Sunset (`落日`)**, **Night (`夜灯`)**, **Auto (`随时间`)**, and **Rain (`细雨`)** directly from the top bar — or share a mood via URL parameters such as `?at=night&weather=rain#yard`.
   - Enable the bottom-right **Ambient Sound** toggle to hear procedural pentatonic chimes and multi-band filtered rain that subtly muffles when you walk from the courtyard into an indoor room.
2. **Tactile Room Objects & Camera Sub-Poses**
   - **Courtyard (`#yard`)**: Click the wooden bench under the tree to sit and look up at the porch eaves, or click the porch postbox to jump straight to the Guestbook box.
   - **Study (`#study`)**: Click the green-shaded brass desk lamp to toggle warm task lighting, or click the bookshelf to draw a random quote slip.
   - **About Me (`#blank`)**: Inspect the 3 angled **Now Notes** on the wooden table and leave a mood stamp in the **Visitor Guestbox**.

---

## ✍️ Editing Your Cottage in Local Studio

1. Click **Cottage Map (`小屋地图`)** in the top-right corner and select **Enter Edit Mode (`进入编辑模式`)**.
   - *Security boundary*: Local write APIs only accept requests from loopback addresses (`127.0.0.1` / `localhost`).
2. **Customize Branding & Default Atmosphere**:
   - Rename your cottage, customize the wooden hallway plaque and courtyard greeting, and choose the default atmosphere/weather visitors see first.
3. **Curate Room Content**:
   - **Gallery (`#gallery`)**: Add projects with cover art, multi-image galleries (automatically compressed client-side into WebP display & thumb variants), and demo videos (chunked upload with HTTP 206 Range streaming). The top 3 published projects are framed directly on the 3D gallery wall.
   - **Study (`#study`)**: Write long-form notes with images, video, and bi-directional links to your projects.
   - **About Me (`#blank`)**: Update your profile, avatar, 3 tabletop **Now Notes**, custom bookshelf quotes, and contact links.
4. **Draft vs. Public Isolation**:
   - All edits save as drafts first (`local-data/`). Switch to **Visitor Preview (`退出编辑（访客预览）`)** at any time to verify that unpublished drafts remain hidden.

---

## 📦 Deploying Your Cottage

### Option 1: GitHub Pages (Included Workflow)
This repository includes a ready-to-use GitHub Actions workflow at [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml):
1. In your GitHub repository, go to **Settings -> Pages** and set **Build and deployment -> Source** to **GitHub Actions**.
2. Push to `main` (or trigger the workflow manually from the **Actions** tab) to build a clean static snapshot (`npm run build:local`) and deploy it to GitHub Pages.

### Option 2: Export a Pure Static Bundle Anywhere
```bash
npm run build:local
```
This exports a read-only production bundle into `dist/` containing only **published** items and referenced media (`dist/local-snapshot/`), with all draft data and admin UI stripped out. Host `dist/` on Cloudflare Pages, Vercel, Netlify, or any static server.

### Option 3: Upgrade to Supabase + Cloudflare Pages (Multi-Device Cloud CMS)
When you want to edit from both your laptop and phone with magic-link authentication and cloud storage, follow [DEPLOY.md](./DEPLOY.md) and run `npm run sync:supabase` to migrate your local `local-data/` to Supabase in one command.

---

## 🧪 Verification & Quality Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Local Studio at `http://127.0.0.1:4318/` |
| `npm run build:local` | Build a read-only static snapshot into `dist/` |
| `npm run assets:verify` | Verify asset budget and enforce 0 runtime external network requests |
| `npm run check:camera` | Verify 75,000+ camera trajectory samples across 120 doorway routes & 6 viewports |
| `npm run check:local` | End-to-end Playwright verification of Local Studio, draft isolation & static export |
| `npm run check:cms` | End-to-end Playwright verification of Cloud CMS, TUS chunked upload & conflict recovery |
