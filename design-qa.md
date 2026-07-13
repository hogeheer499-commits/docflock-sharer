# Design QA — Doc Remote accessibility and responsive follow-up

- Source visual truth: `/home/bram/.codex/attachments/858b47c9-c78b-4956-83b3-934821226d55/codex-clipboard-a810c08e-0f4a-420f-9b51-5aa2a5c32e63.png`, `/home/bram/.codex/attachments/c803a1ce-f746-444e-a6c6-112ef3d02a5d/codex-clipboard-c13c4d67-897e-4bce-b846-03db228ac866.png`, and the delegated audit specification dated 2026-07-14.
- Implementation screenshots: `/home/bram/.codex/visualizations/2026/07/13/019f5c8c-a200-75f0-86b7-592bd2df4d81/responsive-2560.png`, `responsive-1440.png`, `responsive-1024.png`, `responsive-768.png`, `responsive-390.png`, `responsive-320.png`, and `responsive-844x390.png` in the same directory.
- Viewports: 2560 × 1080, 1440 × 900, 1024 × 900, 768 × 900, 390 × 844, 320 × 720, and 844 × 390.
- State: authenticated mock data; Zoom connected; no timer; first lecture selected; no real Zoom, timer-exit, playback, or queue API action fired.
- Full-view comparison evidence: `/home/bram/.codex/visualizations/2026/07/13/019f5c8c-a200-75f0-86b7-592bd2df4d81/qa-wide-before-after.png`.
- Focused mobile comparison evidence: `/home/bram/.codex/visualizations/2026/07/13/019f5c8c-a200-75f0-86b7-592bd2df4d81/qa-mobile-before-after.png`.
- Additional state evidence: `/home/bram/.codex/visualizations/2026/07/13/019f5c8c-a200-75f0-86b7-592bd2df4d81/state-empty-1440.png` and `state-shortcuts-1440.png`.
- Automated browser results: `/home/bram/.codex/visualizations/2026/07/13/019f5c8c-a200-75f0-86b7-592bd2df4d81/responsive-results.json`.

## Findings

No actionable P0, P1, or P2 findings remain.

- Fonts and typography: the existing system sans-serif stack and weight hierarchy are preserved. Compact controls remain legible at 320 px; selection and empty-state copy truncate or wrap intentionally without clipping.
- Spacing and layout rhythm: ultrawide content is centered at a 1560 px maximum. The two-column workspace remains at 1024 px and stacks below 960 px. At 390/320 px Zoom actions use a balanced 2 × 2 grid; at 844 × 390 they compress into one horizontal row so the timer and media area remain visible.
- Colors and visual tokens: the established warm neutral canvas, white surfaces, blue primary state, slate toggles, red exit action, and green Zoom readiness state are unchanged. Focus-visible rings use the existing blue accent.
- Image quality and asset fidelity: the supplied Zoom logo remains the source raster asset and Bootstrap Icons remain the product icon system; no replacement CSS art, handcrafted SVG, or placeholder image was introduced.
- Copy and content: selection is now explicit as `Selected: <title> · <category>`. Empty search shows the requested Dutch no-results message and `Zoekopdracht wissen`. Timer history is separated as `Last auto-exit: <time>` from the current `No timer set` state.
- Accessibility and affordance: media rows are native buttons with selected state; language inputs use a visually-hidden focusable pattern; tabs expose tablist/tab/tabpanel semantics with arrow, Home, and End navigation; the shortcuts dialog moves and traps focus, blocks background scroll, closes with Escape, and restores focus.
- Performance: only the active media list is rendered. Switching category removes inactive rows from the DOM, and active rows use `content-visibility: auto`.
- Responsive behavior: every required viewport has no page-wide horizontal scroll. At 320 px the small tab overflow is paired with scroll snapping and a visible `Scroll for more` hint.

## Comparison history

### Iteration 1

- [P1] The first implementation let the new selection summary shrink to a thin, clipped strip at desktop heights.
- [P1] The first no-results state still occupied the full media-list height, leaving a large empty panel.
- Fixes: made the selection summary non-shrinking with a fixed minimum height; changed the empty list, panel, and browse card to content-sized empty-state layout.
- Post-fix evidence: `responsive-1440.png` and `state-empty-1440.png` at the paths above.

### Iteration 2

- [P2] At 320 px the earlier media-query order hid the explicit Zoom label and kept wider tab minimums than intended.
- Fixes: moved the 320 px override after the 420 px rule, retained a compact visible `Zoom connected` label, reduced tab minimums, and retained the scroll hint for the remaining 10 px tab overflow.
- Post-fix evidence: `responsive-320.png` and the browser metrics in `responsive-results.json`.

## Primary interactions tested

- Native media-row focus and selected state.
- Language-pill keyboard focus.
- Tab click switching plus Left/Right/Home/End keyboard navigation.
- Selection persistence and explicit category copy after switching tabs.
- Empty-search message and clear-search control.
- Shortcuts dialog semantics, focus entry, focus trap, Escape close, scroll lock, and focus restoration.
- Timer history/current-state separation using local state only.
- Inactive media lists removed from the DOM.
- Tab discoverability and page horizontal-overflow checks at all seven viewports.
- Browser console errors checked at all seven viewports; none found.

## Implementation checklist

- [x] Maximum 1560 px centered ultrawide layout.
- [x] Two columns at 1024 px; stacked layout at 768 px and below.
- [x] Compact portrait and landscape Zoom controls.
- [x] Accessible rows, language pills, tabs, and shortcuts dialog.
- [x] Explicit persisted selection and compact no-results state.
- [x] Active-panel-only DOM rendering.
- [x] Hashed first-party CSS/JS asset references and cache-policy verification.
- [x] No real Zoom, playback, queue, or exit actions during QA.

## Follow-up polish

- None required for this acceptance pass.

final result: passed
