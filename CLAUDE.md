# BulkSSH

A Windows desktop app for working with many SSH devices at once. [README.md](README.md) is a deliberately short overview (features, install, quick start, shortcuts, build); keep it brief and in step with the app.

## Project status

Phases 0–5 are done: saved devices, password/key auth, host-key trust, a paged grid of live terminal tiles, keystroke mirroring, command broadcast with per-device exit codes, a full-size focus view with copy/paste, confirmation of risky commands, opt-in saved passwords (OS-encrypted), auto-reconnect, command history, export, and recovery from renderer crashes. Phase 6 (packaging) is done too, and so are the v0.2/v0.3 additions (multi-host add, bulk delete). **Released as 1.0.0** (GitHub release `v1.0.0`). What's next is in the plan's Future roadmap (telnet, serial, SFTP, …). The plan is in [.projectPlan/PLAN.md](.projectPlan/PLAN.md); read it before making architectural decisions.

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
- `npm run dist`: build `dist/BulkSSH-Setup-<version>.exe` (per-user NSIS installer) and `dist/BulkSSH-<version>-portable.exe`
- `npm run icon`: regenerate `build/icon.png` from `scripts/generate-icon.mjs` (no dependencies)
- `npm run dev:ssh`: local SSH server on `127.0.0.1:2222` for manual testing (`-- --count 4` for 2222–2225, `-- --password <pw>` to change the password). Any username, password `dev` by default. It runs a fake shell, never a real one; the same commands work over exec for broadcasts with real exit codes (`hostname`, `size`, `sleep <s>`, `fail [code]`, `fail-on <device number>`, …). `tui` is a full-screen test program (alternate screen, resize redraw, colours, arrow keys, cursor-position query) standing in for vim/top; `drop` cuts the connection to exercise auto-reconnect. Its host key lives in `.dev-ssh/` (gitignored).

The Electron binary downloads itself on first run if missing (`node node_modules/electron/install.js` forces it).

## Layout

