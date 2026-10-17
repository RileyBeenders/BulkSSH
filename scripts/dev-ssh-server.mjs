// Local SSH server for trying BulkSSH without real devices.
//
//   npm run dev:ssh                 -> one server on 127.0.0.1:2222
//   npm run dev:ssh -- --count 4    -> servers on 2222..2225
//
// Login with any username and the password "dev". The shell is a small fake
// shell (no access to this machine): help, echo, whoami, hostname, date,
// size, clear, exit. The host key is kept in .dev-ssh/ so it stays trusted
// across restarts.

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
        session.on('pty', (ok, _no, info) => {
          Object.assign(size, { cols: info.cols, rows: info.rows })
          ok?.()
        })
        session.on('window-change', (ok, _no, info) => {
          Object.assign(size, { cols: info.cols, rows: info.rows })
          ok?.()
        })
        session.on('shell', (ok) => fakeShell(ok(), { username, hostname, size }))
      })
    })
  })
  server.listen(port, '127.0.0.1', () => console.log(`${hostname} listening on 127.0.0.1:${port}`))
}

function fakeShell(channel, ctx) {
  const prompt = () => channel.write(`\x1b[32m${ctx.username}@${ctx.hostname}\x1b[0m:~$ `)
  let line = ''

  channel.write(`Welcome to ${ctx.hostname} (BulkSSH dev server). Type "help".\r\n`)
  prompt()

  channel.on('data', (data) => {
    for (const ch of data.toString()) {
      if (ch === '\r') {
        channel.write('\r\n')
        const done = run(line.trim())
        line = ''
        if (done) return channel.close()
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

  function run(cmd) {
    const [name, ...args] = cmd.split(/\s+/)
    const out = (text) => channel.write(text + '\r\n')
    switch (name) {
      case '':
        break
      case 'help':
        out('Commands: help, echo <text>, whoami, hostname, date, size, clear, exit')
        break
      case 'echo':
        out(args.join(' '))
        break
      case 'whoami':
        out(ctx.username)
        break
      case 'hostname':
        out(ctx.hostname)
        break
      case 'date':
        out(new Date().toString())
        break
      case 'size':
        out(`${ctx.size.cols} columns x ${ctx.size.rows} rows`)
        break
      case 'clear':
        channel.write('\x1b[2J\x1b[H')
        break
      case 'exit':
        out('logout')
        return true
      default:
        out(`${name}: command not found`)
    }
    return false
  }
}
