// Color: CMYK → sRGB por la LUT del perfil SWOP (interpolación cuadrilineal).
import { STEPS, LUT } from './cmyk-lut.mjs'

const unit = v => Math.min(1, Math.max(0, v))

/** CMYK (0..1) → sRGB (0..1). */
export function cmykToRgb (c, m, y, k) {
  const comps = [unit(c), unit(m), unit(y), unit(k)].map(v => v * (STEPS - 1))
  const lo = comps.map(v => Math.min(STEPS - 2, Math.floor(v)))
  const fr = comps.map((v, i) => v - lo[i])
  const out = [0, 0, 0]
  for (let bits = 0; bits < 16; bits++) {
    let w = 1, idx = 0
    for (let ch = 0; ch < 4; ch++) {
      const hi = (bits >> ch) & 1
      w *= hi ? fr[ch] : 1 - fr[ch]
      idx = idx * STEPS + lo[ch] + hi
    }
    if (w === 0) continue
    out[0] += w * LUT[idx * 3]; out[1] += w * LUT[idx * 3 + 1]; out[2] += w * LUT[idx * 3 + 2]
  }
  return out.map(v => v / 255)
}

const cache = new Map()
/** CMYK de 8 bits → RGB de 8 bits, con caché (para los píxeles de las imágenes). */
export function cmyk8ToRgb8 (c, m, y, k) {
  const key = ((c << 24) | (m << 16) | (y << 8) | k) >>> 0
  let v = cache.get(key)
  if (v === undefined) {
    v = cmykToRgb(c / 255, m / 255, y / 255, k / 255).map(x => Math.round(x * 255))
    if (cache.size > 1 << 18) cache.clear()
    cache.set(key, v)
  }
  return v
}
