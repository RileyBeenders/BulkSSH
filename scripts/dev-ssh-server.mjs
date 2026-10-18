// Local SSH server for trying BulkSSH without real devices.
//
//   npm run dev:ssh                 -> one server on 127.0.0.1:2222
//   npm run dev:ssh -- --count 4    -> servers on 2222..2225
//
// Login with any username and the password "dev". The shell is a small fake
// shell (no access to this machine): help, echo, whoami, hostname, date,
// size, sleep, fail, fail-on, clear, exit. The same commands work as exec
// commands (BulkSSH broadcast) and return real exit codes. `tui` (shell
// only) is a full-screen test program standing in for vim/top: alternate
// screen, redraw on resize, colours, arrow keys and a cursor-position query. The host key is
// kept in .dev-ssh/ so it stays trusted across restarts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import ssh2 from 'ssh2'

const { Server, utils } = ssh2
const PASSWORD = 'dev'
const BASE_PORT = 2222

const countArg = process.argv.indexOf('--count')
const count = countArg > 0 ? Math.max(1, Number(process.argv[countArg + 1]) || 1) : 1

const keyDir = join(process.cwd(), '.dev-ssh')
const keyPath = join(keyDir, 'host_key')
if (!existsSync(keyPath)) {
  mkdirSync(keyDir, { recursive: true })
  // ssh2 occasionally generates a malformed ed25519 key; retry until it parses.
  let key
  do key = utils.generateKeyPairSync('ed25519').private
  while (utils.parseKey(key) instanceof Error)
  writeFileSync(keyPath, key)
}
const hostKey = readFileSync(keyPath)
const publicBlob = utils.parseKey(hostKey).getPublicSSH()
const fingerprint = 'SHA256:' + createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')

for (let i = 0; i < count; i++) startServer(BASE_PORT + i, `dev-device-${i + 1}`)
console.log(`Host key fingerprint: ${fingerprint}`)
console.log(`Password for any username: ${PASSWORD}`)

function startServer(port, hostname) {
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    let username = ''
    client.on('error', () => {})
    client.on('authentication', (ctx) => {
      username = ctx.username
      if (ctx.method === 'password' && ctx.password === PASSWORD) return ctx.accept()
      ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        const size = { cols: 80, rows: 24 }
        const resizeListeners = new Set()
        const onResize = (fn) => {
          resizeListeners.add(fn)
          return () => resizeListeners.delete(fn)
        }
        session.on('pty', (ok, _no, info) => {
          Object.assign(size, { cols: info.cols, rows: info.rows })
          ok?.()
        })
        session.on('window-change', (ok, _no, info) => {
          Object.assign(size, { cols: info.cols, rows: info.rows })
          for (const fn of resizeListeners) fn()
          ok?.()
        })
        session.on('shell', (ok) => fakeShell(ok(), { username, hostname, size, onResize }))
        session.on('exec', async (ok, _no, info) => {
          const channel = ok()
          const ctx = { username, hostname, size }
          const code = await runCommand(
            info.command.trim(),
            ctx,
            (text) => channel.write(text + '\n'),
            (text) => channel.stderr.write(text + '\n')
          )
          channel.exit(code === 'exit' ? 0 : code)
          channel.end()
        })
      })
    })
  })
  server.listen(port, '127.0.0.1', () => console.log(`${hostname} listening on 127.0.0.1:${port}`))
}

function fakeShell(channel, ctx) {
  const prompt = () => channel.write(`\x1b[32m${ctx.username}@${ctx.hostname}\x1b[0m:~$ `)
  const out = (text) => channel.write(text.replace(/\n/g, '\r\n') + '\r\n')
  const err = (text) => out(`\x1b[31m${text}\x1b[0m`)
  let line = ''
  let busy = false
  let tui = null

  channel.write(`Welcome to ${ctx.hostname} (BulkSSH dev server). Type "help".\r\n`)
  prompt()

  channel.on('data', async (data) => {
    if (tui) return tui.input(data.toString())
    for (const ch of data.toString()) {
      if (busy) {
        // Like a real terminal: Ctrl+C interrupts, other input is dropped.
        if (ch === '\x03') busy = 'interrupted'
        continue
      }
      if (ch === '\r') {
        channel.write('\r\n')
        const cmd = line.trim()
        line = ''
        if (cmd === 'tui') {
          tui = startTui(channel, ctx, () => {
            tui = null
            prompt()
          })
          return
        }
        busy = true
        const result = await runCommand(cmd, ctx, out, err, () => busy === 'interrupted')
        busy = false
        if (result === 'exit') return channel.close()
        prompt()
      } else if (ch === '\x7f' || ch === '\b') {
        if (line.length > 0) {
          line = line.slice(0, -1)
          channel.write('\b \b')
        }
      } else if (ch === '\x03') {
        line = ''
        channel.write('^C\r\n')
        prompt()
      } else if (ch >= ' ') {
        line += ch
        channel.write(ch)
      }
    }
  })
}

