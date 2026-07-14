# Design QA — timer visibility follows player activity

## Evidence

- Source visual truth: the annotated production state supplied in Browser Comment 1, reproduced before the change at `/tmp/docremote-source-before-qa/responsive-1024.png`.
- Rendered implementation: `/tmp/docremote-timer-visibility-qa/responsive-1024.png`.
- Active-player state: `/tmp/docremote-timer-visibility-qa/state-after-video-1024.png`.
- Same-viewport combined comparison: `/home/bram/.codex/visualizations/2026/07/14/docremote-timer-visibility/comparison-1024.png`.
- Viewports checked: 2560×1440, 1578×904, 1440×900, 1024×768, 768×900, 390×844, 320×720 and 844×390.
- States checked: stopped, loading/playing, paused, end-after-video armed and stopped again.

## Findings and comparison history

1. P1 mismatch in the annotated stopped state: Auto-exit timer remained visible while no player was active. Fix: the entire timer card now starts hidden and is only revealed for `loading`, `playing` or `paused` playback states.
2. Post-fix comparison: the stopped 1024×768 implementation removes only the annotated timer card. Zoom Controls, Choose & Play, header, responsive grid, spacing and card styling are otherwise unchanged.
3. Functional check: pausing retains the timer card; stopping hides it again. Countdown and end-after-video behavior were not changed.
4. Automated responsive QA: all timer visibility assertions pass at all eight viewports. Existing playback, Zoom, media-picker, accessibility and smart-scroll assertions also remain green. The one first-run local 404 was a static-server favicon request and is unrelated to the production bundle.

## Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: the stopped state closes the left-column gap naturally without leaving an empty card shell.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: no image or icon assets changed.
- Copy and content: unchanged; timer copy is simply absent when playback is inactive.
- Accessibility and interaction: the hidden card is removed from both the visual layout and accessibility tree via the native `hidden` state.

## Remaining findings

- No actionable P0, P1 or P2 findings.

## Final result

passed
