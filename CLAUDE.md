# BulkSSH

A program for connecting to multiple SSH clients at once (see [README.md](README.md)).

## Project status

Phase 0 (scaffold) is done: an empty app window with placeholder layout. Next is Phase 1 (single-device SSH connect). The plan is in [.projectPlan/PLAN.md](.projectPlan/PLAN.md); read it before making architectural decisions.

## Stack

- **App:** Electron + TypeScript, React for the UI
- **Terminal / SSH:** `xterm.js` (terminal UI) + `ssh2` (SSH client); not installed yet, added in Phase 1
- **Bundler:** `electron-vite` (Vite for main, preload and renderer)
- **Tests:** Vitest
- **Packaging:** electron-builder (Windows NSIS installer + portable)

v1 is SSH only, but all connections go through a transport interface so telnet, serial, and SFTP can be added later (see the Future roadmap in the plan). Do not couple UI or session code directly to `ssh2`. SSH runs in the Electron main process and the renderer reaches it over IPC.

## Commands

- `npm run dev`: run the app with hot reload
- `npm run typecheck`: type-check main/preload and renderer separately
- `npm test`: run Vitest once (`npm run test:watch` to watch)
- `npm run build`: typecheck and build to `out/`
- `npm run dist`: build a Windows installer and portable exe into `dist/`

The Electron binary downloads itself on first run if missing (`node node_modules/electron/install.js` forces it).

## Layout

- `src/main/`: Electron main process (window, IPC handlers; SSH sessions will live here)
- `src/preload/`: the only renderer bridge, exposed as `window.bulkssh`; types in `index.d.ts`
- `src/renderer/`: React UI (`index.html`, `src/`)
- `src/shared/`: pure TypeScript shared by all processes, imported as `@shared/...` (e.g. `paging.ts`)
- `tests/`: Vitest tests

## Electron security rules

- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and the CSP in `src/renderer/index.html`.
- Expose only narrow, typed functions through the preload; never expose `ipcRenderer` itself.
- Keep pure logic in `src/shared/` so it is unit-testable without Electron.

## Tooling notes

TypeScript 7: `baseUrl` is removed, so `paths` entries must be relative (`./src/...`). Config files are `.mts` (ESM) and use `import.meta.dirname`, not `__dirname`.

## Conventions

- Platform is Windows 11; the primary shell is PowerShell, Git Bash is also available.
- Do not commit credentials, hosts files, private keys, or any real SSH target details. This tool will handle sensitive connection data, so keep secrets out of the repo and out of logs.
- Commit messages and PR descriptions can be drafted with the `/write-commit` and `/write-merge` skills.

## `.claude/` contents

- `.claude/skills/`: project skills, mostly front-end design and animation helpers (`design-brief`, `brief-to-tasks`, `design-flow`, `design-review`, `design-tokens`, `frontend-design`, `information-architecture`, `grill-me`, `animate`, `improve-animations`, `review-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `emil-design-eng`, `mobile-native`, `redesign-existing-projects`, `pick-ui-library`, `prototype`, `write-commit`, `write-merge`). The design skills apply to the renderer UI.
- `.claude/launch.json`: **stale, copied from an unrelated project** ("Extrusion Studio": `extrusion_studio` Python modules, `.venv`, `runtime/*-preview` dirs). None of its configurations apply to BulkSSH, and it contains hard-coded plaintext passwords. Do not rely on it; replace it with real BulkSSH dev-server configs when there are any, and rotate/remove those passwords if they were ever real.
