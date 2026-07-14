# Design QA — end-after-video and taller laptop library

## Evidence

- Timer source visual: `/home/bram/.codex/attachments/5e736ac2-bdbd-4e4c-9428-9cae0aa7c08e/codex-clipboard-c346a73e-5697-41a3-bd34-cbc1ad0aedf9.png`
- Laptop source visual: `/home/bram/.codex/attachments/384202e4-844f-49f1-ada1-0d4e80604162/codex-clipboard-e326d6d4-eb98-4584-be8a-8888fe998285.png`
- Timer implementation: `/home/bram/.codex/visualizations/2026/07/14/docremote-after-video-local/state-after-video-390.png`
- Laptop implementation: `/home/bram/.codex/visualizations/2026/07/14/docremote-after-video-local/responsive-1024.png`
- Focused combined comparisons: `/home/bram/.codex/visualizations/2026/07/14/docremote-after-video-local/comparison-timer.png` and `/home/bram/.codex/visualizations/2026/07/14/docremote-after-video-local/comparison-laptop.png`
- Viewports checked: 2560×1440, 1578×904, 1440×900, 1024×768, 768×900, 390×844, 320×720 and 844×390.
- States: no playback, playing, end-after-video armed/cancelled/completed, lecture selected, playback started, empty search and shortcuts dialog.

## Findings and comparison history

1. P1 functional gap: the timer only supported a fixed number of minutes. Fix: a clearly separated `OR` option now arms a server-side “End / leave when this video finishes” action for the currently playing video.
2. P1 reliability requirement: a browser-only watcher could be suspended when a phone locks. Fix: the Beelink backend is the source of truth. Natural FFmpeg completion claims the armed video, suppresses loop/queue/autoplay, leaves the player stopped, and then uses the existing role-aware Zoom exit action. Reloading or closing the remote page does not cancel it.
3. P2 laptop density: the laptop lecture browser previously exposed the Play row too early. Fix: between 960 and 1279 px the workspace is now at least 980 px tall, so browsing receives more space and the actions may sit below the initial fold. Existing conditional smart scroll reveals them after selection and returns to the player after Play.
4. Post-fix evidence: both focused comparisons preserve Doc Remote’s typography, blue/gray/red tokens, card radii, spacing and existing Bootstrap icon style. The new option has clear disabled, armed, cancel and focus-visible states.
5. Automated QA: every assertion passes at all eight viewports with no console errors or page-wide horizontal overflow. Backend metadata and Zoom-control tests pass (22 tests), including arm, cancel, video validation, natural-end claiming, role-aware exit completion and bridge-command timeout handling.

## Required fidelity surfaces

- Fonts and typography: existing font family, hierarchy, weights and line heights retained; the new copy wraps cleanly at 320–390 px.
- Spacing and layout rhythm: the OR divider and full-width action fit the timer card without crowding; laptop library height intentionally extends below the viewport.
- Colors and visual tokens: only existing accent, border, surface and muted text colors are used.
- Image quality and assets: no raster or decorative assets were introduced; the standard Bootstrap end icon matches the existing control family.
- Copy and content: “End / leave” matches the existing role-aware behavior—host ends for everyone, participant leaves.
- Accessibility and interaction: the option is a real button with disabled state, keyboard focus, `aria-pressed`, live armed status and a cancel path.

## Remaining findings

- No actionable P0, P1 or P2 findings.

## Final result

passed
