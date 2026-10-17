# BulkSSH

A program for connecting to multiple SSH clients at once (see [README.md](README.md)).

## Project status

Phases 0–2 are done: saved devices, password/key auth, host-key trust, and a paged grid of live terminal tiles (connect/disconnect all, configurable devices per page). Next is Phase 3 (keystroke mirroring and command broadcast). The plan is in [.projectPlan/PLAN.md](.projectPlan/PLAN.md); read it before making architectural decisions.

## Stack

- **App:** Electron + TypeScript, React for the UI
- **Terminal / SSH:** `@xterm/xterm` + `@xterm/addon-fit` (terminal UI) + `ssh2` (SSH client, pure-JS; its optional native crypto build is skipped)
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
- `npm run dev:ssh`: local SSH server on `127.0.0.1:2222` for manual testing (`-- --count 4` for 2222–2225). Any username, password `dev`. It runs a fake shell (`help`, `echo`, `size`, …), never a real one; its host key lives in `.dev-ssh/` (gitignored).

The Electron binary downloads itself on first run if missing (`node node_modules/electron/install.js` forces it).

## Layout

- `src/main/`: Electron main process
  - `index.ts`: window, host-key confirmation dialogs, wiring
  - `ipc.ts`: all IPC handlers; validates every argument and rejects other senders
  - `sessionManager.ts`: one session per device (keyed by deviceId), credentials, host-key checks
  - `transport/`: `Transport` interface + `SshTransport`; new protocols go here
  - `deviceStore.ts`, `knownHosts.ts`, `settingsStore.ts`, `jsonFile.ts`: JSON persistence in Electron's `userData` folder (`devices.json`, `known_hosts.json`, `settings.json`)
- `src/preload/`: the only renderer bridge, exposed as `window.bulkssh`; types in `index.d.ts`
- `src/renderer/src/`: React UI
  - `App.tsx`: state for devices, open tiles, paging, the active tile and the password-prompt queue
  - `terminals.ts`: one xterm instance per device, kept outside React; tiles attach/detach its DOM node, so page switches keep scrollback and don't resize terminals. App shortcuts (`isAppShortcut`, currently Ctrl+PageUp/PageDown) are blocked from reaching the device
  - `components/`: `DeviceList`, `Tile`, `Pager`, `DeviceForm`, `SecretPrompt`, `SettingsDialog`, `Modal`, `TerminalView`
- `src/shared/`: pure TypeScript shared by all processes, imported as `@shared/...` (`device.ts`, `session.ts`, `paging.ts`, `settings.ts`)
- `tests/`: Vitest tests. `tests/helpers/sshServer.ts` is an in-process ssh2 server used by `sessionManager.test.ts`
- `scripts/dev-ssh-server.mjs`: the `npm run dev:ssh` server

## Grid behavior

- Pages cover *open* devices (ones with a tile), ordered by device number, not all saved devices. A tile stays after its device disconnects until the user closes it.
- The grid shape comes from `gridShape(min(pageSize, open))`, so every page has the same tile size and switching pages never resizes terminals.
- "Connect all" queues password prompts one at a time; the prompt offers to reuse the password for the other waiting devices. The password lives only in that call, never in state.
- Host-key dialogs are queued in the main process so bulk connects never stack them.

## Secrets and host keys

- Passwords and key passphrases are asked for at connect time and passed straight through; they are never written to disk or kept in renderer state. `devices.json` holds only host, port, username and key *path*.
- Host keys are trust-on-first-use: unknown keys and changed keys both show a native dialog in the main process (the renderer cannot answer it). Never add a path that accepts keys silently.

## Gotchas

- `ssh2`'s `utils.generateKeyPairSync('ed25519')` produces a malformed key about 1 time in 200 (OpenSSH rejects it too). Tests use `generateKeys()` from the test helper, which retries. Real keys from `ssh-keygen` are unaffected.
- When driving the Electron window over CDP for checks, a window hidden behind others reports `visibilityState: hidden` and xterm stops repainting. Launch with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`, and use `--user-data-dir=<temp dir>` so test devices don't land in the real app data.

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
- `.claude/launch.json`: one `dev` config that runs `npm run dev` and previews the renderer at `http://localhost:5173` (port pinned with `strictPort` in `electron.vite.config.mts`). In a plain browser `window.bulkssh` is undefined, so renderer code must tolerate a missing bridge (`window.bulkssh?.…`); anything that needs the main process (SSH, IPC) can only be verified in the Electron window that `npm run dev` also opens.
