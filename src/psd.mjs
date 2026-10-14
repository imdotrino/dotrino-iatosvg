// Lector mínimo de PSD/PSB: la imagen compuesta (la que Illustrator enseña), 8 o 16 bits,
// RGB, CMYK o gris (+ alfa), sin comprimir o RLE (PackBits). Reduce MIENTRAS decodifica, fila a
// fila, para no tener nunca la imagen entera en memoria (un PSD de impresión pasa de 300 MB).
import { latin1, view } from './bytes.mjs'
import { cmyk8ToRgb8 } from './color.mjs'

/** → { w, h, rgba } con el lado mayor ≤ `max`. */
export function decodePsd (buf, max = 2048) {
  if (latin1(buf, 0, 4) !== '8BPS') throw new Error('not a PSD')
  const v = view(buf)
  const version = v.getUint16(4)
  const channels = v.getUint16(12), h = v.getUint32(14), w = v.getUint32(18)
  const depth = v.getUint16(22), mode = v.getUint16(24)
  if (depth !== 8 && depth !== 16) throw new Error(`PSD depth ${depth} not supported`)
  if (![1, 3, 4].includes(mode)) throw new Error(`PSD colour mode ${mode} not supported`)
  const len = p => (version === 2 ? Number(v.getBigUint64(p)) : v.getUint32(p))
  let p = 26
  p += 4 + v.getUint32(p)                   // datos del modo de color
  p += 4 + v.getUint32(p)                   // recursos de imagen
  p += (version === 2 ? 8 : 4) + len(p)     // capas y máscaras
  const compression = v.getUint16(p); p += 2
  const bps = depth / 8
  const colour = mode === 1 ? 1 : mode === 3 ? 3 : 4
  const used = Math.min(channels, colour + 1)  // color + alfa; el resto (tintas planas) no
  // Reducción por cajas: f×f píxeles de origen por cada uno de destino.
  const f = Math.max(1, Math.ceil(Math.max(w, h) / max))
  const nw = Math.max(1, Math.floor(w / f)), nh = Math.max(1, Math.floor(h / f))
  const sums = Array.from({ length: used }, () => new Float32Array(nw * nh))
  const row = new Uint8Array(w * bps)
  const addRow = (c, y) => {
    const oy = Math.floor(y / f)
    if (oy >= nh) return
    const s = sums[c], base = oy * nw
    for (let x = 0, ox = 0, k = 0; ox < nw; x++) {
      s[base + ox] += row[x * bps]   // en 16 bits, el byte alto
      if (++k === f) { k = 0; ox++ }
    }
  }
  if (compression === 0) {
    for (let c = 0; c < channels; c++) for (let y = 0; y < h; y++) {
      if (c < used) { row.set(buf.subarray(p, p + w * bps)); addRow(c, y) }
      p += w * bps
    }
  } else if (compression === 1) {
    const cw = version === 2 ? 4 : 2
    const counts = new Array(h * channels)
    for (let i = 0; i < h * channels; i++) { counts[i] = cw === 4 ? v.getUint32(p) : v.getUint16(p); p += cw }
    for (let c = 0; c < channels; c++) for (let y = 0; y < h; y++) {
      const n = counts[c * h + y]
      if (c < used) { unpackBits(buf, p, n, row); addRow(c, y) }
      p += n
    }
  } else throw new Error(`PSD compression ${compression} not supported`)
  const cnt = f * f
  const rgba = new Uint8Array(nw * nh * 4)
  const alpha = used > colour ? sums[colour] : null
  for (let i = 0; i < nw * nh; i++) {
    const at = k => Math.round(sums[k][i] / cnt)
    let r, g, b
    if (colour === 1) r = g = b = at(0)
    else if (colour === 3) { r = at(0); g = at(1); b = at(2) }
    else [r, g, b] = cmyk8ToRgb8(255 - at(0), 255 - at(1), 255 - at(2), 255 - at(3)) // el PSD guarda el CMYK invertido
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = alpha ? at(colour) : 255
  }
  return { w: nw, h: nh, rgba }
}

function unpackBits (src, p, len, out) {
  const end = p + len
  let o = 0
  while (p < end && o < out.length) {
    let hdr = src[p++]
    if (hdr > 127) hdr -= 256
    if (hdr >= 0) { out.set(src.subarray(p, p + hdr + 1), o); o += hdr + 1; p += hdr + 1 } else if (hdr !== -128) { out.fill(src[p++], o, o + 1 - hdr); o += 1 - hdr }
  }
}
