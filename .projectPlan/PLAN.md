# BulkSSH Project Plan

## Goal

A simple desktop UI for managing terminal sessions to many devices at once. Two ways to work:

1. **Mirror / broadcast:** keystrokes typed once are sent live to every device whose checkbox is ticked (and a one-shot "send this command line" box does the same for whole commands).
2. **Focus:** open a single session and work in it alone, like a normal terminal.

v1 supports **SSH only**. The design must leave room for other transports later (see Future roadmap).

## Scope

**In scope (v1)**
- Saved device list (name, address, port, username, auth method, optional group/tag)
- Connect/disconnect individual devices or groups
- Per-device connection status
- Device table: a number and a checkbox per device; checked devices receive mirrored keystrokes, unchecked ones do not
- Live keystroke mirroring to the checked devices
- Command-line broadcast (type a command, send to checked devices) with per-device output and exit status
- Focus mode: full interactive terminal for one device
- Paging: a setting for max devices per page, with quick navigation to other pages
- Key-based and password auth; host key verification
- Works with any device that offers an SSH shell (servers, Raspberry Pi-type boxes, network gear)

**Out of scope for v1 (planned for later, see Future roadmap)**
- Telnet and serial connections
- File transfer (SCP/SFTP)
- Port forwarding, jump hosts
- Scripting/macros, scheduling
- Multi-user sharing, cloud sync

## Tech stack (decided)

**Electron + TypeScript + `xterm.js` + `ssh2`**
- `xterm.js` gives a real terminal (colors, vim/top, resizing) for focus mode and for each tile.
- `ssh2` is a mature pure-JS SSH client and runs fine on Windows.
- SSH runs in the Electron main process; the renderer talks to it over IPC (context isolation on, no Node access in the renderer).
- Downside: a heavier install than a native app.

Chosen in Phase 0: `electron-vite` (bundler), React (UI), Vitest (tests), electron-builder (packaging).

## UI sketch

```
+--------------------------------------------------------------+
| Devices            | Page 1 / 3  [<] [1][2][3] [>]  [Focus]   |
|  #  Name      Mirror|---------------------------------------- |
|  1  router-1   [x] *|  grid: one live terminal tile per device |
|  2  pi-garage  [x] *|  (only the devices on this page)         |
|  3  nas        [ ] o|                                         |
|  4  sw-core    [x] !|                                         |
|  + Add device       |                                         |
+---------------------+-----------------------------------------+
| Broadcast: [ command line ...................... ] [Send]       |
| Mirror keystrokes: ON  (3 devices receiving)                    |
+--------------------------------------------------------------+
  * connected   o disconnected   ! error
```

- **Device table (left):** device number, name, mirror checkbox, status dot. Select-all / none / invert helpers. The table lists all devices, independent of paging.
- **Grid (right):** terminal tiles for the devices on the current page. Page size is the "max devices per page" setting.
- **Page navigation:** previous/next, numbered page buttons, and keyboard shortcuts; jumping to a device's page by clicking its row in the table.
- **Mirror mode:** when on, keystrokes typed into the active (driver) terminal are also sent to every other checked, connected device. A visible indicator shows how many devices are receiving.
- **Focus view:** click a tile or row to open that device alone, full size. Mirroring is off in focus view unless explicitly turned on.
- **Bottom bar:** one-shot command broadcast to checked devices, and the mirror-mode toggle.

## Architecture

- **Transport interface:** a small abstraction (`connect`, `write`, `resize`, `onData`, `onClose`, `close`) so the session manager never depends on SSH directly. v1 has one implementation, `SshTransport`. Telnet, serial, and SFTP slot in later without UI changes.
- **Device store:** saved devices in a local JSON file. Passwords and key passphrases are never stored there (see Security).
- **Session manager:** owns one transport per device; emits status and output events. Devices fail independently.
- **Mirror router:** takes input from the driver terminal and fans it out to the checked devices' sessions. It must handle devices that are disconnected or slow without blocking the others.
- **Broadcast runner:** runs a command line over the checked sessions in parallel with a per-device timeout, collecting output and exit codes.
- **Settings:** max devices per page, default timeouts, mirror-mode behavior. Stored in a local settings file.
- **UI layer:** device table, paged grid, focus terminal, broadcast bar. It talks only to the session manager over IPC.