- `src/main/`: Electron main process
  - `index.ts`: window, host-key confirmation dialogs, permission handler (only clipboard read/write allowed), renderer-crash reload, `safeStorage` cipher, wiring
  - `ipc.ts`: all IPC handlers; validates every argument and rejects other senders
  - `sessionManager.ts`: one session per device (keyed by deviceId), credentials (explicit, saved, or none), host-key checks, auto-reconnect, `writeMany` (mirroring), `exec` (broadcast; never throws, returns `{ ok: false }` instead) and `snapshot` (live sessions, for a reloaded window)
  - `transport/`: `Transport` interface + `SshTransport`; new protocols go here. `exec` is optional on the interface (serial won't have it)
  - `deviceStore.ts`, `knownHosts.ts`, `settingsStore.ts`, `credentialStore.ts`, `jsonFile.ts`: JSON persistence in Electron's `userData` folder (`devices.json`, `known_hosts.json`, `settings.json`, `credentials.json`)
- `src/preload/`: the only renderer bridge, exposed as `window.bulkssh`; types in `index.d.ts`
- `src/renderer/src/`: React UI
  - `App.tsx`: state for devices, open tiles, paging, the active tile, focus view, the password-prompt queue, the checked ("send to") set, mirror mode and the current broadcast; installs the mirror input handler; all app shortcuts go through `handleShortcut`
  - `terminals.ts`: one xterm instance per device, kept outside React; tiles attach/detach its DOM node, so page switches keep scrollback and don't resize terminals. Typed input goes through a replaceable handler (`setInputHandler`). App shortcuts and clipboard keys (from `@shared/keys`) are kept from reaching the device; right-click copies the selection or pastes
  - `components/`: `DeviceList`, `Tile`, `Pager`, `BroadcastBar` (with in-memory history), `BroadcastResults`, `ConfirmDanger`, `DeviceForm`, `SecretPrompt`, `SettingsDialog`, `Modal`, `TerminalView`
  - `broadcast.ts`: broadcast run types and the plain-text export format (no JSX, so tests can import it)
- `src/shared/`: pure TypeScript shared by all processes, imported as `@shared/...` (`device.ts`, `hosts.ts`, `session.ts`, `paging.ts`, `settings.ts`, `mirror.ts`, `keys.ts`, `danger.ts`)
- `tests/`: Vitest tests. `tests/helpers/sshServer.ts` is an in-process ssh2 server used by `sessionManager.test.ts`
- `scripts/dev-ssh-server.mjs`: the `npm run dev:ssh` server

## Adding devices

- The device form has one **Host(s)** box instead of host + port: `parseHostList` in `src/shared/hosts.ts` reads `host`, `host:port`, `[ipv6]:port` and bare IPv6, separated by commas/semicolons/whitespace, stripping quotes and backticks and dropping duplicates (max 500). `planDevices` names them (`<name>-1…`, or the address) and reuses saved devices with the same address + username. `formatHost` turns a saved device back into the box text (port only when not 22).
- Saved devices still have exactly one host and port; editing accepts one address only. The data model and `devices.json` are unchanged.
- A bulk add with "Connect after adding" goes through `connectMany`, the same path as Connect all; prompts queued by a bulk action start with "Also use for the other devices" ticked.
- **Edit list** mode (`selecting` / `selected` in `App.tsx`; its button is at the bottom of the sidebar, and in the mode that bottom bar becomes **Delete N selected** / **Done**) swaps each row's send-to checkbox and buttons for a selection checkbox; **Delete N selected** confirms in `ConfirmDelete` and calls `devices:deleteMany`. The main process disconnects each device and forgets its saved secret, then `DeviceStore.deleteMany` writes once. `forgetDevices` in `App.tsx` is the single place that clears a deleted device from renderer state (tiles, prompts, send-to, selection, line trackers); use it for any new delete path.

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

## Safety

- `src/shared/danger.ts` lists risky commands (rm -r, reboot/shutdown, mkfs, dd, recursive chmod, firewall flushes, interface down, user/password changes, package removal, and network-gear reload/erase). Unix rules match only in command position (line start, after `;` `&` `|` `(` `$(` or `sudo`/`doas`) and are case-sensitive; network-gear rules are case-insensitive. Add a test in `tests/danger.test.ts` for every rule change, including a false-positive case.
- A broadcast whose command matches needs confirmation in `ConfirmDanger` (Cancel is focused). While mirroring, a per-device `LineTracker` rebuilds the typed line from keystrokes; an Enter that would submit a risky line to several devices is held until confirmed. Lines recalled from history or edited with arrows/tab are marked uncertain; risky text that never appears in the tracked line (e.g. recalled with Up) can't be caught.
- Auto-reconnect (setting, default on): 5 tries at 2/5/10/20/30 s. It reuses the last good password from memory (never disk), stops on wrong password or rejected host key, and is cancelled by Disconnect. Status `reconnecting` counts as live in the UI.
- If the renderer crashes, the main process reloads it and the page re-adopts live sessions via `session:list`; scrollback from before the crash is lost.

## Secrets and host keys

- Passwords and key passphrases are asked for at connect time. They are written to disk only if the user ticks "Remember", and then only as `safeStorage` ciphertext in `credentials.json` (DPAPI-protected key on Windows). The renderer never receives a saved secret, only which devices have one (`credentials:status`). A saved secret the device rejects is deleted. `devices.json` holds only host, port, username and key *path*.
- Broadcast command history is kept in memory only, since commands can contain secrets.
- Host keys are trust-on-first-use: unknown keys and changed keys both show a native dialog in the main process (the renderer cannot answer it). Never add a path that accepts keys silently.

## Gotchas

- `ssh2`'s `utils.generateKeyPairSync('ed25519')` produces a malformed key about 1 time in 200 (OpenSSH rejects it too). Tests use `generateKeys()` from the test helper, which retries. Real keys from `ssh-keygen` are unaffected.
- On Windows, stopping an `npm run dev:ssh` background task kills `npm` but can leave the `node` child listening on 2222+. A later server then fails with `EADDRINUSE` while the app silently talks to the old one. Check for and stop leftover `dev-ssh-server.mjs` processes before restarting it.
- CDP mouse events: send `mouseReleased` with `buttons: 0`, or xterm treats the drag as still in progress and the selection runs to the end of the screen.
- When driving the Electron window over CDP for checks, a window hidden behind others reports `visibilityState: hidden` and xterm stops repainting. Launch with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`, and use `--user-data-dir=<temp dir>` so test devices don't land in the real app data.

## Packaging

- `electron-builder.yml`: NSIS (per-user, no admin) + portable, icon `build/icon.png`, `npmRebuild: false` (ssh2's optional native addons are never built, so no C++ toolchain is needed). Uninstall keeps `%APPDATA%\bulkssh`.
- Only `ssh2` is a runtime dependency; everything the renderer uses (React, xterm) is bundled by Vite and belongs in `devDependencies`, so it isn't copied into the package a second time. Anything the main process `require`s at runtime must be in `dependencies`.
- Builds are not code-signed (SmartScreen warns). `.github/workflows/release.yml` builds both exes on manual dispatch or a `v*` tag and uploads them as a workflow artifact; it does not publish a release.
- To check a packaged build, run `dist/win-unpacked/BulkSSH.exe` (same flags as the CDP gotcha below work). Don't run the installer on the dev machine unasked: it adds shortcuts and an uninstall entry.

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
