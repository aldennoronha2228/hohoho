# Wireup

**A local hardware IDE for firmware, circuit simulation, and prototype preparation.**

Wireup brings a code editor, interactive circuit canvas, project library, and reviewable AI assistance into one workspace. It is built on [Velxio](https://github.com/davidmonterocrespo24/velxio), with the original simulation engines and licensing retained.

**Ideate → Simulate → Prototype**

- **Workspace:** start from a circuit template, ask for design assistance, or open a saved project.
- **Editor:** edit firmware, place components, connect pins, compile, run, and inspect serial output.
- **Build pack:** inspect the bill of materials, wiring list, and assembly checklist; download project backups, source archives, and CSV files.

The app is single-user and anonymous. Projects are saved in your browser, not a cloud account. A visible **dark/light switch** remembers your appearance preference. This repository does not provide a public Wireup service, subscriptions, or a released desktop application.

## Features

### Firmware and simulation

- Monaco editor with multi-file Arduino C++ and supported Python/MicroPython workflows.
- Existing Velxio interactive **2D circuit canvas**, component library, pin-aware wiring, and editing history.
- Real firmware compilation through the FastAPI backend and installed toolchains.
- Browser CPU emulation for AVR and RP2040; additional backend emulators require their own setup.
- Compact Simulate/Stop controls, Sketch view, compiler output, Serial Monitor, and access to advanced tools.
- Built-in examples and Arduino Uno starters for LEDs, traffic lights, servos, and potentiometers.

### Schematic and prototype preparation

- **Schematic** projects the live circuit's actual parts, wired pins, routes, and connected nets into a read-only sheet.
- Pan, zoom, fit, labels, selection highlighting, and bill-of-materials CSV export.
- **Build pack** derives a physical bill of materials, pin-to-pin wiring list, warnings, and assembly checklist from the current workspace.
- `.wireup.json` project backups, `.sources.zip` source archives, and BOM/wiring CSV downloads.
- Existing compile-before-flash controls for supported targets; uploading depends on the target and installed uploader support.

Schematic is a connectivity view, not electrical-rule checking or voltage analysis. Simulation and generated assembly instructions do not certify a physical circuit's safety. Wireup does not include a 3D circuit renderer.

### Local projects

- Create, search, open, rename, duplicate, and delete projects.
- Versioned, validated snapshots saved in IndexedDB, with autosave for active projects.
- Restore firmware files, editor layout, board options, libraries, components, wiring, uploads, and virtual filesystem data.
- Reopen the last active project on direct visits to the editor or build pack.
- Import Wireup backups and legacy `.vlx` projects. Prefer `.wireup.json` for complete Wireup backups.

Browser storage can be cleared or evicted. Export backups before clearing site data or switching browsers. There is no cloud sync or cross-tab conflict resolution.

### Reviewable AI assistance

The optional assistant uses a server-side **OpenAI-compatible Chat Completions** provider. It proposes changes to existing firmware files and permitted wiring between existing pins. Review the proposal, apply or reject it, and undo it while the project revision still permits undo.

The assistant cannot autonomously add hardware, compile, simulate, flash, or verify electrical safety. It reports missing configuration and provider failures rather than presenting a simulated response as a real result. Live provider compatibility depends on your chosen service and model.

## Quick start on Windows

### Requirements

- Node.js **22.12+**, or a newer version supported by Vite 7, and npm.
- Python **3.11+**.
- [arduino-cli](https://arduino.github.io/arduino-cli/installation/) on `PATH`.
- Internet access for the initial packages, board cores, and libraries.

Run from your local Wireup repository root in PowerShell:

```powershell
arduino-cli version
arduino-cli core update-index
arduino-cli core install arduino:avr

python -m venv backend/venv
./backend/venv/Scripts/python.exe -m pip install -r backend/requirements.txt

cd frontend
npm install
cd ..
```

Start the backend in one terminal:

```powershell
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Start the frontend in another terminal:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**. The backend API documentation is at **http://localhost:8001/docs**.

Calling the virtual environment's Python directly avoids PowerShell activation-policy issues. On Linux/macOS, use `python3 -m venv backend/venv` and the executable at `backend/venv/bin/python`.

### First project

1. Open Workspace and choose **Blink an LED** or **Build a traffic light**.
2. In Editor, use **Sketch** to inspect or edit the firmware.
3. Click **Simulate**, inspect the circuit and serial output, then click **Stop**.
4. Switch to **Schematic** to inspect connectivity. Edit parts and wiring in **Circuit**.
5. Open **Build pack** to inspect the BOM, wiring, and assembly guidance.
6. Download a **Project backup** before relying on browser storage alone.

The minimal setup above is for Arduino AVR projects. Other targets need matching cores and, where applicable, firmware, QEMU, or additional compiler toolchains.

## Supported boards

Wireup retains the upstream board and component infrastructure. Availability in the catalog is not a guarantee that a target is configured on your computer.

| Target family | Simulation | Additional requirements |
| --- | --- | --- |
| Arduino AVR, including Uno/Nano/Mega and ATtiny targets | Browser, using avr8js | Matching Arduino core; ATtiny requires its board-manager package |
| Raspberry Pi Pico / supported RP2040 targets | Browser, using rp2040js | RP2040 core and appropriate firmware for the selected language |
| Supported ESP32 variants | Backend emulation | Matching cores/toolchains, QEMU libraries, and firmware |
| STM32, Raspberry Pi Linux, and other catalog targets | Target-specific backend/integration | Additional emulator binaries, boot images, or upstream integrations; not established by the basic setup |

See [Getting started](docs/getting-started.md) for extra board cores, [ESP32 emulation](docs/ESP32_EMULATION.md), [RP2040 emulation](docs/RP2040_EMULATION.md), and [QEMU setup](docs/BUILD-QEMU.md). Upstream hosted/desktop-only features described in inherited guides are not Wireup release promises.

## Configure AI assistance

Set environment variables in the terminal that starts the backend:

```powershell
$env:WIREUP_AI_API_KEY = '<your-provider-key>'
$env:WIREUP_AI_BASE_URL = 'https://api.openai.com/v1'
$env:WIREUP_AI_MODEL = 'gpt-4o-mini'
```

Then start or restart the backend. Only the API key is required; the URL and model above are the defaults. The backend appends `/chat/completions`, uses Bearer authentication, and requests JSON output. Your provider must support this contract; a native Responses API endpoint is not interchangeable.

Use the assistant's **Check configuration** button or **http://localhost:8001/api/wireup-ai/status**. A configured status confirms settings, not successful authentication, quota, or model access.

Keys stay on the backend. Never place them in `VITE_*`, frontend code, or committed files. Submitting a request sends your prompt and project context to the provider, whose usage charges and data policies apply. See [the detailed configuration guide](WIREUP.md#configure-the-real-ai-provider-optional).

## Docker

With Docker Desktop or a compatible Docker Engine and Compose v2:

```powershell
docker compose up --build
```

Open **http://localhost:3080**. This builds Wireup from this checkout. An upstream Velxio prebuilt image does not include these Wireup changes.

`backend/.env` is optional and can supply the AI environment variables. Existing Compose service names, volume names, and `VELXIO_*` options are retained for compatibility. The initial build downloads substantial dependencies. Docker deployment has not been verified in the current Windows environment.

Stop with `docker compose down`. Browser-local Wireup projects remain separate from backend volumes.

## Development and checks

From `frontend/`:

```powershell
npm test -- src/wireup/__tests__
npm run test:wireup-browser
npm run build:docker
```

The browser checks need installed Chrome and both development servers running; they use **http://127.0.0.1:5173**. They exercise real compilation/run/stop, project operations, editing/restoration, schematic controls, assistant review flows with mocked responses, and desktop/mobile dark/light behavior.

From `backend/`, with pytest installed in the virtual environment:

```powershell
./venv/Scripts/python.exe -m pytest tests/test_wireup_ai.py -q
```

`npm run build:docker` builds Vite assets and prerendered pages **without TypeScript checking**. `npm run build` also runs `tsc -b`; the inherited full-project typecheck currently has known failures. A successful Vite build is not a clean TypeScript result. Full upstream lint/test suites may also require their own dependencies or integration setup.

The current Wireup verification passed **47 focused frontend tests**, the production Vite build, and Chrome workflow checks without page errors. AI review tests use mocked providers; physical flashing and live AI provider calls have not been verified.

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/src/wireup/` | Wireup shell, start page, local projects, assistant, schematic, and build pack |
| `frontend/src/pages/EditorPage.tsx` | Circuit/code editor integration |
| `frontend/src/components/`, `frontend/src/simulation/` | Shared editor, components, and inherited simulation engines |
| `backend/app/` | Compilation APIs, emulation services, and Wireup AI endpoint/provider |
| `frontend/scripts/wireup-*.mjs` | Chrome workflow and regression checks |
| `docs/` | Setup, architecture, board emulation, and inherited technical references |
| `WIREUP.md` | Detailed workflow, persistence, configuration, and troubleshooting guide |

## Documentation

- [Getting started](docs/getting-started.md)
- [Wireup user and operations guide](WIREUP.md)
- [Documentation index](docs/intro.md)
- [Frontend development](frontend/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Components](docs/components.md) and [example projects](docs/examples/README.md)
- [Third-party notices](docs/THIRD_PARTY.md)
- [Changes](CHANGELOG.md)

For deployment metadata, set `WIREUP_SITE_URL` before building. No public Wireup domain is assumed; see [deployment notes](WIREUP.md#build-and-checks).

## Credits and license

Wireup is a modified derivative of **Velxio**, copyright © 2025 **David Montero Crespo** and contributors. It is not the official Velxio service and is not affiliated with Tinkered AI or other products that inspired its workflow.

The original [GNU AGPLv3 license](LICENSE) and upstream notices remain intact. Preserve third-party licenses and provide the complete corresponding source of your modified build as required by AGPLv3, including Wireup changes. Rebranding does not grant permission to distribute proprietary derivatives.

[COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) describes the upstream author's separate licensing offering; this checkout does not establish a commercial license for Wireup or rights to private hosted/desktop features.

Thanks to Velxio, Wokwi Elements, avr8js, rp2040js, ngspice, QEMU, Monaco, arduino-cli, and the other dependencies and artwork credited in [Third-party notices](docs/THIRD_PARTY.md) and [About Wireup](frontend/public/about.html). Legacy custom-element names, SDK symbols, storage keys, `.vlx` files, and API identifiers remain intentionally unchanged.
