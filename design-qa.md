# Design QA — compact desktop Zoom controls and Play-to-top scroll

## Evidence

- Source visual truth: the annotated 1024×768 production screenshot supplied by Bram at `/home/bram/.codex/attachments/482200b8-7151-4f4a-b25c-a34819f3bbad/codex-clipboard-440b922b-0745-4491-931e-a9244ef47c4c.png`.
- Deterministic pre-change render: `/tmp/docremote-compact-source-before-qa/state-playing-1024.png`.
- Rendered implementation: `/tmp/docremote-compact-zoom-qa/state-playing-1024.png`.
- Play-triggered top position: `/tmp/docremote-compact-zoom-qa/state-playing-auto-scroll-1024.png`.
- Mobile regression render: `/tmp/docremote-compact-zoom-qa/state-playing-390.png`.
- Same-viewport combined comparison: `/home/bram/.codex/visualizations/2026/07/14/docremote-compact-zoom-scroll/comparison-1024.png`.
- Viewports checked: 2560×1440, 1578×904, 1440×900, 1024×768, 768×900, 390×844, 320×720 and 844×390.

## Findings and comparison history

1. P1 visual mismatch on laptop/desktop: Zoom Controls competed with the player and media picker because its buttons, icons, gaps and panel padding were oversized. Fix: at widths from 960px, the panel is reduced to compact 52px/68px controls with smaller typography, icons, padding and gaps.
2. P1 interaction mismatch: after the bottom Play action, conditional reveal logic could leave the page partway down. Fix: after successful playback reaches loading, playing or paused state, the page now scrolls to absolute top (`top: 0`) every time.
3. Mobile fidelity: no mobile control sizing was changed. At widths below 960px the existing touch-target layout remains active; the automated minimum-size check passes.
4. Post-fix comparison: the 1024px desktop controls take materially less height while retaining the same hierarchy, colors, labels and actions. The resulting extra space brings the timer closer without increasing the media picker width.
5. Automated responsive QA: every assertion passes at all eight viewports, including no horizontal page scroll, compact desktop controls, preserved mobile touch sizes and both Play-to-top cases. The single first-run local 404 was the static server's missing favicon and is unrelated to the application bundle.

## Required fidelity surfaces

- Fonts and typography: existing system typography preserved; only desktop Zoom control sizing was reduced.
- Spacing and layout rhythm: left-column controls are calmer and denser without changing column widths or mobile stacking.
- Colors and visual tokens: unchanged.
- Image and icon fidelity: existing Zoom and control icons retained at smaller desktop sizes.
- Copy and content: unchanged.
- Accessibility and interaction: mobile touch sizes remain at least 52px; keyboard and screen-reader QA remains green; reduced-motion users receive an immediate rather than smooth top scroll.

## Remaining findings

- No actionable P0, P1 or P2 findings.

## Final result

passed
