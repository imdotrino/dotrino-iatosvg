// Lector mínimo de PDF: lo justo para sacar los streams privados de Illustrator.
// No resuelve xref: busca los objetos por su cabecera "N G obj" (los .ai de
// Illustrator no usan object streams para el PieceInfo, así que basta).
import zlib from 'node:zlib'

const MAX_PRIVATE = 256 << 20

/** Devuelve { dict, raw } del objeto `num`: el diccionario como texto y los bytes del stream (sin filtrar). */
export function readObject(buf, num) {
  const re = new RegExp(`(?:^|[\\r\\n])${num} 0 obj\\b`, 'g')
  const text = buf.toString('latin1')
  let m
  while ((m = re.exec(text))) {
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
    if (/^\d+ 0 R$/.test(len)) len = readObject(buf, Number(len.split(' ')[0])).dict
    const n = Number(len)
    if (!Number.isFinite(n)) throw new Error(`object ${num}: Length not found`)
    return { dict, raw: buf.subarray(dataStart, dataStart + n) }
  }
  throw new Error(`object ${num} not found`)
}

export function dictValue(dict, key) {
  const m = dict.match(new RegExp(`/${key}\\s*([^/>\\[]+|\\[[^\\]]*\\])`))
  return m ? m[1].trim() : null
}

/** Bytes del stream con sus filtros aplicados (solo FlateDecode o ninguno). */
export function decodeStream({ dict, raw }) {
  const filter = dictValue(dict, 'Filter')
  if (!filter) return raw
  if (/FlateDecode/.test(filter)) return zlib.inflateSync(raw, { maxOutputLength: MAX_PRIVATE })
  throw new Error(`unsupported stream filter: ${filter}`)
}

/** Las referencias `AIPrivateDataN` (o `AIPDFPrivateDataN`) del PieceInfo de la primera página, en orden. */
export function privateDataRefs(buf) {
  const text = buf.toString('latin1')
  const key = text.includes('/AIPrivateData1') ? 'AIPrivateData' : text.includes('/AIPDFPrivateData1') ? 'AIPDFPrivateData' : null
  if (!key) throw new Error('no Illustrator private data (AIPrivateData) in this PDF')
  const refs = []
  const re = new RegExp(`/${key}(\\d+)\\s+(\\d+)\\s+0\\s+R`, 'g')
  let m
  while ((m = re.exec(text))) refs.push([Number(m[1]), Number(m[2])])
  refs.sort((a, b) => a[0] - b[0])
  const numBlock = dictValue(text.slice(text.indexOf('/NumBlock')), 'NumBlock')
  return { key, numBlock: numBlock ? Number(numBlock) : refs.length, refs: refs.map(r => r[1]) }
}

/** Los streams privados unidos, todavía con su cabecera y su marcador de compresión. */
export function privateDataRaw(buf) {
  const { refs, numBlock } = privateDataRefs(buf)
  if (refs.length !== numBlock) throw new Error(`NumBlock says ${numBlock} streams, found ${refs.length}`)
  const parts = refs.map(n => decodeStream(readObject(buf, n)))
  return Buffer.concat(parts)
}

/** Página 1: MediaBox, TrimBox, BleedBox, ArtBox como arrays de números. */
export function pageBoxes(buf) {
  const text = buf.toString('latin1')
  const out = {}
  for (const k of ['MediaBox', 'TrimBox', 'BleedBox', 'ArtBox', 'CropBox']) {
    const m = text.match(new RegExp(`/${k}\\s*\\[([^\\]]+)\\]`))
    if (m) out[k] = m[1].trim().split(/\s+/).map(Number)
  }
  return out
}
