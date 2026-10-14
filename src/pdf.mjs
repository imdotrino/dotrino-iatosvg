// Lector mínimo de PDF: lo justo para sacar los streams privados de Illustrator.
// No resuelve xref: busca los objetos por su cabecera "N G obj" (los .ai de
// Illustrator no usan object streams para el PieceInfo, así que basta).
import { latin1, concat, inflate } from './bytes.mjs'

const MAX_PRIVATE = 256 << 20

/** { dict, raw } del objeto `num`: el diccionario como texto y los bytes del stream (sin filtrar). */
export function readObject (buf, text, num) {
  const re = new RegExp(`(?:^|[\\r\\n])${num} 0 obj\\b`, 'g')
  const m = re.exec(text)
  if (!m) throw new Error(`object ${num} not found`)
  const start = m.index + m[0].length
  const end = text.indexOf('endobj', start)
  const body = text.slice(start, end)
  const si = body.indexOf('stream')
  if (si < 0) return { dict: body.trim(), raw: null }
  const dict = body.slice(0, si).trim()
  let dataStart = start + si + 'stream'.length
  if (text[dataStart] === '\r') dataStart++
  if (text[dataStart] === '\n') dataStart++
  let len = dictValue(dict, 'Length')
  if (/^\d+ 0 R$/.test(len)) len = readObject(buf, text, Number(len.split(' ')[0])).dict
  const n = Number(len)
  if (!Number.isFinite(n)) throw new Error(`object ${num}: Length not found`)
  return { dict, raw: buf.subarray(dataStart, dataStart + n) }
}

export function dictValue (dict, key) {
  const m = dict.match(new RegExp(`/${key}\\s*([^/>\\[]+|\\[[^\\]]*\\])`))
  return m ? m[1].trim() : null
}

/** Bytes del stream con sus filtros aplicados (solo FlateDecode o ninguno). */
export async function decodeStream ({ dict, raw }) {
  const filter = dictValue(dict, 'Filter')
  if (!filter) return raw
  if (/FlateDecode/.test(filter)) return inflate(raw, MAX_PRIVATE)
  throw new Error(`unsupported stream filter: ${filter}`)
}

/** Las referencias `AIPrivateDataN` (o `AIPDFPrivateDataN`) del PieceInfo, en orden. */
export function privateDataRefs (text) {
  const key = text.includes('/AIPrivateData1') ? 'AIPrivateData' : text.includes('/AIPDFPrivateData1') ? 'AIPDFPrivateData' : null
  if (!key) throw Object.assign(new Error('no Illustrator editing data (AIPrivateData) in this file'), { code: 'no-editing-data' })
  const refs = []
  const re = new RegExp(`/${key}(\\d+)\\s+(\\d+)\\s+0\\s+R`, 'g')
  let m
  while ((m = re.exec(text))) refs.push([Number(m[1]), Number(m[2])])
  refs.sort((a, b) => a[0] - b[0])
  const at = text.indexOf('/NumBlock')
  const numBlock = at >= 0 ? dictValue(text.slice(at), 'NumBlock') : null
  return { key, numBlock: numBlock ? Number(numBlock) : refs.length, refs: refs.map(r => r[1]) }
}

/** Los streams privados unidos, todavía con su cabecera y su marcador de compresión. */
export async function privateDataRaw (buf) {
  if (latin1(buf, 0, 5) !== '%PDF-') throw Object.assign(new Error('not a PDF-based .ai file'), { code: 'not-pdf' })
  const text = latin1(buf)
  const { refs, numBlock } = privateDataRefs(text)
  if (refs.length !== numBlock) throw new Error(`NumBlock says ${numBlock} streams, found ${refs.length}`)
  const parts = []
  for (const n of refs) parts.push(await decodeStream(readObject(buf, text, n)))
  return concat(parts)
}
