// Utilidades de bytes que funcionan igual en Node y en el navegador (Uint8Array, sin Buffer).

const LATIN1 = new TextDecoder('latin1')

/**
 * Bytes → texto, un carácter por byte (para buscar en estructuras ASCII como PDF y PostScript).
 * @param {Uint8Array} u8
 * @param {number} [start]
 * @param {number} [end]
 * @returns {string}
 */
export function latin1 (u8, start = 0, end = u8.length) {
  const out = []
  for (let i = start; i < end; i += 0x10000) out.push(LATIN1.decode(u8.subarray(i, Math.min(end, i + 0x10000))))
  return out.join('')
}

/**
 * Texto ASCII → bytes.
 * @param {string} s
 * @returns {Uint8Array}
 */
export function ascii (s) {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/**
 * Posición de `needle` (bytes o texto ASCII) en `hay` desde `from`; -1 si no está.
 * @param {Uint8Array} hay
 * @param {Uint8Array | string} needle
 * @param {number} [from]
 * @returns {number}
 */
export function find (hay, needle, from = 0) {
  if (typeof needle === 'string') needle = ascii(needle)
  const n = needle.length
  if (!n) return from
  const first = needle[0]
  for (let i = hay.indexOf(first, from); i >= 0 && i <= hay.length - n; i = hay.indexOf(first, i + 1)) {
    let k = 1
    while (k < n && hay[i + k] === needle[k]) k++
    if (k === n) return i
  }
  return -1
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function concat (parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** @param {Uint8Array} u8 */
export function view (u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength) }

/**
 * @param {Uint8Array} u8
 * @returns {string}
 */
export function toBase64 (u8) {
  const parts = []
  for (let i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode(...u8.subarray(i, i + 0x8000)))
  return btoa(parts.join(''))
}

/**
 * @param {string} s
 * @returns {Uint8Array}
 */
export function fromBase64 (s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Hexadecimal (se saltan los caracteres que no lo son) → bytes.
 * @param {string} s
 * @returns {Uint8Array}
 */
export function fromHex (s) {
  const digits = s.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(digits.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.substr(i * 2, 2), 16)
  return out
}

/**
 * Pasa `u8` por un CompressionStream/DecompressionStream (`deflate` = zlib). Con tope de salida.
 * @param {Uint8Array} u8
 * @param {CompressionStream | DecompressionStream} stream
 * @param {number} [max]
 * @returns {Promise<Uint8Array>}
 */
export async function pipe (u8, stream, max = Infinity) {
  /** @type {ReadableStreamDefaultReader<Uint8Array>} */
  const reader = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (u8)]).stream().pipeThrough(stream).getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) { await reader.cancel(); throw Object.assign(new Error('decompressed data too large'), { code: 'too-large' }) }
    chunks.push(value)
  }
  return concat(chunks)
}
/** @type {(u8: Uint8Array, max?: number) => Promise<Uint8Array>} */
export const inflate = (u8, max) => pipe(u8, new DecompressionStream('deflate'), max)
/** @type {(u8: Uint8Array) => Promise<Uint8Array>} */
export const deflate = u8 => pipe(u8, new CompressionStream('deflate'))
