---
name: 我的小屋 · 写实住宅
description: 自然白昼中的完整住宅、庭院与个人收藏
colors:
  paper: "#f4f4ed"
  ink: "#29362e"
  muted: "#536154"
  green: "#365840"
  primary-control: "#3f5543"
typography:
  display:
    fontFamily: "HomeHand, KaiTi, STKaiti, serif"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Microsoft YaHei, PingFang SC, sans-serif"
rounded:
  control: "0px"
spacing:
  control-gap: "8px"
  desktop-edge: "30px"
  mobile-edge: "18px"
components:
  primary-control:
    backgroundColor: "{colors.primary-control}"
    textColor: "#fffefa"
    rounded: "{rounded.control}"
  secondary-control:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
---

## Overview

Experience mode: the three-dimensional house leads the viewport and the interface stays near its edges. This document refreshes the prior linework house system to match the user's approved realistic reconstruction. It describes the implemented world.

Natural daylight, warm masonry, light plaster, gray pitched roof, woodwork, physical glass and living plants provide the visual identity. Sample artwork keeps its established illustration treatment. Architecture, furniture and vegetation have no universal black edge strokes.

## Colors

Interface roles are the frontmatter tokens and CSS variables in `experience.css`. Surfaces use opaque pale gray-green behind dark text for reliable legibility over the world.

PBR surface colors multiply real local maps: warm brick, slate gray roof, light plaster, neutral oak, stone and green terrain. Metal uses a muted brass or dark painted finish. Color maps use sRGB; normal and roughness data stay in a non-color space. The daylight HDR provides environment lighting and the sky background.

## Typography

Display lettering uses the existing self-hosted HomeHand font, with Chinese serif fallbacks. Interface copy uses the existing Chinese sans stack. Headers remain brief; desktop house welcome is 31 px, room titles 29 px. Mobile controls retain explicit accessible names even when their text is hidden.

Door names and the indoor welcome are physical plaques. Their text is rendered into a 2048 px atlas. The book and blank room use separate local text textures. Paintings preserve their original image ratio and remain independent from architectural materials.

## Layout

One metre is one world unit. House: 11 × 15 m. Interior clear height: 2.9 m. Corridor: 2.2 m wide, approximately 13.5 m long. Door centres: 3.2, 7, 10.8 m deep on the left, right and left. Doors: 1.02 × 2.2 m. The desk top is about 0.74 m high, chair seat 0.45 m, bookcase 2.05 m. Button steps move 1.1 m along the 12.5 m walkable camera path.

Walls, room transforms and camera stops share the metre-based coordinate convention recorded in `layout.ts`. Yard framing fits separate house, courtyard and tree bounds, with a 4.5% distance margin, at standing eye height. A stronger three-quarter view increases the house's share of the frame without dropping the yard or roof. The approach aligns to the path and door. Interior eye height is 1.65 m. Portrait gallery views focus on one original artwork position at 54° FOV; previous/next controls move the camera along the same physical row. Desktop retains the complete gallery composition.

Main controls sit on the top and bottom edges. Room content uses a right-hand reading panel on desktop and a lower panel on phones. The hall uses the existing native scroll track and visually hides its large HTML title so the architectural view remains open.

## Elevation & Depth

Every main architectural surface is lit. A local HDR, directional sun, restrained hemisphere fill and inward-facing rectangular window lights form the lighting system. Window light falls into the rooms while their deeper surfaces retain lower illumination. Plaster has a subdued normal scale; wood, paper and metal use separate roughness values. Sun shadows use 2048 px in high quality and 1024 px in compatible quality. Static shadow maps are reused and refreshed when doors settle. Doorstep nosing, post feet, glazing beads, gaskets, window handles, desk apron joints, drawer pulls and gallery rail supports carry the close-view detail.

EffectComposer renders the scene to an HDR target, then GTAO at 40% linear resolution, FXAA and OutputPass. FXAA avoids the multisampled HDR target and its resolve bandwidth while retaining edge smoothing. Compatible quality uses 33% AO resolution and lower sample counts. Exterior views omit room furnishings from the AO depth pass and furniture shadow drawing; the actual furnishings remain visible in the color pass through the windows. Interior views retain furniture AO and shadows. No depth of field, motion blur or bloom is present.

Glass uses a thin-pane approximation: low-opacity dielectric material, IOR-based environment reflection and a direct clear view of the actual scene behind it. It does not use the renderer's screen-space volume-transmission capture; the flat 6 mm glazing has negligible visible refraction at this scale. Glass neither writes depth nor enters the AO normal/depth buffer. Windows have actual openings, reveals, solid frames, glazing beads and projecting sills. Room furnishings remain resident and visible from the yard, so exterior windows show the same actual rooms that visitors enter. Trees and pots are reduced glTF geometry with cutout foliage and shadows. Grass blades are instanced; paving has thickness and small vertical variation.

## Shapes

The house has a full pitched roof, gables, eaves, gutters, downpipes, side and back walls, porch canopy and steps. Furniture and joinery use small physical bevels. Wood door grooves, frame, sill, handle and hinges are solids. Static geometry sharing a material is merged for rendering, while doors remain independently animated.

Interface controls are mostly square and flat. Existing native dialogs provide protected reading and viewing surfaces.

## Components

`CameraPose` unifies position, orientation quaternion and FOV. `TransitionState` records source, destination, phase and progress. GSAP interpolates the complete pose; return paths retreat through the same thresholds while retaining an interior or facade anchor. Place commits only after the last stable pose. Resize, reduced motion and background recovery all use the same endpoint calculation.

The full shell and all three room decorations persist through transitions. Texture upload, material compilation and the first render run behind the initial loading state. Navigation reuses that preparation promise instead of compiling and uploading a newly mounted destination room. Room visibility still limits indoor drawing costs; the yard view shows the furnishings through windows. All light types and light counts stay stable across navigation. Critical local assets load before entry becomes available. Load failures keep the current scene and expose retry.

DPR is native, capped at 1.5 for both stationary and moving views, including narrow desktop windows. Starting or stopping a walk does not resize the color, AO and depth buffers. This deliberately trades DPR 2 stationary supersampling for steady memory use and frame delivery on high-density screens. Compatible quality changes model, shadow and AO costs while preserving content and routes. QA mode records P50/P95/P99, maximum frame interval, counts above 33.33/50/100 ms, texture upload, shader compilation, shadow refresh and render-target resize events.

## Do's and Don'ts

- Preserve one physical layout and reversible routes when changing scene content.
- Keep sample content explicit and replaceable in `content.ts`.
- Keep local asset provenance, original MD5 and served SHA-256 records current.
- Validate actual frame rate, geometry and all-pass drawing costs on the target GPU.
- Do not reintroduce universal black outlines, a tree billboard, unlit architecture, look-target interpolation, early Place commits, runtime asset APIs, or decorative blur.
