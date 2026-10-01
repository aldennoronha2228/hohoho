# Workflow report comparison

Source: user-supplied **Tinkered AI: Hands-on Workflow Test Report**, dated October 1, 2026. This is a hands-on account of one test session, not independently verified competitor functionality or permission to copy its implementation.

## Functional requirements adopted

| Report finding | Wireup implementation direction |
| --- | --- |
| Natural-language request becomes one coherent project | Keep the existing single-model tool loop, circuit/editor state and build conversation |
| Visible component selection and pin assignments | Real catalog searches, tool activity, actual parts and wiring; no invented component lists |
| Board-specific source files and successful compiler output | Existing editor groups and compiler; do not mandate PlatformIO files when Wireup uses arduino-cli |
| Generated projects appear in Projects and survive navigation | Save/name the actual workspace before building and persist a per-project conversation locally |
| Simulator offers controls and observable runtime | Existing circuit canvas, Serial Monitor, simulation state, start/stop and elapsed runtime |
| Build/compile checks are visible | Actual recorded tool results, current circuit verification findings and clear unverified scope |
| Deployment requires board authorization | Reuse existing FlashModal and actual supported board/uploader integration; no automatic AI flashing |
| Optional BOM/assembly documentation | Existing live Build pack and source/CSV/project exports; documentation never consumes fictional credits |
| Themes and preferences | Existing persistent dark/light state and translations |

## Behaviors explicitly not copied

- Account signup, payment/credit balances, usage reset dates, and cloud ownership claims: Wireup is currently local/single-user and has no such backend.
- A 3D canvas: Wireup uses the real existing Velxio 2D canvas. A replacement renderer is outside this workflow change.
- Claimed universal board/component coverage: show the actual available catalog and locally configured capabilities.
- Generic “safety passed” badges: existing checks are model-limited; convergence alone is not electrical certification.
- Fake “thought” events or private reasoning: expose actual operations and results instead.
- Optional docs reported as tested: the report explicitly says BOM/assembly/README generation was declined.
- A broken schematic beta: Wireup's schematic must remain functional and tied to current data.

## Test to reproduce

Prompt: **Make an LED blink on and off once per second using an Arduino Uno on a half-size breadboard.**

Verify actual supported breadboard availability before placement; use the real metadata ID and exact rendered pins. Confirm LED and resistor seating/wiring, actual board-target firmware, compilation, simulator run/stop, saved project restoration, conversation restoration, and current Build pack. Physical flashing is unverified unless a real compatible board is connected and authorized.

Timing must be stated precisely: one second HIGH plus one second LOW gives a **two-second period (0.5 Hz)**. The report's “1 Hz” wording is inconsistent with its described loop. Do not reproduce that mismatch.

Reported competitor issues (template target mismatch, blank schematic, contradictory onboarding) become regression cases to avoid, not features to copy.
