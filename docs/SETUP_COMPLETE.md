# Wireup Setup Status

> **Compatibility page:** Use [README.md](../README.md) for current local setup and [WIREUP.md](../WIREUP.md) for workflows and limitations. The inherited Velxio snapshot below is historical technical context, not a verified Wireup installation checklist or release inventory.

## Current Wireup context

Wireup is local, anonymous, and single-user. **Workspace/Editor** navigation links the start page and editor, with a persistent dark/light preference. Edit components and wiring in the interactive 2D **Circuit**; **Schematic** is a derived, read-only view of the same project, not electrical verification.

Active local projects autosave to browser IndexedDB. Prototype's **Build pack** exports `.wireup.json` backups, source ZIP, BOM/wiring CSVs, and a derived assembly checklist; these do not certify hardware or supply compiled firmware. Legacy `.vlx` interchange remains available.

The optional AI assistant requires backend process environment configuration (`WIREUP_AI_API_KEY`, optionally `WIREUP_AI_BASE_URL` and `WIREUP_AI_MODEL`). Review before apply, reject proposals, or undo an applied proposal if no newer edit/history action has followed; stop simulations before apply/undo. Live provider and physical hardware compatibility are not established by this page.

Basic setup installs AVR compilation support; other targets require their own cores, firmware, or backend toolchains. Upstream hosted accounts/Pro, licensed Tauri desktop, trials, and published upstream images below are not shipped Wireup services or releases. There is no assumed public Wireup demo or commercial release.

## Inherited Velxio snapshot

| Area | Status |
|------|--------|
| Boards | 19 across 5 CPU architectures (AVR, RP2040, Xtensa, RISC-V, ARM) |
| Components | 152+ catalog parts across 11 categories |
| Digital simulation | Real CPU emulation on every board (avr8js, rp2040js, lcgamboa QEMU, upstream QEMU) |
| Analog simulation | ngspice WASM with NetlistBuilder + AVR/ESP32 bridges (toolbar toggle) |
| Custom chips | C-to-WASM SDK + 30+ example chips (Intel 4004/8080, Z80, 74HC595, EEPROM, …) |
| Languages | Arduino C++, ESP-IDF C, MicroPython, Python 3 (Pi) |
| Apps | Web (OSS + Pro), Tauri desktop |
| MCP server | stdio + SSE, 7 tools |
| Examples | 380+ across 7 collections |
| Persistence | `.vlx` portable JSON snapshot (no server-side state in OSS) |
| Deploy | Single-container Docker image (GHCR + Docker Hub), Docker Compose for build-from-source |

## See also

- [Roadmap](./roadmap.md) — Full feature list, in-progress and planned items
- [Architecture](./ARCHITECTURE.md) — System overview
- [Emulator Architecture](./emulator.md) — Per-CPU-backend details
- [Components Reference](./components.md) — Catalog by category
- [Desktop App](./desktop-app.md), [MCP Server](./MCP.md)
