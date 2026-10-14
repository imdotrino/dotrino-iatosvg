import { privateDataRaw } from './pdf.mjs'
import { decodePrivate } from './private.mjs'
import { Reader } from './reader.mjs'
import { toSvg } from './svg.mjs'

/** Los datos de edición nativos de un .ai (bytes del archivo) decodificados. */
export function editingData(buf) {
  const raw = privateDataRaw(buf)
  const { header, data, codec } = decodePrivate(raw)
  return { data: Buffer.concat([header, data]), codec }
}

/** El documento (capas, mesas de trabajo, avisos) leído de los datos nativos. */
export function readAi(buf) {
  const { data } = editingData(buf)
  return new Reader(data).run()
}

/** .ai → SVG (una mesa de trabajo). */
export function aiToSvg(buf, opts = {}) {
  const doc = readAi(buf)
  return { svg: toSvg(doc, opts), doc }
}
export { toSvg }