## Phases

**Phase 0: Decisions and scaffold** (done 2026-10-17)
- Choose bundler/UI framework, test runner, packager; scaffold the project; add build/run/test commands to `CLAUDE.md`
- Done when: an empty app window launches with one command

**Phase 1: Single-device connect** (done 2026-10-17; also pulled in host-key trust-on-first-use from Phase 5 and keyboard-interactive auth for network gear)
- Device model and JSON store; add/edit/delete form
- Transport interface and `SshTransport`; connect to one device and show an xterm.js terminal
- Done when: an interactive shell works against a real or test SSH server

**Phase 2: Multi-device grid and paging** (done 2026-10-17)
- Device table with status dots; connect/disconnect many devices
- Grid of live tiles; settings for max devices per page; page navigation
- Done when: 10+ devices spread over several pages, each tile live, with fast page switching

**Phase 3: Mirroring and broadcast** (done 2026-10-17; broadcast uses SSH exec channels for real exit codes, with a per-device timeout setting)
- Mirror checkbox per device; mirror router fanning keystrokes out to checked devices
- Command-line broadcast with per-device output and exit status
- Done when: typing in one terminal appears on all checked devices only, and one failing device does not affect the others

**Phase 4: Focus mode**
- Full-size single-device terminal (resize, copy/paste, colors); switch between grid and focus without dropping connections
- Done when: vim/top work in a focus session

**Phase 5: Safety and polish**
- Host key verification (prompt on first connect, warning on change)
- Credentials in the OS credential store (or key files only)
- Confirmation before mirrored or broadcast input matching a "dangerous" pattern (`rm -rf`, `reboot`, `shutdown`, ...), and a clear target count
- Reconnect on drop, command history, export output to file
- Done when: no secrets sit in plain text on disk

**Phase 6: Packaging**
- Windows installer or portable build; README with usage

## Future roadmap (after v1)

Each item builds on the transport interface or session manager:
1. **Telnet:** a `TelnetTransport`; nearly identical UI. Note it is unencrypted, so warn in the UI.
2. **Serial:** a `SerialTransport` (COM port, baud rate, parity, etc.); needs a native serial library and port-picker UI.
3. **SCP/SFTP:** file transfer to one or many devices; a separate file panel using the existing SSH connections.
4. **Jump hosts and port forwarding**
5. **Scripting/macros and scheduling**
6. **Multi-user sharing, cloud sync** (lowest priority)

## Testing

- Local SSH test targets (e.g. Docker `openssh-server` containers) so tests never touch real devices
- Unit tests for the device store, mirror router and broadcast runner (fan-out, slow or dead devices, partial failure)
- Manual checklist for the UI, paging, and focus mode

## Security notes

- Never log or commit credentials, hosts, or keys.
- Store secrets only in the OS credential store; prefer key-based auth.
- Never silently accept unknown or changed host keys.
- Mirroring and broadcast are powerful, so only send to explicitly checked devices and always show how many are receiving.

## Open questions

1. **Jump hosts / auth (answer pending):** Do you ever reach a device only *through* another SSH machine (a "jump host" or "bastion"), rather than connecting to it directly? And do your devices use SSH keys, passwords, or both? Jump hosts are deferred to the roadmap, but the answer affects how credentials are stored in v1.

## Decisions

- **Mirror mode input:** click a tile (the "driver") and type in it; keystrokes also go to every other checked, connected device.
- **Default page size:** 6 devices per page (3x2 grid), changeable in settings.
