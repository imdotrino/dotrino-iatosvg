// @dotrino/iatosvg: .ai → SVG leyendo los datos de edición nativos de Illustrator.
// Funciona igual en Node (≥ 22) y en el navegador: solo usa Uint8Array, DataView y
// (De)CompressionStream.
import { privateDataRaw } from './pdf.mjs'
import { decodePrivate } from './private.mjs'
import { Reader } from './reader.mjs'
import { resolveImages } from './images.mjs'
import { toSvg } from './svg.mjs'
import { concat } from './bytes.mjs'

/**
 * Los datos de edición nativos de un .ai (sus bytes), decodificados.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ data: Uint8Array, codec: string | null }>}
 */
export async function editingData (bytes) {
  const raw = await privateDataRaw(bytes)
  const { header, data, codec } = await decodePrivate(raw)
  return { data: concat([header, data]), codec }
}

/**
 * El documento leído de los datos nativos: capas, mesas de trabajo, imágenes listas y avisos.
 * @param {Uint8Array} bytes
 * @param {import('./types.js').ResolveOptions} [opts]
 *   `resolveLink`: async (name) => Uint8Array | null, para los archivos enlazados;
 *   `maxImage`: lado mayor al incrustar un PSD enlazado (2048); `onProgress`: ({ step, … }) => void
 * @returns {Promise<import('./types.js').AiDocument>}
 */
export async function readAi (bytes, opts = {}) {
  const onProgress = opts.onProgress ?? (() => {})
  onProgress({ step: 'decode' })
  const { data } = await editingData(bytes)
  onProgress({ step: 'read', bytes: data.length })
  const doc = new Reader(data).run()
  await resolveImages(doc, opts)
  return doc
}

/**
 * .ai → SVG de una mesa de trabajo.
 * @param {Uint8Array} bytes
 * @param {import('./types.js').ResolveOptions & import('./types.js').SvgOptions} [opts]
 * @returns {Promise<{ svg: string, doc: import('./types.js').AiDocument }>}
 */
export async function aiToSvg (bytes, opts = {}) {
  const doc = await readAi(bytes, opts)
  return { svg: toSvg(doc, opts), doc }
}

export { toSvg, Reader, resolveImages }
