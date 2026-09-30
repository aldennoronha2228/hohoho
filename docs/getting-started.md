# Getting started with Wireup

Wireup is a local, single-user hardware IDE built on Velxio. Its workflow is **Ideate → Simulate → Prototype**, with Workspace, Editor, and Build pack views. Projects are saved in your browser; this repository does not include a Wireup cloud service or a released Wireup desktop app.

The [main README](../README.md#quick-start-on-windows) is the installation entry point. The [Wireup guide](../WIREUP.md) covers project storage, AI configuration, exports, and troubleshooting.

## Local development

Requirements: Node.js **22.12+** or a newer Vite-supported release, npm, Python **3.11+**, and [arduino-cli](https://arduino.github.io/arduino-cli/installation/) on `PATH`.

From the repository root in PowerShell:

```powershell
arduino-cli core update-index
arduino-cli core install arduino:avr
python -m venv backend/venv
./backend/venv/Scripts/python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
```

In one terminal:

```powershell
cd backend
./venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

In another:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**; API documentation is at **http://localhost:8001/docs**. On Linux/macOS, use `python3` and `backend/venv/bin/python` for the equivalent environment commands.

The backend installs from the process environment. A `backend/.env` file is used by Docker Compose but is not automatically loaded by the manual uvicorn command.

## Your first circuit

1. Choose **Blink an LED** or **Build a traffic light** on Workspace. A local project is created and opened in Editor.
2. Click **Sketch** to edit the firmware in Monaco.
3. Click **Simulate** to compile and start the board, then inspect the circuit or Serial Monitor.
4. Click **Stop** before changing parts or applying assistant proposals.
5. Place parts from the components library and connect their pins in **Circuit**.
6. Open **Schematic** for a read-only view of the same live connectivity. Use fit, zoom, labels, and selection to inspect it.
7. Open **Build pack** for BOM, wiring, assembly guidance, and downloads.

Use the header's sun/moon button to switch between dark and light themes. Its preference persists in this browser.

## Save and restore

Active local projects autosave after edits. A detached workspace must be saved explicitly. Use Your projects to search, open, rename, duplicate, or delete saved projects. Deletion is permanent unless you exported a backup.

Download **Project backup (`.wireup.json`)** from Build pack, then use **Import project** on Workspace to restore a copy. Legacy `.vlx` imports work, but do not retain every Wireup snapshot field. Source ZIP and CSV exports are useful build artifacts, not complete project backups.

IndexedDB storage belongs to your browser profile and origin. Different hosts/ports or browsers have separate libraries. Clearing site data or storage eviction can remove projects. There is no account sync or cross-tab conflict resolution.

## Additional board cores

The minimal setup installs AVR support. Install other cores only for the targets you intend to use:

```powershell
# RP2040 / Raspberry Pi Pico
arduino-cli config add board_manager.additional_urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
arduino-cli core install rp2040:rp2040

# ESP32 family
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32

# ATtiny targets
arduino-cli config add board_manager.additional_urls http://drazzy.com/package_drazzy.com_index.json
arduino-cli core install ATTinyCore:avr
```

Installing a core enables compilation, not every simulation path. AVR and RP2040 emulation run in the browser. ESP32 and other backend-emulated boards may need additional compiler tools, QEMU binaries, and firmware. Raspberry Pi Linux needs boot images. Upstream hosted-only catalog entries do not become local Wireup features merely because they appear in a guide.

Read [RP2040 emulation](RP2040_EMULATION.md), [ESP32 emulation](ESP32_EMULATION.md), [QEMU setup](BUILD-QEMU.md), and [boot images](BOOT_IMAGES.md) for target-specific constraints.

## AI assistance

Configure a server-side OpenAI-compatible Chat Completions provider as described in [the main README](../README.md#configure-ai-assistance). Keep keys out of frontend files and source control.

The assistant proposes edits to existing files and permitted wiring. Review before apply, reject unwanted changes, and undo only while the project revision permits it. Configuration status is not a successful provider connectivity check. Requests send prompt/project context to the configured provider and may incur charges.

## Docker from source

With Docker and Compose v2 installed, run from the repository root:

```powershell
docker compose up --build
```

Open **http://localhost:3080**. This builds Wireup from the current source; the upstream Velxio registry image is a different product build. The optional `backend/.env` can supply AI configuration. Legacy service/volume/environment identifiers remain for compatibility. Docker has not been verified in the current Windows environment.

## Verification and limitations

See [development checks](../README.md#development-and-checks) for focused unit tests, Chrome workflows, and the production Vite build. The inherited full-project TypeScript check currently has known failures.

Circuit is 2D. Schematic is derived connectivity, not electrical-rule checking or voltage analysis. Assembly instructions require manual checks for ratings, polarity, real parts, and supply voltages. Physical flashing requires supported hardware and uploader integration; physical hardware and live AI provider calls have not been verified.

Preserve [AGPLv3](../LICENSE), the Velxio copyright, and [third-party notices](THIRD_PARTY.md) when modifying or distributing Wireup.
