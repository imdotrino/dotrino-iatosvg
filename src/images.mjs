// Las imágenes del documento, después de leerlo: busca los archivos enlazados, los decodifica y
// deja cada imagen lista para el SVG (bytes PNG o JPEG + su matriz). Es asíncrono porque leer un
// archivo en el navegador y comprimir un PNG lo son.
import { imageSize, encodePng } from './png.mjs'
import { decodePsd } from './psd.mjs'
import { mul } from './reader.mjs'

/**
 * @param doc lo que devuelve `Reader.run()`
 * @param opts.resolveLink async (name) => Uint8Array | null — el archivo enlazado por su nombre
 * @param opts.maxImage lado mayor al incrustar un PSD (2048)
 * @param opts.onProgress (texto) => void
 */
export async function resolveImages (doc, { resolveLink = null, maxImage = 2048, onProgress = () => {} } = {}) {
  const warn = w => { if (!doc.warnings.includes(w)) doc.warnings.push(w) }
  const images = []
  const walk = n => { if (n.type === 'image') images.push(n); for (const k of n.children ?? []) walk(k); for (const k of n.clip ?? []) walk(k) }
  doc.layers.forEach(walk)
  const cache = new Map()   // el mismo archivo enlazado varias veces se lee una vez
  for (const [i, n] of images.entries()) {
    if (n.placed) {
      const name = n.link.split(/[\\/]/).pop()
      onProgress({ step: 'link', name, index: i, total: images.length })
      let found = null
      if (name && resolveLink) {
        if (!cache.has(name)) cache.set(name, await loadLinked(name, resolveLink, maxImage, warn))
        found = cache.get(name)
      }
      if (found) {
        n.found = true
        Object.assign(n, found)
      } else if (n.preview) {
        if (resolveLink) warn(`placed file "${name}" not found: its low-resolution preview was used`)
        Object.assign(n, n.preview)
      } else {
        warn(`placed file "${name}" not found and the file keeps no preview of it: left out`)
        n.visible = false
        continue
      }
      n.preview = null
      // La caja lleva el cuadrado unidad a la imagen: cada píxel mide 1/w × 1/h de ella.
      n.xf = mul(n.box, [1 / n.w, 0, 0, 1 / n.h, 0, 0])
    }
    if (n.rgba) {
      onProgress({ step: 'encode', index: i, total: images.length })
      n.bytes = await encodePng(n.w, n.h, n.rgba)
      n.mime = 'image/png'
      n.rgba = null
    }
  }
  return doc
}

async function loadLinked (name, resolveLink, maxImage, warn) {
  let buf
  try { buf = await resolveLink(name) } catch (e) { warn(`placed file "${name}" could not be read (${e.message})`); return null }
  if (!buf) return null
  const size = imageSize(buf)
  if (size) return { bytes: buf, w: size.w, h: size.h, mime: size.mime }
  if (/\.ps[db]$/i.test(name)) {
    try { return decodePsd(buf, maxImage) } catch (e) { warn(`placed file "${name}" could not be decoded (${e.message})`); return null }
  }
  warn(`placed file "${name}" is of a kind that is not read (only PNG, JPEG and PSD)`)
  return null
}
