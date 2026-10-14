// Codificador PNG mínimo (RGBA 8 bits, sin filtro) y lectores de tamaño de PNG/JPEG.
import { ascii, concat, deflate, view } from './bytes.mjs'

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32 (buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function u32 (v) { const b = new Uint8Array(4); view(b).setUint32(0, v); return b }
function chunk (type, data) {
  const td = concat([ascii(type), data])
  return concat([u32(data.length), td, u32(crc32(td))])
}

/** PNG de `rgba` (w*h*4 bytes). */
export async function encodePng (w, h, rgba) {
  const stride = w * 4 + 1
  const raw = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * stride + 1)
  const ihdr = new Uint8Array(13)
  view(ihdr).setUint32(0, w); view(ihdr).setUint32(4, h)
  ihdr[8] = 8; ihdr[9] = 6
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** { w, h, mime } de un PNG o JPEG, o null. */
export function imageSize (buf) {
  const v = view(buf)
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: v.getUint32(16), h: v.getUint32(20), mime: 'image/png' }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p++; continue }
      const marker = buf[p + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
      const len = v.getUint16(p + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: v.getUint16(p + 5), w: v.getUint16(p + 7), mime: 'image/jpeg' }
      }
      p += 2 + len
    }
  }
  return null
}
