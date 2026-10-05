// Generates build/icon.ico (an open book on a rounded tile) without any image
// tooling. Run with: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const TILE = [162, 85, 43]
const PAGE = [251, 245, 230]
const SPINE = [120, 58, 26]
const TEXT = PAGE.map((c, i) => Math.round(c * 0.45 + SPINE[i] * 0.55))

// Shapes in a 0..1 unit square. Returns [r, g, b, a] for a sample point.
function sample(x, y) {
  const r = 0.18
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0]

  // Two pages whose top edges dip toward the spine.
  const spineX = 0.5
  const left = 0.17
  const right = 0.83
  const bottom = 0.76
  const topAt = px => 0.27 + 0.06 * (1 - Math.abs(px - spineX) / (spineX - left))
  if (x >= left && x <= right && y <= bottom + 0.04 * (1 - Math.abs(x - spineX) / 0.33) && y >= topAt(x)) {
    if (Math.abs(x - spineX) < 0.012) return [...SPINE, 255]
    // a few text lines on each page
    const lineY = (y - 0.40) / 0.075
    const onLine = lineY >= 0 && lineY < 4 && lineY % 1 < 0.28
    const inText = (x > 0.24 && x < 0.44) || (x > 0.56 && x < 0.76)
    if (onLine && inText) return [...TEXT, 255]
    return [...PAGE, 255]
  }
  return [...TILE, 255]
}

function render(size) {
  const ss = 4
  const pixels = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          if (!ca) continue
          r += cr
          g += cg
          b += cb
          a++
        }
      }
      const i = (py * size + px) * 4
      if (!a) continue
      pixels[i] = Math.round(r / a)
      pixels[i + 1] = Math.round(g / a)
      pixels[i + 2] = Math.round(b / a)
      pixels[i + 3] = Math.round((a / (ss * ss)) * 255)
    }
  }
  return pixels
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function png(size) {
  const pixels = render(size)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const images = SIZES.map(png)
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((image, i) => {
  const entry = 6 + i * 16
  header[entry] = SIZES[i] >= 256 ? 0 : SIZES[i]
  header[entry + 1] = SIZES[i] >= 256 ? 0 : SIZES[i]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
})

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, ...images]))
writeFileSync(join(root, 'build', 'icon.png'), images[images.length - 1])
console.log('Wrote build/icon.ico and build/icon.png')
