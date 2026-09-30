# Wireup frontend

React 19, TypeScript, and Vite 7 frontend for the Wireup hardware IDE. The app combines a Monaco firmware editor, the inherited Velxio simulation canvas, local projects, a read-only schematic, prototype exports, and reviewable AI assistance.

See the [main README](../README.md) for installation, supported-target limitations, licensing, and backend configuration. The [Wireup guide](../WIREUP.md) describes persistence and user workflows.

## Development

Use Node.js 22.12+ or a newer Vite-supported release. Run from `frontend/`:

```powershell
npm install
npm run dev
```

Open **http://localhost:5173**. The development proxy expects the FastAPI backend at **http://localhost:8001**. Start it using the [repository setup instructions](../README.md#quick-start-on-windows). Frontend preview alone cannot compile firmware or serve the AI provider.

## Current interface

- **Workspace (`/`)**: centered assistant composer, circuit starters, template gallery, and saved local projects.
- **Editor (`/editor`)**: components library, Circuit/Schematic tabs, Sketch view, simulation controls, serial/compiler output, and assistant dock.
- **Build pack (`/prototype`)**: bill of materials, wiring, assembly guidance, CSV, ZIP, and project backup exports.
- **Dark/light switch**: visible in the shell; uses the existing shared theme store and remembers the preference.

Projects are validated versioned snapshots stored in IndexedDB. The backend does not store the local project library. Prefer `.wireup.json` backups; legacy `.vlx` interchange remains supported.

## Key files

| Path | Responsibility |
| --- | --- |
| `src/wireup/Shell.tsx`, `wireup.css` | Shared shell, navigation, assistant dock, and appearance |
| `src/wireup/Home.tsx` | Templates and local project operations |
| `src/wireup/project.ts` | Snapshot validation, import/export, IndexedDB, and autosave |
| `src/wireup/Assistant.tsx`, `aiClient.ts`, `assistantProject.ts` | Provider requests, proposal review, apply/reject/undo safeguards |
| `src/wireup/Schematic.tsx`, `schematicModel.ts` | Read-only connectivity projection |
| `src/wireup/Prototype.tsx`, `prototypeModel.ts` | BOM, wiring, assembly, and archives |
| `src/pages/EditorPage.tsx` | Existing editor/simulator integration |
| `src/store/` | Shared firmware and simulator state |
| `src/lib/theme.ts`, `src/hooks/useTheme.ts` | Persistent theme state and reactive consumers |
| `src/simulation/` | Inherited CPU and electrical simulation engines |
| `src/components/velxio-components/` | Compatibility-named component wrappers |

Wokwi Elements, avr8js, and rp2040js come from npm. Their legacy technical identifiers are intentional, not remaining product branding to rename.

## Checks

```powershell
npm test -- src/wireup/__tests__
npm run test:wireup-browser
npx eslint src/wireup/Home.tsx src/wireup/Shell.tsx src/wireup/Schematic.tsx
npm run build:docker
```

Browser checks require installed Chrome plus the backend and frontend development servers. They use `http://127.0.0.1:5173` and cover user interactions, compilation/simulation, project restoration, assistant proposals with mocked responses, shared routes, and mobile/desktop themes. Verification images and logs are written to the ignored `artifacts/` directory.

`npm run lint` and `npm test` run broader inherited checks. `npm run build` includes `tsc -b`, which currently reports known inherited errors. `build:docker` generates `dist/` through Vite and prerendering without TypeScript checking; it does not prove type correctness.

Set `WIREUP_SITE_URL` before building if your deployment needs an absolute origin for prerendered metadata and sitemap URLs. No public Wireup origin is assumed.

## Constraints

- Circuit is interactive 2D, not a 3D simulation.
- Schematic does not perform electrical-rule or voltage checks.
- The assistant needs a configured server-side Chat Completions provider. Never put API keys in `VITE_*` or frontend source.
- Target support depends on installed cores, emulators, and firmware.
- Preserve the upstream AGPLv3 license, copyright, and third-party notices.
