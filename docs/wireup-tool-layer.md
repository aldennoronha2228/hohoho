# Wireup Tool Layer

This is a browser-local internal adapter for existing Wireup operations. It is not an AI agent, HTTP execution endpoint, or replacement MCP server. The existing Assistant review flow and standalone MCP tools remain unchanged.

## Entry points

Import from `frontend/src/wireup/tools/index.ts`:

```ts
import { executeWireupTool, get_firmware, set_firmware } from './wireup/tools';

const firmware = await get_firmware();
const result = await executeWireupTool('search_components', { query: 'resistor' });
```

Every operation returns a Promise of a JSON-compatible result:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": "The operation could not be completed." }
```

Named functions accept the positional arguments below. `executeWireupTool(name, args)` accepts an object using the same parameter names, rejects unknown tools/extra fields, and exposes no Zustand handles. Future AI integrations should import this adapter, not frontend stores.

## Existing functionality reused

| Tool | Arguments | Existing implementation |
| --- | --- | --- |
| `get_project_state` | None | `captureProjectSnapshot()` and current project/session; actual rendered pin metadata through `readPinInfo()` |
| `search_components` | `query` | `ComponentRegistry.load()` and ranked `search()` over the production catalog |
| `add_component` | `component_type`, optional `position: {x,y}` | `createComponentFromMetadata()` + `recordAddComponent()`; registered boards use `addBoard()` and the existing board gate |
| `remove_component` | `component_id` | `recordRemoveComponent()` or `removeBoard()`; existing cascade removes attached wires |
| `set_component_property` | `component_id`, `property`, `value` | Production property descriptors + `updateComponent()` and `recordSetProperty()`/`recordRotate()` |
| `connect` | `from_component`, `from_pin`, `to_component`, `to_pin` | `readPinInfo()`, `calculatePinPosition()`, `startWireCreation()`/`finishWireCreation()` including existing obstacle routing, then existing undo history |
| `disconnect` | `wire_id` | `recordRemoveWire()`; automatic breadboard seating wires are protected |
| `get_firmware` | None | Existing editor file groups through `getGroupFiles()` |
| `set_firmware` | `file`, `content` | `setFileContent()` or `updateGroupFile()`; updates an existing file, preserving editor build invalidation |
| `compile_firmware` | None | Mounted `EditorToolbar` compile handler and existing compilation transport |
| `start_simulation` | None | Mounted `EditorToolbar` run handler, existing gates/preflight/compiler, and simulator start |
| `stop_simulation` | None | Mounted `EditorToolbar` stop handler; stops all running boards and clears custom-chip drives |
| `get_simulation_state` | None | Actual per-board running/program/boot/engine state and electrical pause |
| `get_serial_output` | None | Actual existing per-board and active serial monitor text, not fabricated/raw UART data |

## Validation and scope

- Component types come from the real registry or registered board definitions. There is no tool-specific component list.
- Positions must be finite numbers. Missing positions use the current library's placement convention.
- Wiring requires existing components and exact rendered pin names. Unmounted parts report an error; pins are not invented from `pinCount`.
- Self-connections and existing connections in either direction are rejected. Occupied breadboard holes report an error rather than silently choosing a different requested pin.
- An in-progress interactive wire is never overwritten. The underlying wire creator uses unique IDs so rapid operations cannot collide.
- Property descriptors validate types, options, and numeric bounds. Rotation is limited to 0/90/180/270. Internal/prototype keys are rejected. Board settings are outside the component-property tool's scope.
- Firmware uses stable file IDs returned by `get_firmware`; an unambiguous filename is also accepted. Unknown or ambiguous files fail rather than creating or overwriting another group's file.
- Mutation tools refuse edits while boards are running or a build/start operation is in progress.
- Results are detached JSON snapshots, not live object references, functions, simulator instances, or mutable stores.

## Runtime ownership

`runtime.ts` is an ownership-safe registration point. The mounted editor provides compile/start/stop handlers; tools do not instantiate simulators or open separate simulation sockets. Compiler/simulation tools report unavailable outside the editor. Read tools can inspect the existing workspace without mounting a second engine.

Tool-controlled MicroPython loading currently returns an explicit unsupported-operation error, because the existing loader can mutate its runtime across awaits without an intent guard. The editor's original MicroPython controls remain unchanged; no alternate loader or fake compilation is introduced.

Compilation and start target the **active board**, matching the compact editor's existing commands. Stop is project-wide, matching the existing Stop behavior. Starting a backend board reports its real running state, not a guarantee that its guest firmware/Linux has finished booting; inspect `pi_booted` and serial output as appropriate.

The runtime preserves circuit preflight and existing access gates. Tools do not automatically accept a Run-anyway decision. Stop, editor teardown, and changed build inputs invalidate pending tool intent; server compilation may finish, but superseded results must not be applied or start a board later. No server-side compile cancellation is claimed.

## Verification

From `frontend/`:

```powershell
npm test -- src/wireup/__tests__/tools.test.ts src/__tests__/undo-redo.test.ts
node scripts/wireup-tools.mjs
npm run build:docker
```

The Chrome script needs Chrome and the existing backend/frontend development servers at ports 8001/5173. It uses actual catalog, component, wire, firmware, compiler, and simulator implementations, including invalid compilation and pending-operation checks. Unit tests isolate the runtime boundary where appropriate; those mocks do not establish real compilation or simulation success.

See [Wireup setup](../README.md) for server commands and [the operations guide](../WIREUP.md) for hardware/AI limitations.
