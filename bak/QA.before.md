# Local verification

Current visual update verified on 2026-11-12 (Asia/Tokyo) at [the existing local preview](http://127.0.0.1:4317/). This milestone covers the three reference keyframes and entry-to-first-gallery experience. No deployment or new dependencies were introduced.

- `npm run build` passed TypeScript and Vite production bundling. Current JavaScript output: 1,281.70 KB / 370.35 KB gzip. The existing large-chunk warning remains.
- Browser layouts checked at desktop 1440×900, tablet 768×1024, mobile 390×844 and the actual in-app pane 577×703. Measured views had no DOM horizontal overflow; the three gallery papers fit the horizontal camera view.
- Verified normal front-door entry, forward steps, reverse walking, first-gallery entry, a physical artwork click, collection-directory open/close, artwork and article dialogs with Escape, and map navigation to study and blank room.
- Verified reduced-motion return from the study to the yard. Separately, gallery return restored the native corridor scroll position after the final fixes: 591px before entry and 591px after return on the measured phone viewport.
- Geometry checks confirmed eye height 1.65, monotonically increasing corridor depth and alignment of all three transformed room thresholds with their corridor openings.
- The final browser console error list was empty.

## Independent review

[The independent review](.qa/visual-update/REVIEW.md) reopened all 11 fix-verification screenshots and marked each original finding resolved: tablet gallery fit, first-door cropping after a default step, welcome title size/weight, and mobile room-panel positioning. Its disposition is `ship` for that bounded scope, with no visible regression found in those captures. Runtime interactions, projection checks, scroll restoration, build and console results are implementation-side evidence; the reviewer did not rerun them.

## Visual evidence

[Keyframe comparison](.qa/visual-update/keyframes-comparison.png) places the user's video frames on the left and current desktop captures on the right. The video remains the visual authority; these captures support a composition comparison, not a pixel-identical claim. [The change record](.qa/visual-update/CHANGELOG.md) indexes current yard, welcome, door, gallery and room captures. A pink circular helper visible on some captures belongs to the browser environment and is absent from the website source.

[Asset provenance](.qa/visual-update/ASSETS.md) records the generated transparent garden tree and exact prompt; all video frames remain QA-only comparison files. `.qa/visual-update/source-before.zip` is the pre-change source backup.

## Earlier milestone evidence

Earlier checks recorded house-name persistence across reload (then default-name restoration), ambient-audio and reduced-motion button states, native-dialog focus return, and contrast corrections to captions and map notes. Those are historical checks, not a new contrast audit after this visual palette update. Earlier screenshots outside `.qa/visual-update/` describe the previous design and must not be used as current visual goldens.

## Limits

Sample articles and artwork remain replaceable demonstrations. Delivery is local preview only, with no backend or account system. Physical-phone touch, actual audio quality and hardware GPU frame rate have not been measured. This pass is not a full accessibility certification. PRODUCT.md and unrelated legacy Impeccable document/schema drift were not migrated.
