# BulkSSH

A program for connecting to multiple SSH clients at once (see [README.md](README.md)).

## Project status

Phases 0–4 are done: saved devices, password/key auth, host-key trust, a paged grid of live terminal tiles, keystroke mirroring to checked devices, command broadcast with per-device exit codes, and a full-size focus view with copy/paste. Next is Phase 5 (safety and polish). The plan is in [.projectPlan/PLAN.md](.projectPlan/PLAN.md); read it before making architectural decisions.

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
- `npm run dev:ssh`: local SSH server on `127.0.0.1:2222` for manual testing (`-- --count 4` for 2222–2225). Any username, password `dev`. It runs a fake shell, never a real one; the same commands work over exec for broadcasts with real exit codes (`hostname`, `size`, `sleep <s>`, `fail [code]`, `fail-on <device number>`, …). `tui` is a full-screen test program (alternate screen, resize redraw, colours, arrow keys, cursor-position query) standing in for vim/top. Its host key lives in `.dev-ssh/` (gitignored).

The Electron binary downloads itself on first run if missing (`node node_modules/electron/install.js` forces it).

## Layout

- `src/main/`: Electron main process
  - `index.ts`: window, host-key confirmation dialogs, permission handler (only clipboard read/write allowed), wiring
  - `ipc.ts`: all IPC handlers; validates every argument and rejects other senders
  - `sessionManager.ts`: one session per device (keyed by deviceId), credentials, host-key checks, `writeMany` (mirroring) and `exec` (broadcast; never throws, returns `{ ok: false }` instead)
  - `transport/`: `Transport` interface + `SshTransport`; new protocols go here. `exec` is optional on the interface (serial won't have it)
  - `deviceStore.ts`, `knownHosts.ts`, `settingsStore.ts`, `jsonFile.ts`: JSON persistence in Electron's `userData` folder (`devices.json`, `known_hosts.json`, `settings.json`)
- `src/preload/`: the only renderer bridge, exposed as `window.bulkssh`; types in `index.d.ts`
- `src/renderer/src/`: React UI
  - `App.tsx`: state for devices, open tiles, paging, the active tile, focus view, the password-prompt queue, the checked ("send to") set, mirror mode and the current broadcast; installs the mirror input handler; all app shortcuts go through `handleShortcut`
  - `terminals.ts`: one xterm instance per device, kept outside React; tiles attach/detach its DOM node, so page switches keep scrollback and don't resize terminals. Typed input goes through a replaceable handler (`setInputHandler`). App shortcuts and clipboard keys (from `@shared/keys`) are kept from reaching the device; right-click copies the selection or pastes
  - `components/`: `DeviceList`, `Tile`, `Pager`, `BroadcastBar`, `BroadcastResults`, `DeviceForm`, `SecretPrompt`, `SettingsDialog`, `Modal`, `TerminalView`
- `src/shared/`: pure TypeScript shared by all processes, imported as `@shared/...` (`device.ts`, `session.ts`, `paging.ts`, `settings.ts`, `mirror.ts`, `keys.ts`)
- `tests/`: Vitest tests. `tests/helpers/sshServer.ts` is an in-process ssh2 server used by `sessionManager.test.ts`
- `scripts/dev-ssh-server.mjs`: the `npm run dev:ssh` server

## Grid behavior

- Pages cover *open* devices (ones with a tile), ordered by device number, not all saved devices. A tile stays after its device disconnects until the user closes it.
- The grid shape comes from `gridShape(min(pageSize, open))`, so every page has the same tile size and switching pages never resizes terminals.
- "Connect all" queues password prompts one at a time; the prompt offers to reuse the password for the other waiting devices. The password lives only in that call, never in state.
- Host-key dialogs are queued in the main process so bulk connects never stack them.

## Mirroring and broadcast

- The checkbox on each device row is the "send to" set, shared by mirroring and broadcast. It starts empty and is not saved.
- Mirror mode (button or Ctrl+Shift+M): input typed into any tile goes to that tile plus every other checked, *connected* device, as one `session:writeMany` IPC per keystroke. Terminal replies (cursor reports, device attributes, focus and mouse events, OSC/DCS replies) are filtered by `isTerminalReport` and go only to the tile they came from; keep that filter when touching input handling.
- Broadcast runs the command on each checked, connected device over an SSH **exec channel** (not by typing into the shell), in parallel, with a per-device timeout from settings (`broadcastTimeoutSec`, default 30) and output capped at 64 KB. Results fill in per device as they arrive.

## Focus view and keys

- Focus view shows one open device full size using the *same* xterm instance (its DOM node moves), so the device gets a resize and scrollback is kept. Entering it turns mirroring off; leaving restores the earlier setting unless mirroring was turned on again in focus.
- Shortcuts, all defined in `src/shared/keys.ts` and unit-tested: Ctrl+PageUp/PageDown (page, or previous/next device in focus view), Ctrl+Shift+M (mirror), Ctrl+Shift+F (focus view). Clipboard: Ctrl+Shift+C / Ctrl+Insert copy, Ctrl+Shift+V / Shift+Insert paste, Ctrl+C copies only when text is selected (otherwise it is ^C), right-click copies or pastes. Plain Ctrl+V is left to the device. Don't claim new keys that full-screen programs (vim, less, top, readline) need.
- Pastes go through `term.paste()`, so they are bracketed-paste aware and mirrored like typing.

## Secrets and host keys

- Passwords and key passphrases are asked for at connect time and passed straight through; they are never written to disk or kept in renderer state. `devices.json` holds only host, port, username and key *path*.
- Host keys are trust-on-first-use: unknown keys and changed keys both show a native dialog in the main process (the renderer cannot answer it). Never add a path that accepts keys silently.

## Gotchas

- `ssh2`'s `utils.generateKeyPairSync('ed25519')` produces a malformed key about 1 time in 200 (OpenSSH rejects it too). Tests use `generateKeys()` from the test helper, which retries. Real keys from `ssh-keygen` are unaffected.
- On Windows, stopping an `npm run dev:ssh` background task kills `npm` but can leave the `node` child listening on 2222+. A later server then fails with `EADDRINUSE` while the app silently talks to the old one. Check for and stop leftover `dev-ssh-server.mjs` processes before restarting it.
- CDP mouse events: send `mouseReleased` with `buttons: 0`, or xterm treats the drag as still in progress and the selection runs to the end of the screen.
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
