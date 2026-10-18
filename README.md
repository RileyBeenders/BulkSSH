<p align="center"><img src="build/icon.png" width="96" alt="BulkSSH icon"></p>

# BulkSSH

A Windows desktop app for working with many SSH devices at once: a grid of live terminals, keystrokes mirrored to the devices you pick, and commands broadcast with per-device results.

It works with anything that offers an SSH shell: Linux servers, Raspberry Pis, routers and switches.

## Install

Download one of these from a release, or build them yourself (see [Building](#building)):

| File | What it is |
| --- | --- |
| `BulkSSH-Setup-<version>.exe` | Installer. Installs for your Windows user only (no admin rights), with Start-menu and desktop shortcuts. |
| `BulkSSH-<version>-portable.exe` | Single exe, nothing to install. Unpacks itself each time it starts, so it opens a little slower. |

The builds are not code-signed yet, so Windows SmartScreen will warn on first run: choose **More info → Run anyway**.

Your devices, trusted host keys, settings and any saved passwords are kept in `%APPDATA%\bulkssh`. Uninstalling leaves that folder in place; delete it to remove everything.

## Using BulkSSH

### Add devices

Click **+ Add** and fill in a name, host, port (22 by default) and username, then choose how to log in:

- **Password**: asked for when you connect. It is only saved if you tick **Remember**.
- **Private key file**: pick the key (for example `C:\Users\you\.ssh\id_ed25519`). If the key has a passphrase, you are asked for it when you connect.

Devices are numbered in the order you add them. The numbers stay the same everywhere: the device list, the tiles and broadcast results.

### Connect

- **▶** on a device row connects that device. **Connect all** connects every device. If several need a password, you're asked once, with an option to use the same password for all of them.
- The first time you connect to a device, BulkSSH shows its **host key fingerprint** and asks whether to trust it. If a known device later presents a *different* key, you get a warning and the connection only goes ahead if you explicitly replace the key.
- If a connection drops (network glitch, device reboot), BulkSSH **reconnects automatically**: up to 5 tries over about a minute. **■ Disconnect** stops it. You can turn this off in Settings.

### The grid

Each connected device gets a live terminal tile. When more devices are open than fit on one page, use the pager at the top or **Ctrl+PageUp / Ctrl+PageDown**. Clicking a device in the list jumps to its tile.

Tile buttons: **■** disconnect (or **▶** reconnect), **⭳** export the scrollback to a text file, **⤢** focus view, **✕** close the tile.

### Focus view

**⤢**, a double-click on a tile's title bar, or **Ctrl+Shift+F** shows one device full size. It is the same terminal with the same scrollback, so full-screen programs like `vim`, `top` and `less` get the whole window. **Ctrl+PageUp / Ctrl+PageDown** step to the previous or next device, and **Ctrl+Shift+F** or **← Grid** goes back.

### Choose who receives input: "Send to"

The checkbox on each device row decides which devices receive **mirrored keystrokes** and **broadcast commands**. **All / None / Invert** help with long lists. Nothing is checked when the app starts.

### Mirror keystrokes

Turn on **Mirror** (bottom left, or **Ctrl+Shift+M**). Whatever you type in a tile also goes to every other checked, connected device. You can watch it happen: the tile you type in is marked **source** and the receiving tiles **mirrored**.

- Replies the terminal sends by itself (cursor-position reports, mouse events and similar) are never mirrored.
- Entering focus view turns mirroring off; returning to the grid turns it back on if it was on before.

### Broadcast a command

Type a command in the box at the bottom and press **Run on N**. It runs on every checked, connected device at the same time. A results panel then shows each device's **exit code**, how long it took and its output (click a row to expand it). One slow or failing device never holds up the others; each has its own time limit (30 s by default, see Settings). **Export** saves the results to a text file. **Up / Down** in the box recalls earlier commands from this session.

Broadcasts run in a separate channel, not in the terminals, so they don't interfere with what you're doing in a tile.

### Safety checks

Before a risky command reaches several devices, BulkSSH asks you to confirm and lists exactly which devices would get it. Examples: `rm -r`, `reboot`/`shutdown`, `mkfs`, `dd … of=`, recursive `chmod`/`chown`, flushing the firewall, taking a network interface down, changing users or passwords, removing packages, and `reload` / `write erase` on network gear. This applies to broadcasts, and to pressing Enter while keystrokes are mirrored. **Cancel** is the default button.

The check matches on text, so treat it as a seatbelt, not a guarantee. In particular, it can't see a command recalled from the device's own shell history with the Up arrow.

### Copy and paste

| Action | Keys |
| --- | --- |
| Copy | Select text, then **Ctrl+Shift+C**, **Ctrl+Insert** or **Ctrl+C**, or right-click |
| Paste | **Ctrl+Shift+V**, **Shift+Insert**, or right-click with nothing selected |

**Ctrl+C** with nothing selected still sends an interrupt to the device. Pasted text is mirrored like typing when Mirror is on.

### Keyboard shortcuts

| Keys | Does |
| --- | --- |
| Ctrl+PageUp / Ctrl+PageDown | Previous / next page (in focus view: previous / next device) |
| Ctrl+Shift+M | Mirror keystrokes on / off |
| Ctrl+Shift+F | Focus view on / off |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste |

### Settings (⚙)

- **Devices per page**: 1–36 (default 6).
- **Broadcast timeout**: per device, in seconds (default 30).
- **Reconnect automatically** when a connection drops (default on).

## Passwords and security

- Passwords and key passphrases are **not saved unless you tick Remember**. Saved ones are encrypted with Windows (DPAPI, through Electron's `safeStorage`), so only your Windows account on this PC can read them. To remove one, open the device's **Edit** form and click **Forget it**. A saved password the device rejects is forgotten automatically.
- Commands you broadcast are kept in memory only and are never written to disk.
- Host keys are never accepted silently (see [Connect](#connect)).
- The app window can't reach your files, camera, microphone or the network directly. All SSH work happens in Electron's main process.

## Building

You need Windows and [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install
```

| Command | Does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm test` | Run the tests |
| `npm run typecheck` | Type-check |
| `npm run dist` | Build the installer and portable exe into `dist/` |
| `npm run dev:ssh` | Start a local SSH server for trying the app without real devices (see below) |
| `npm run icon` | Regenerate `build/icon.png` |

No C++ build tools are needed: the app uses ssh2's pure-JavaScript code. The **Build Windows packages** workflow on GitHub (Actions tab → *Run workflow*, or push a `v*` tag) builds the same files and attaches them to the run.

### Trying it without real devices

```bash
npm run dev:ssh -- --count 4
```

This starts 4 fake SSH devices on `127.0.0.1:2222`–`2225`. Log in with any username and the password `dev` (change it with `--password`). They run a small fake shell, not a real one. Useful commands: `help`, `hostname`, `size`, `sleep 5`, `fail`, `fail-on 2` (fails only on device 2), `tui` (a full-screen test program), and `drop` (cuts the connection, to see auto-reconnect).

## Roadmap

Planned after this first version: telnet and serial connections, SCP/SFTP file transfer, jump hosts and port forwarding, and scripting. See [.projectPlan/PLAN.md](.projectPlan/PLAN.md).
