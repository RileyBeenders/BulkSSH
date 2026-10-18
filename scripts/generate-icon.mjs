// Draws the app icon (build/icon.png, 512x512) with no dependencies:
// three stacked terminal windows, the front one showing a ">_" prompt.
// electron-builder turns it into the Windows .ico. Run: npm run icon

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const SIZE = 512
const SAMPLES = 4 // per axis, for anti-aliasing

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function nearSegment(x, y, [ax, ay], [bx, by], halfWidth) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= halfWidth * halfWidth
}

// A terminal window: border, title bar, dark body.
function windowColor(x, y, [x0, y0, x1, y1], border, title, body) {
  if (!inRoundedRect(x, y, x0, y0, x1, y1, 0.045)) return null
  const b = 0.016
  if (!inRoundedRect(x, y, x0 + b, y0 + b, x1 - b, y1 - b, 0.03)) return border
  if (y < y0 + 0.075) return title
  return body
}

const ACCENT = hex('#3b82f6')
const GREEN = hex('#22c55e')
const BACK = [0.34, 0.16, 0.88, 0.56]
const MIDDLE = [0.24, 0.27, 0.78, 0.67]
const FRONT = [0.13, 0.38, 0.68, 0.84]

// Colour at a point in the unit square, or null for transparent.
function colorAt(x, y) {
  if (!inRoundedRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.2)) return null
  let c = mix(hex('#24324f'), hex('#0e1119'), y) // background gradient

  const back = windowColor(x, y, BACK, hex('#3a4458'), hex('#3a4458'), hex('#1b2030'))
  if (back) c = back
  const middle = windowColor(x, y, MIDDLE, hex('#55627a'), hex('#55627a'), hex('#1e2433'))
  if (middle) c = middle
  const front = windowColor(x, y, FRONT, ACCENT, ACCENT, hex('#0f1115'))
  if (front) {
    c = front
    // ">" prompt and "_" cursor
    const chevron = [
      [0.22, 0.53],
      [0.31, 0.61],
      [0.22, 0.69]
    ]
    if (nearSegment(x, y, chevron[0], chevron[1], 0.022) || nearSegment(x, y, chevron[1], chevron[2], 0.022)) c = GREEN
    if (inRoundedRect(x, y, 0.35, 0.665, 0.49, 0.705, 0.01)) c = GREEN
  }
  return c
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const c = colorAt((px + (sx + 0.5) / SAMPLES) / SIZE, (py + (sy + 0.5) / SAMPLES) / SIZE)
        if (!c) continue
        r += c[0]
        g += c[1]
        b += c[2]
        a += 1
      }
    }
    const i = (py * SIZE + px) * 4
    if (a > 0) {
      pixels[i] = Math.round(r / a)
      pixels[i + 1] = Math.round(g / a)
      pixels[i + 2] = Math.round(b / a)
    }
    pixels[i + 3] = Math.round((255 * a) / (SAMPLES * SAMPLES))
  }
}

// Minimal PNG encoder: RGBA, 8 bits per channel, no filtering.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) pixels.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = join(process.cwd(), 'build', 'icon.png')
mkdirSync(join(process.cwd(), 'build'), { recursive: true })
writeFileSync(out, png)
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`)
