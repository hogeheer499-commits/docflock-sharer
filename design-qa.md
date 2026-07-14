# Design QA — adaptive laptop library and smart scrolling

## Evidence

- Source visual truth: `/home/bram/.codex/attachments/7c20d11d-185a-46cd-94b2-11a02c8fe70b/codex-clipboard-98b3385e-94c1-4f1a-85ce-d82e2d311b34.png`
- Implementation at the same laptop viewport: `/home/bram/.codex/visualizations/2026/07/14/docremote-adaptive-scroll-local/state-playing-1024.png`
- Full-view combined comparison: `/home/bram/.codex/visualizations/2026/07/14/docremote-adaptive-scroll-local/comparison-1024.png`
- Focused selection-scroll evidence: `/home/bram/.codex/visualizations/2026/07/14/docremote-adaptive-scroll-local/state-selection-actions-1024.png`
- Focused play-scroll evidence: `/home/bram/.codex/visualizations/2026/07/14/docremote-adaptive-scroll-local/state-playing-auto-scroll-1024.png`
- Viewports checked: 2560×1440, 1440×900, 1024×768, 768×900, 390×844, 320×720 and 844×390.
- State: playing lecture with an active lecture selection.

## Comparison history

1. P1 source finding: at 1024×768 the lecture browser had only a short visible list area, despite the overall page having room to scroll. Fix: the desktop Choose & Play workspace now has an 820 px minimum height while still expanding naturally on taller displays.
2. Post-fix full-view comparison: the laptop library has a substantially larger browsing region while the 4K layout keeps its viewport-driven height. Typography, colors, icons, copy, radii and spacing remain on the existing Doc Remote design tokens; no new image assets were introduced.
3. Focused interaction comparison: selecting a lecture scrolls to the selection/actions only when the complete Play/Add-to-queue row is outside the viewport. When it is already visible, no scroll occurs.
4. Focused playback comparison: pressing Play scrolls back to the player only when the player is outside the viewport. When it is already visible, no scroll occurs.
5. Responsive and interaction QA: all assertions pass at all seven viewports, with no console errors and no page-wide horizontal overflow. Mobile visual order remains unchanged.

## Accepted implementation differences

- The source screenshot includes browser device-emulation chrome; the combined comparison normalizes image height and evaluates the page content rather than the surrounding browser frame.
- Dynamic lecture titles differ between captures, but hierarchy and component behavior represent the same playing-and-selected state.
- The longer laptop card intentionally extends below the first viewport so the list can be larger; smart scrolling exposes the next relevant control at the moment it is needed.

## Final result

passed
