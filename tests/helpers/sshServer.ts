import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Server, utils, type ParsedKey, type PseudoTtyInfo, type WindowChangeInfo } from 'ssh2'

// A tiny in-process SSH server for tests. Its shell sends "welcome\r\n" and
// then echoes every input chunk back prefixed with "echo:".

export interface TestServer {
  port: number
  ptys: PseudoTtyInfo[]
  resizes: WindowChangeInfo[]
  close: () => Promise<void>
}

export interface TestServerOptions {
  username: string
  password?: string
  // OpenSSH-format public key line accepted for publickey auth.
  publicKey?: string
}

// ssh2's generateKeyPairSync('ed25519') emits a malformed key about 1 time in
// 200 (OpenSSH's ssh-keygen rejects those too), so retry until it parses.
export function generateKeys(options?: { passphrase: string; cipher: string; rounds: number }) {
  for (;;) {
    const keys = options ? utils.generateKeyPairSync('ed25519', options) : utils.generateKeyPairSync('ed25519')
    if (!(utils.parseKey(keys.private, options?.passphrase) instanceof Error)) return keys
  }
}

export async function startTestServer(opts: TestServerOptions): Promise<TestServer> {
  const hostKey = generateKeys().private
  const allowedKey = opts.publicKey ? (utils.parseKey(opts.publicKey) as ParsedKey) : null
  const ptys: PseudoTtyInfo[] = []
  const resizes: WindowChangeInfo[] = []

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => {})
    client.on('authentication', (ctx) => {
      if (ctx.username !== opts.username) return ctx.reject()
      if (ctx.method === 'password' && opts.password !== undefined && ctx.password === opts.password) {
        return ctx.accept()
      }
      if (ctx.method === 'publickey' && allowedKey) {
        const wanted = allowedKey.getPublicSSH()
        if (ctx.key.algo !== allowedKey.type || !sameBytes(ctx.key.data, wanted)) return ctx.reject()
        if (!ctx.signature) return ctx.accept()
        if (allowedKey.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true) return ctx.accept()
        return ctx.reject()
      }
      ctx.reject(['password', 'publickey'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (accept, _reject, info) => {
          ptys.push(info)
          accept?.()
        })
        session.on('window-change', (accept, _reject, info) => {
          resizes.push(info)
          accept?.()
        })
        session.on('exec', (accept, _reject, info) => {
          const channel = accept()
          const [name, arg] = info.command.split(' ')
          if (name === 'hang') return
          if (name === 'exit') {
            channel.write('bye\n')
            channel.stderr.write('oops\n')
            channel.exit(Number(arg))
          } else if (name === 'big') {
            channel.write('x'.repeat(Number(arg)))
            channel.exit(0)
          } else {
            channel.write(`ran:${info.command}`)
            channel.exit(0)
          }
          channel.end()
        })
        session.on('shell', (accept) => {
          const channel = accept()
          channel.write('welcome\r\n')
          channel.on('data', (d: Buffer) => channel.write(`echo:${d.toString()}`))
        })
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    ptys,
    resizes,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}
