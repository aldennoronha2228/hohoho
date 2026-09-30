# Wireup documentation

Wireup is a local hardware IDE built on Velxio. **Workspace** brings together design assistance, circuit templates, and saved projects. **Editor** combines firmware, an interactive 2D circuit, a read-only schematic, and simulation tools. **Build pack** derives BOM, wiring, assembly guidance, and exports from the current workspace. Dark and light themes are available throughout the shell.

## Start here

- [README](../README.md): overview, installation, features, requirements, and licensing.
- [Getting started](getting-started.md): first circuit and additional target setup.
- [Wireup guide](../WIREUP.md): persistence, project recovery, AI configuration, exports, checks, and troubleshooting.
- [Frontend development](../frontend/README.md): current UI structure and test commands.
- [Architecture](ARCHITECTURE.md): Wireup integration and inherited simulator internals.
- [Changes](../CHANGELOG.md) and [roadmap](roadmap.md).

## Simulation and hardware references

These guides contain inherited Velxio implementation details. Legacy SDK names, custom elements, environment variables, paths, WiFi names, and upstream links remain intentional. Historical hosted/desktop features and setup reports describe upstream contexts; they are not promises of a Wireup public service, desktop release, or configured local board.

- [Emulator architecture](emulator.md)
- [RP2040 emulation](RP2040_EMULATION.md) and [Pico W WiFi](PICO_W_WIFI_EMULATION.md)
- [ESP32 emulation](ESP32_EMULATION.md), [WiFi/Bluetooth](ESP32_WIFI_BLUETOOTH.md), and [ESP32-C3 WiFi/Bluetooth](ESP32C3_WIFI_BLUETOOTH.md)
- [RISC-V emulation](RISCV_EMULATION.md)
- [Raspberry Pi emulation](RASPBERRYPI3_EMULATION.md) and [boot images](BOOT_IMAGES.md)
- [MicroPython implementation](MICROPYTHON_IMPLEMENTATION.md)
- [QEMU build](BUILD-QEMU.md)
- [Components](components.md), [example projects](examples/README.md), and [component datasheets](wiki/component-datasheets.md)

## Electrical simulation and components

The inherited electrical engine has its own model coverage and limitations. Wireup's Schematic tab only projects connectivity; it is not an electrical-rule checker or voltage analyzer. Simulation does not establish physical electrical safety.

- [Electrical simulation user guide](wiki/electrical-simulation-user-guide.md)
- [Circuit emulation overview](wiki/circuit-emulation-overview.md), [architecture](wiki/circuit-emulation-architecture.md), and [model coverage](wiki/circuit-emulation-components.md)
- [ngspice integration](wiki/circuit-emulation-ngspice.md), [performance](wiki/circuit-emulation-performance.md), and [gotchas](wiki/circuit-emulation-gotchas.md)
- [Board buses](wiki/board-buses.md) and [part authoring](wiki/board-buses-part-authoring.md)
- [Component metadata generation](wiki/component-metadata-generator.md)

## Custom chips and integrations

- [Custom chip guide](CUSTOM_CHIPS.md), [API](wiki/custom-chips-api-reference.md), [examples](wiki/custom-chips-examples.md), and [build/test](wiki/custom-chips-build-and-test.md)
- [ESP32 chip runtime](wiki/custom-chips-esp32-backend-runtime.md) and [chip nets](wiki/custom-chips-chip-nets.md)
- [MCP integration](MCP.md): inherited Model Context Protocol server; separate from Wireup's in-app assistant.
- [Docker infrastructure](wiki/docker-infrastructure.md)
- [Desktop reference](desktop-app.md) and [analytics reference](analytics.md): upstream integration documentation, not a Wireup release or service.

## Credits and license

Wireup retains the original Velxio copyright and [GNU AGPLv3 license](../LICENSE). Read [third-party notices](THIRD_PARTY.md) and [About Wireup](../frontend/public/about.html). The [upstream source](https://github.com/davidmonterocrespo24/velxio) is credited as the foundation; its hosted service is distinct from this repository.
