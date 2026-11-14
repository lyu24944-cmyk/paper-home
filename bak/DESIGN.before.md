# Visual system

Mode: Experience. The three-dimensional house leads; navigation recedes.

The supplied video is the visual authority. This is an interpretation of its visible composition and spatial effects, not a pixel-perfect reproduction or a reconstruction of unknown source code. The approved local sequence is yard → front door → in-world welcome → corridor → first gallery → corridor. The first viewport is a front-facing garden entrance at eye height, with a red-brown main door, brick facade, foliage, windows, pots, stone path and one obvious enter action.

## Tokens

- Paper variable and scene background: `#fcfbf7`.
- Ink variable and dialog text: `#343630`.
- Secondary text variable: `#626257`.
- Green variable: `#526950`; primary entry/near-door controls use `#3f5543`.
- Main door face: `#814d3d`; its red-brown color distinguishes the exterior threshold from the pale room doors.
- Display lettering: self-hosted LXGW WenKai TC (`HomeHand`), then system KaiTi.
- Interface: Microsoft YaHei / PingFang SC / sans-serif.
- Display weight is 400. Yard/room headings are 31/29px on desktop and 27/26px at widths up to 650px; interface labels are mostly 11–14px. The in-world welcome is a canvas texture, not a CSS heading: 146px source lettering with a 12px outline, on a 4.8 × 2 unit plane scaled to .72 below 650px.
- Text at rest is visible. Motion is coordinated around camera travel and opening doors; the in-world welcome fades with camera approach.

## Composition

The house remains the dominant object. Navigation is small and near the viewport edges; controls and content sheets are mostly square-cornered, pale and flat. Desktop horizontal inset is 30px (24px at widths up to 1000px, 40px from 1600px); phones use 18px. Yard copy is a compact upper-left sheet. Room headings stay upper left; desktop reading/content sheets sit at right. Phone content sheets explicitly clear their top position and sit above bottom navigation. The gallery's directory starts collapsed so the hanging works lead.

All viewport sizes share a 28-unit walk. The first door is the gallery at depth 6 on the left; study is depth 14 on the right; blank room is depth 22 on the left. Native scroll progress drives eye-height translation and smooth glances toward nearby doors; a wheel/touch proxy forwards input over the fixed canvas. Eye height remains 1.65 units; near doors the camera moves away from the wall by up to .65 units and lifts its aim by up to .35 units so the door and sign fit. Only the nearby room receives an enter action. Room return restores the previous corridor progress. Normal travel uses shared interior coordinates and real door openings without a white curtain.

Interior box surfaces use unlit materials and authored linework over nearly white paper and light wood. Exterior foliage uses one transparent tree cutout on two planes. The gallery pairs three hanging paper works with fine strings, a railing, clouds and distant city linework. Fit the whole paper row to the horizontal camera span with 12% margin, including portrait tablets; paper strings retain their upper attachment height as the row scales. Interior camera field of view is 66° below 650px, otherwise 57°.

## Controls and states

All important canvas actions have ordinary DOM button alternatives. Native dialog elements provide focus confinement and Escape handling. Repeated navigation is locked until the camera and door transition finish. A manual reduced-motion switch and the operating system preference suppress camera travel. Ambient audio is initially off and starts only through its button.

Physical gallery papers open the artwork dialog; the collapsible collection directory provides the equivalent DOM actions. Keep the house map available for direct room navigation. Preserve the existing native dialog focus treatment and visible focus outlines.

The name editor is local to this browser and says so. Demonstration content is labeled. No visitor counts, factual biography or customer claims are invented.

## Walking input and transitions

The corridor has a six-viewport track (five viewports of scroll range); step buttons advance or reverse .7 viewport. Scroll progress lives in a ref; the frame loop smooths camera position and look direction. Viewport changes restore normalized progress. Modal and door transitions pause walking. Navigation has a wall-clock completion safeguard for throttled frames. Rooms behind closed doors are hidden from rendering. Reduced motion also stops foliage and gallery-paper sway.

## Source and evidence

`src/experience.css` overrides `src/style.css` through the import order in `src/main.tsx`; inspect the cascade rather than treating base declarations as the current screen. `src/World.tsx` owns geometry, room order, camera and responsive gallery projection. `src/ink.ts` owns new doors, welcome, paper labels and line drawings; `src/sketch.ts` retains base textures and demonstration artworks.

Approved changes and captures are recorded in `.qa/visual-update/CHANGELOG.md`. Compare `.qa/visual-update/keyframes-comparison.png` with the user's video; it demonstrates composition, not pixel equivalence. Asset provenance is `.qa/visual-update/ASSETS.md`. The independent four-fix review is `.qa/visual-update/REVIEW.md` (`disposition: ship`, bounded local scope).

This update merges the approved visual changes into the incumbent document and sidecar. Their pre-existing noncanonical headings, absent frontmatter and legacy sidecar schema remain untouched as format/schema work; PRODUCT.md remains the factual authority. No unrelated Impeccable migration is implied.
