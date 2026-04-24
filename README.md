# המאייש

Tauri + React + TypeScript + SQLite — local-first scheduling desktop app.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/rusinstall) + Visual Studio C++ Build Tools (Windows)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
cd flight_school
npm install
npm run tauri dev
```

## Production build (Windows installer)

```bash
cd flight_school
npm run tauri build
```

Artifacts appear under `flight_school/src-tauri/target/release/bundle/`.

## Project layout

| Path | Role |
|------|------|
| `src/app/` | Shell, routing, Zustand store |
| `src/features/` | Feature views (schedule, employees, …) |
| `src/shared/` | API helpers, date utilities |
| `src-tauri/src/commands/` | Tauri `invoke` handlers |
| `src-tauri/src/domain/` | Scheduling rules (violations, workload) |
| `src-tauri/src/persistence/` | SQLite via `db/` module + `migrations/` |
| `src-tauri/src/integration/` | Google Sheet CSV polling |

## Data

The SQLite file is created under the OS app data directory (e.g. `%AppData%\com.flightschool.scheduler\scheduler.db` on Windows).

Tunneling / public URL features are intentionally not implemented; remote registration links are local-only.
