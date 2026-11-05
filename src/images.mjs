// Las imágenes del documento, después de leerlo: busca los archivos enlazados, los decodifica y
// deja cada imagen lista para el SVG (bytes PNG o JPEG + su matriz). Es asíncrono porque leer un
// archivo en el navegador y comprimir un PNG lo son.
import { imageSize, encodePng } from './png.mjs'
import { decodePsd } from './psd.mjs'
import { mul } from './reader.mjs'

/** @typedef {import('./types.js').ArtNode} ArtNode */
/** @typedef {import('./types.js').ImageNode} ImageNode */
/** @typedef {{ bytes: Uint8Array, w: number, h: number, mime: string } | import('./types.js').Raster} Decoded */

/**
 * @param {import('./types.js').AiDocument} doc  lo que devuelve `Reader.run()`
 * @param {import('./types.js').ResolveOptions} [opts]
 *   `resolveLink`: async (name) => Uint8Array | null, el archivo enlazado por su nombre;
 *   `maxImage`: lado mayor al incrustar un PSD (2048); `onProgress`: ({ step, … }) => void
 * @returns {Promise<import('./types.js').AiDocument>}
 */
export async function resolveImages (doc, { resolveLink = null, maxImage = 2048, onProgress = () => {} } = {}) {
  /** @param {string} w */
  const warn = w => { if (!doc.warnings.includes(w)) doc.warnings.push(w) }
  /** @type {ImageNode[]} */
  const images = []
  /** @param {ArtNode} n */
  const walk = n => { if (n.type === 'image') images.push(n); for (const k of n.children ?? []) walk(k); for (const k of n.clip ?? []) walk(k) }
  doc.layers.forEach(walk)
  /** @type {Map<string, Decoded | null>} */
  const cache = new Map()   // el mismo archivo enlazado varias veces se lee una vez
  for (const [i, n] of images.entries()) {
    if (n.placed) {
      // El último trozo de la ruta: split siempre da al menos uno.
      const name = /** @type {string} */ (n.link.split(/[\\/]/).pop())
      onProgress({ step: 'link', name, index: i, total: images.length })
      /** @type {Decoded | null | undefined} */
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
      n.xf = mul(n.box, [1 / imageWidth(n), 0, 0, 1 / imageHeight(n), 0, 0])
    }
    if (n.rgba) {
      onProgress({ step: 'encode', index: i, total: images.length })
      n.bytes = await encodePng(imageWidth(n), imageHeight(n), n.rgba)
      n.mime = 'image/png'
      n.rgba = null
    }
  }
  return doc
}

/**
 * @param {string} name
 * @param {(name: string) => Promise<Uint8Array | null>} resolveLink
 * @param {number} maxImage
 * @param {(w: string) => void} warn
 * @returns {Promise<Decoded | null>}
 */
async function loadLinked (name, resolveLink, maxImage, warn) {
  let buf
  try { buf = await resolveLink(name) } catch (e) { warn(`placed file "${name}" could not be read (${errorMessage(e)})`); return null }
  if (!buf) return null
  const size = imageSize(buf)
  if (size) return { bytes: buf, w: size.w, h: size.h, mime: size.mime }
  if (/\.ps[db]$/i.test(name)) {
    try { return decodePsd(buf, maxImage) } catch (e) { warn(`placed file "${name}" could not be decoded (${errorMessage(e)})`); return null }
  }
  warn(`placed file "${name}" is of a kind that is not read (only PNG, JPEG and PSD)`)
  return null
}

/** @param {unknown} e */
function errorMessage (e) {
  return /** @type {{ message?: unknown } | null} */ (e)?.message
}

/** @param {ImageNode} n */
function imageWidth (n) {
  if (n.w === undefined) throw new Error('an image without its width')
  return n.w
}

/** @param {ImageNode} n */
function imageHeight (n) {
  if (n.h === undefined) throw new Error('an image without its height')
  return n.h
}
