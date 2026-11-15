# Product context

Paper Home is an open-source, walkable 3D personal cottage & portfolio template built with React, Three.js, and Vite, designed so creators without a coding background can launch it locally, replace content visually in the browser, and publish a clean static site.

- A Chinese personal home on the web, experienced by entering a full cottage, walking its corridor, reading, and viewing sample art.
- One 11 × 15 m single-storey house with a complete roof, exterior, porch and courtyard. Corridor width 2.2 m; room door depths 3.2, 7 and 10.8 m, left–right–left. Walking eye height approximately 1.65 m above the current ground.
- Natural daylight and four time-of-day atmospheres (`dawn`, `daylight`, `golden`, `night`, `auto`) plus `rain`, warm brick, light plaster, dark gray roof, wood, physical glass, solid paving and three-dimensional plants. Existing artwork keeps its illustration style.
- Preserve scroll walking, maps, room return positions, reading, artwork viewing, local rename, local sound, tactile room interactions and reduced motion.
- Desktop first, with tablet, phone, in-app WebView and narrow desktop window regression. Resolution, texture and geometry budgets are explicit and measured.
- Ships with zero-config local launchers (`启动小屋.bat` / `启动小屋.command`) and an in-browser Local Studio (`local-data/`) that seeds neutral starter samples on first run; supports one-command static export (`npm run build:local`) for GitHub Pages (via manual `workflow_dispatch`) or any static host, plus optional Supabase + Cloudflare Pages cloud CMS mode.

Success is a coherent residential space and reversible navigation: a visitor must keep a recognizable architectural anchor throughout transitions, reach a deterministic final camera pose, and regain all navigation controls. Failed resource loads or WebGL context loss must leave the visitor with clear recovery controls.
