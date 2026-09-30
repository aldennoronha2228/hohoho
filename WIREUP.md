# Wireup user and operations guide

See [README.md](README.md) for the project overview and quick start, and [the documentation index](docs/intro.md) for technical references.

Wireup is a local hardware IDE built on [Velxio](https://github.com/davidmonterocrespo24/velxio). Write Arduino or MicroPython code, connect components, compile firmware, and inspect the simulation. The open-source build is anonymous and single-user; it does not include the upstream hosted service's accounts, subscriptions, or private Pro overlay.

## Start on Windows (PowerShell)

Prerequisites: Node.js 22.12+ (or a supported newer release), npm, Python 3.11+, and [arduino-cli](https://arduino.github.io/arduino-cli/installation/) available on `PATH`. Internet access is needed for the initial dependencies, board cores, and sketch libraries.

From this repository root:

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

In terminal 1, start the compilation backend:

```powershell
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

In terminal 2, start the frontend:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**. The API documentation is at **http://localhost:8001/docs**. Calling the virtual environment's Python directly avoids PowerShell activation-policy issues. On Linux/macOS use `python3 -m venv backend/venv` and `backend/venv/bin/python` instead.

The dev command generates component assets before starting Vite. Official Wokwi emulation libraries come from npm; local third-party clones are not required to start. The optional metadata source clone may be absent; the committed component metadata is used in that case.

## Ideate → Simulate → Prototype

### Workspace: ideas and local projects (`/`)

The interface retains the centered Wireup start page with left navigation, a prompt composer, starter chips, visual templates, and local projects. The compact Workspace/Editor links switch between the start page and circuit editor. A visible sun/moon button switches between dark and light themes and remembers the preference in this browser. The editor provides a component library, circuit workspace, Sketch toggle, compact Simulate/Stop controls, and a docked assistant. **Circuit is Velxio's interactive 2D view, not a 3D renderer.** **Schematic** is a read-only projection of actual boards, components, wired pins, and connected nets, with pan/zoom/fit, labels, highlighting, and BOM CSV export. It does not perform electrical-rule checks or display inferred voltage measurements. Add parts or edit wiring in Circuit; both surfaces share the same live project.

Choose a starter template to create a saved local project and open the simulator, or use **Your projects** to search, open, rename, duplicate, or delete projects. Import accepts Wireup `.wireup.json` backups and legacy `.vlx` files. Imports receive new project IDs rather than overwriting an existing project; deletion is permanent unless you have a backup. The Assistant is available on the home page and from the shell, but requires the provider configuration below.

### Editor: firmware and circuit (`/editor`)

Edit the multi-file workspace, add boards/components, connect pins, then compile and run. Inspect compiler output and the Serial Monitor. The editor's Save action creates or updates a local Wireup project. Once a project is active, changes to the circuit, editor groups/tabs, and virtual filesystem are autosaved after an approximately 800 ms debounce. The editor toolbar shows the project name and an unsaved marker; transient notices report saving and errors. A bare, detached workspace is **not** automatically made into a saved project: save it explicitly or start from a template.

Projects are versioned, validated JSON snapshots in **IndexedDB** (`wireup-projects`, object store `projects`); `localStorage` holds the active-project restore hint and appearance preferences. Direct visits/reloads to `/editor` or `/prototype` attempt to reopen that last active project. Detaching the workspace or deleting its active project clears the hint; detaching leaves the saved project and current canvas intact. Opening a saved project restores files/folders and editor tabs, boards/options/libraries/baud rates, components/wires, SD/SPIFFS uploads, and virtual filesystem data. It resets electrical simulation state rather than resuming a running CPU session. Loading an unrelated upstream project/example detaches the local identity so later saves do not overwrite the old local project.

Storage belongs to this **browser profile and origin**, not an account or the compilation server. Changing host/port, switching browsers, private browsing, storage eviction, or clearing site data can make projects unavailable. No cloud sync, cross-tab conflict resolution, or guaranteed save-on-browser-close is implemented. Check the saved status and export backups before clearing browser data. If localStorage is unavailable, IndexedDB saves can still succeed, but the restore hint may not be retained.

AVR and RP2040 CPU emulation runs in the browser. Compilation still needs the backend and a matching installed board core. ESP32, STM32, Raspberry Pi Linux, and other backend-emulated targets need additional toolchains, firmware, or QEMU support; the basic Arduino setup above does not install those. See [the existing architecture and setup documentation](docs/getting-started.md) for target-specific details. Existing WiFi names such as `Velxio-GUEST` are technical emulator contracts, not Wireup branding mistakes.

### Build pack: prepare a prototype from the live circuit (`/prototype`)

Build pack derives a grouped bill of materials, pin-to-pin wiring list, and assembly checklist from the **current workspace**, including unsaved edits. Virtual instruments/junctions are excluded from the physical BOM, but their connections remain in the wiring list. Canvas distances are not physical wire lengths; component ratings, real part availability, junction implementation, polarity, and supply voltages require manual verification. Checklist ticks are view-local, not persisted electrical verification.

Download:

- **Project backup** (`.wireup.json`): the importable local project snapshot. Use Workspace → Import project to restore a copy.
- **Source archive** (`.sources.zip`): grouped firmware and folders, library lists, SD/SPIFFS uploads, virtual filesystem files, and `circuit.json`. This is a build pack, not a compiled firmware image or a replacement for the full project backup.
- **Bill of materials / Wiring CSV**: spreadsheet-ready parts and connections.

Legacy `.vlx` remains supported for interchange, but does not retain the full Wireup editor/VFS snapshot or all board options/uploads. Prefer `.wireup.json` for backups. Build pack also opens the existing compile-before-flash dialog for configured hardware targets; it does not upload automatically. Pure OSS browser builds generally need the desktop uploader or an installed Web Serial overlay; supported RP2040 targets offer a `.uf2` download for BOOTSEL. **No physical hardware flashing or electrical behavior has been verified in this audit.** Simulation and assembly guides are not electrical safety certification.

## Configure the real AI provider (optional)

The backend makes real requests to an **OpenAI-compatible Chat Completions** provider; this is not a canned/demo assistant. Before starting uvicorn, set backend process environment variables in terminal 1:

```powershell
$env:WIREUP_AI_API_KEY = '<your-provider-key>'
$env:WIREUP_AI_BASE_URL = 'https://api.openai.com/v1'
$env:WIREUP_AI_MODEL = 'gpt-4o-mini'
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Only `WIREUP_AI_API_KEY` is required; the base URL and model above are the defaults. The API root must be HTTP(S) without credentials, query, or fragment; the backend appends `/chat/completions` and sends Bearer authentication, `response_format: {type: "json_object"}`, and `max_tokens`. Your provider/model must support that contract; this is not a native Responses API or Azure-specific endpoint adapter. For Docker Compose, put these variables in the optional `backend/.env` passed to the container and recreate the service. Do not put provider secrets in `VITE_*`, frontend files, or source control. Manual uvicorn startup uses process environment variables; do not assume it loads `backend/.env` automatically.

Check `/api/wireup-ai/status` (also `/api/wireup-ai/config`) or the Assistant's **Check configuration** button. Configuration status checks the URL/key/model settings, **not** connectivity, authentication, quota, or model availability. No key is sent to the browser. On prompt submission, `/api/wireup-ai/proposals` sends your prompt and current source files, board/libraries, component IDs/rendered pin names, and wire context to the configured provider. Provider data policies and usage charges apply; AI is not offline.

Review complete file replacements and proposed wire additions/removals before **Apply reviewed changes**, or reject them. The assistant can modify only existing files and connect existing rendered pins/remove permitted wires; it cannot invent boards/components, compile, simulate, or certify a circuit. Open Editor for pin-aware suggestions. Stop all simulations before apply/undo. Revision checks reject stale proposals, and undo is available only while no newer project edit/history action has followed. Cancellation prevents applying the response but may not stop provider processing. Missing configuration, invalid responses, timeouts, rate limits, and provider errors are reported without applying a proposal. **Live AI provider calls have not been verified in this audit; mocked tests do not establish live provider compatibility.**

## Docker alternative

With Docker Desktop running and Compose v2 available:

```powershell
docker compose up --build
```

Open **http://localhost:3080**. The first image build downloads large toolchains and may take a long time. The optional `backend/.env` is not required for the OSS workflow. Compose service, volume, and image identifiers still use legacy upstream names for compatibility; an upstream prebuilt image is not a Wireup-branded build. Stop with `docker compose down`.

## Build and checks

Run from `frontend/`:

```powershell
npm test
npm run lint
npm run build:docker
```

`build:docker` creates `dist/` with Vite and prerendering, without TypeScript checking. `npm run build` additionally runs `tsc -b`. The baseline typecheck is currently failing across upstream tests and simulator/component types (including mock callback types, complex-number types, missing declarations, and custom-element JSX types); Vite-only success is not a clean TypeScript build. In this audit, `npx tsc -b --pretty false --incremental false` produced 354 diagnostics, identical to the existing `frontend/artifacts/typescript-final.log` baseline, with none in `src/wireup/`. These unrelated issues were not fixed. `npm run preview` previews the frontend build, but is not a replacement for the compilation backend or a full production deployment.

Focused workflow checks:

```powershell
# From frontend/
npm test -- src/wireup/__tests__
# From backend/, with pytest installed in its virtual environment:
./venv/Scripts/python.exe -m pytest tests/test_wireup_ai.py -q
```

Verified on Windows with installed Chrome: Arduino sketch compilation/run/stop; project creation, rename, duplicate, delete/cancel, backup import and invalid-import feedback; reload restoration; wired-circuit BOM/wiring/assembly; CSV/ZIP/project downloads; assistant configuration and review/apply/undo/reject using a mocked response; example detail/editor and error routes, localized routes, About, image-to-code, and desktop/mobile layout checks. The workflow, regression, and dark/light browser scripts completed without page errors. The production `npm run build:docker` passed, including 324 prerendered pages. Focused tests passed: 47 frontend and 21 backend. The reference-layout browser checks additionally cover Sketch editing/save/reload, component placement/undo, schematic controls and BOM download, empty and unwired schematic states, advanced tools, and Workspace sidebar navigation and persistent dark/light behavior at desktop and mobile sizes.

Repeat browser checks with both dev servers running and Chrome installed:

```powershell
# From frontend/; uses http://127.0.0.1:5173
npm run test:wireup-browser
```

Persistence unit tests mock the IndexedDB adapter and store-loading methods; browser checks cover observed save/restore behavior but do not guarantee storage durability. AI tests use mocked providers, not a live paid service. No physical hardware or live AI provider was verified.

For an absolute sitemap/prerender origin on your own deployment, set `WIREUP_SITE_URL` before building, for example `$env:WIREUP_SITE_URL = 'https://your-domain.example'`. The default build origin is `http://localhost:5173`; runtime page metadata uses the current browser origin. Static social image paths are same-origin. Configure absolute social URLs and crawler settings for your production domain before publication; no Wireup public domain is assumed.

## Troubleshooting

- **Compilation cannot connect:** verify that terminal 1 is running on port 8001 and check `/docs`. Keep Vite on the supported development ports (5173–5175) or adjust the backend CORS configuration intentionally.
- **Board core missing:** install the core matching the selected board; `arduino:avr` is the minimal Arduino Uno setup, not an all-board installation.
- **Missing sketch library:** install it with the Library Manager or `arduino-cli lib install "Library Name"`.
- **TypeScript build errors:** the baseline typecheck remains failing; use the documented Vite-only build for runtime checks without treating it as typecheck success.
- **Local save/restore errors:** check browser storage permissions and the shell status. Export a `.wireup.json` backup from Build pack; projects are not stored on the compilation backend.
- **Assistant unavailable:** set backend `WIREUP_AI_API_KEY`, confirm the API root/model support JSON Chat Completions, and check configuration. A configured status alone does not verify the provider.
- **Old icon after updating:** clear the favicon cache or remove/reinstall an existing home-screen shortcut.
- **Offline use:** cache/install dependencies, cores, firmware, and needed libraries first. Some targets or optional integrations require downloads or network access.

## Credits and licenses

Wireup is a derivative of Velxio by David Montero Crespo and contributors, not the official Velxio service. The original copyright and [GNU AGPLv3 license](LICENSE) remain intact; rebranding does not remove copyleft obligations or confer a commercial license. Preserve all third-party notices. A distributed or publicly hosted modified build must offer its complete corresponding source as required by the license, including Wireup changes—not just a link to upstream.

The app includes [About Wireup and acknowledgments](frontend/public/about.html), served at `/about.html`. It credits Velxio, Wokwi's MIT-licensed emulators and components, ngspice, QEMU, arduino-cli, the application libraries, and licensed artwork. The Wireup connected-circuit W favicon is an original drawing. Legacy imports, custom-element names, `.vlx` format identifiers, storage keys, and API contracts are intentionally preserved.