// Full-screen test program (stand-in for vim/top).
function startTui(channel, ctx, done) {
  let x = 0
  let y = 0
  let lastKey = '(none)'
  let report = '(waiting)'
  const write = (s) => channel.write(s)

  const draw = () => {
    const { cols, rows } = ctx.size
    let s = '\x1b[0m\x1b[H\x1b[2J'
    s += '\x1b[1;1H┌' + '─'.repeat(Math.max(0, cols - 2)) + '┐'
    for (let r = 2; r < rows; r++) s += `\x1b[${r};1H│\x1b[${r};${cols}H│`
    s += `\x1b[${rows};1H└` + '─'.repeat(Math.max(0, cols - 2)) + '┘'
    const at = (r, text) => {
      if (r > 1 && r < rows) s += `\x1b[${r};3H${text}\x1b[0m`
    }
    at(2, `\x1b[1mBulkSSH TUI test on ${ctx.hostname}\x1b[0m   size ${cols}x${rows}`)
    at(4, '16 colours:  ' + Array.from({ length: 16 }, (_, i) => `\x1b[48;5;${i}m  `).join(''))
    at(5, '256 colours: ' + Array.from({ length: 24 }, (_, i) => `\x1b[48;5;${16 + i * 9}m  `).join(''))
    const width = Math.max(0, Math.min(48, cols - 18))
    at(6, 'Truecolour:  ' + Array.from({ length: width }, (_, i) => {
      const t = i / Math.max(1, width - 1)
      return `\x1b[48;2;${Math.round(255 * t)};${Math.round(80 + 100 * (1 - t))};${Math.round(255 * (1 - t))}m `
    }).join(''))
    at(8, `Last key: ${lastKey}`)
    at(9, `Cursor report: ${report}`)
    at(rows - 1, 'Arrows move @   r: ask for a cursor report   q: quit')
    const maxX = Math.max(0, cols - 5)
    const maxY = Math.max(0, rows - 14)
    x = Math.min(x, maxX)
    y = Math.min(y, maxY)
    s += `\x1b[${11 + y};${3 + x}H\x1b[33;1m@\x1b[0m`
    write(s)
  }

  const unsubscribe = ctx.onResize(draw)
  write('\x1b[?1049h\x1b[?25l') // alternate screen, hide cursor
  draw()
  write('\x1b[6n') // cursor position query, answered by the terminal

  return {
    input(data) {
      const cpr = data.match(/^\x1b\[(\d+);(\d+)R$/)
      if (cpr) {
        report = `row ${cpr[1]}, col ${cpr[2]}`
        return draw()
      }
      if (data === 'q') {
        unsubscribe()
        write('\x1b[?25h\x1b[?1049l') // show cursor, leave alternate screen
        return done()
      }
      if (data === 'r') write('\x1b[6n')
      const moves = { A: [0, -1], B: [0, 1], C: [1, 0], D: [-1, 0] }
      const arrow = data.match(/^\x1b[[O]([ABCD])$/)
      if (arrow) {
        const [dx, dy] = moves[arrow[1]]
        x = Math.max(0, x + dx)
        y = Math.max(0, y + dy)
      }
      lastKey = JSON.stringify(data).slice(1, -1)
      draw()
    }
  }
}

// Returns an exit code, or 'exit' to end a shell session.
async function runCommand(cmd, ctx, out, err, interrupted = () => false) {
  const [name, ...args] = cmd.split(/\s+/)
  const deviceNumber = Number(ctx.hostname.split('-').pop())
  switch (name) {
    case '':
      return 0
    case 'help':
      out('Commands: help, echo <text>, whoami, hostname, date, size, sleep <s>,')
      out('          fail [code], fail-on <device number> [code], tui, clear, exit')
      return 0
    case 'echo':
      out(args.join(' '))
      return 0
    case 'whoami':
      out(ctx.username)
      return 0
    case 'hostname':
      out(ctx.hostname)
      return 0
    case 'date':
      out(new Date().toString())
      return 0
    case 'size':
      out(`${ctx.size.cols} columns x ${ctx.size.rows} rows`)
      return 0
    case 'sleep': {
      const end = Date.now() + Math.max(0, Number(args[0]) || 0) * 1000
      while (Date.now() < end) {
        if (interrupted()) {
          out('^C')
          return 130
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      return 0
    }
    case 'fail': {
      const code = Number(args[0]) || 1
      err(`fail: exiting with ${code}`)
      return code
    }
    case 'fail-on': {
      // Fails only on the given device, to try broadcasts with one bad device.
      if (deviceNumber === Number(args[0])) {
        const code = Number(args[1]) || 1
        err(`fail-on: ${ctx.hostname} is failing with ${code}`)
        return code
      }
      out(`fail-on: ${ctx.hostname} is fine`)
      return 0
    }
    case 'clear':
      out('\x1b[2J\x1b[H')
      return 0
    case 'exit':
      out('logout')
      return 'exit'
    default:
      err(`${name}: command not found`)
      return 127
  }
}
