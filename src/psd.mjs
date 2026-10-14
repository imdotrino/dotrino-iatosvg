// Lector mínimo de PSD: la imagen compuesta (la que Illustrator enseña), 8 bits, RGB o CMYK
// (+ alfa), gris; compresión ninguna o RLE (PackBits). Devuelve { w, h, rgba }.
import { cmyk8ToRgb8 } from './reader.mjs'

export function decodePsd(buf) {
  if (buf.toString('latin1', 0, 4) !== '8BPS') throw new Error('not a PSD')
  const version = buf.readUInt16BE(4)
  const channels = buf.readUInt16BE(12), h = buf.readUInt32BE(14), w = buf.readUInt32BE(18)
  const depth = buf.readUInt16BE(22), mode = buf.readUInt16BE(24)
  if (depth !== 8 && depth !== 16) throw new Error(`PSD depth ${depth} not supported`)
  if (![1, 3, 4].includes(mode)) throw new Error(`PSD colour mode ${mode} not supported`)
  let p = 26
  p += 4 + buf.readUInt32BE(p)              // datos del modo de color
  p += 4 + buf.readUInt32BE(p)              // recursos de imagen
  p += (version === 2 ? 8 : 4) + (version === 2 ? Number(buf.readBigUInt64BE(p)) : buf.readUInt32BE(p)) // capas y máscaras
  const compression = buf.readUInt16BE(p); p += 2
  const n = w * h
  const bps = depth / 8
  const planes = []
  if (compression === 0) {
    for (let c = 0; c < channels; c++) { planes.push(plane8(buf, p, n, bps)); p += n * bps }
  } else if (compression === 1) {
    const counts = []
    for (let i = 0; i < h * channels; i++) { counts.push(version === 2 ? buf.readUInt32BE(p) : buf.readUInt16BE(p)); p += version === 2 ? 4 : 2 }
    for (let c = 0; c < channels; c++) {
      const out = Buffer.alloc(n * bps)
      let o = 0
      for (let y = 0; y < h; y++) {
        const len = counts[c * h + y]
        o = unpackBits(buf, p, len, out, o)
        p += len
      }
      planes.push(bps === 1 ? out : plane8(out, 0, n, bps))
    }
  } else throw new Error(`PSD compression ${compression} not supported`)
  const rgba = Buffer.alloc(n * 4)
  const colour = mode === 1 ? 1 : mode === 3 ? 3 : 4
  const alpha = channels > colour ? planes[colour] : null
  for (let i = 0; i < n; i++) {
    let r, g, b
    if (colour === 1) r = g = b = planes[0][i]
    else if (colour === 3) { r = planes[0][i]; g = planes[1][i]; b = planes[2][i] }
    else { ;[r, g, b] = cmyk8ToRgb8(255 - planes[0][i], 255 - planes[1][i], 255 - planes[2][i], 255 - planes[3][i]) } // el PSD guarda CMYK invertido
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = alpha ? alpha[i] : 255
  }
  return { w, h, rgba }
}

function plane8(buf, p, n, bps) {
  if (bps === 1) return buf.subarray(p, p + n)
  const out = Buffer.alloc(n)
  for (let i = 0; i < n; i++) out[i] = buf[p + i * 2]
  return out
}

function unpackBits(src, p, len, out, o) {
  const end = p + len
  while (p < end) {
    let hdr = src[p++]
    if (hdr > 127) hdr -= 256
    if (hdr >= 0) { src.copy(out, o, p, p + hdr + 1); o += hdr + 1; p += hdr + 1 }
    else if (hdr !== -128) { const v = src[p++]; out.fill(v, o, o + 1 - hdr); o += 1 - hdr }
  }
  return o
}

/** Reduce una imagen RGBA al lado mayor `max` (media de cajas); si ya cabe, la devuelve tal cual. */
export function downscale(img, max) {
  const { w, h, rgba } = img
  const side = Math.max(w, h)
  if (side <= max) return img
  const f = Math.ceil(side / max)
  const nw = Math.floor(w / f), nh = Math.floor(h / f)
  const out = Buffer.alloc(nw * nh * 4)
  const cnt = f * f
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let dy = 0; dy < f; dy++) {
      let i = ((y * f + dy) * w + x * f) * 4
      for (let dx = 0; dx < f; dx++, i += 4) { const al = rgba[i + 3]; r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al }
    }
    const o = (y * nw + x) * 4
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a }
    out[o + 3] = a / cnt
  }
  return { w: nw, h: nh, rgba: out }
}
