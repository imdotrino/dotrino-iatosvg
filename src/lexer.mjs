// Scanner de los datos de edición: tokens tipo PostScript, línea a línea.
//
// - Una línea que empieza con `%_` lleva tokens como cualquier otra (marcados `hidden`:
//   quien lee el formato impreso los salta como comentarios).
// - Cualquier otra línea que empieza con `%` es un comentario (los marcadores de sección).
// - Un `%` más adelante en la línea abre un comentario que se salta.
// - Los bytes de una imagen tras `%%BeginData:` son UN token `data`; la vista previa binaria
//   de un archivo enlazado es UN token `preview`.

import { ascii, find, latin1 } from './bytes.mjs'

const PREVIEW_BEGIN = ascii('%AI26_BeginPlacedObjectPreview')
const PREVIEW_END = ascii('%AI26_EndPlacedObjectPreview')
const DOCUMENT_BEGIN = ascii('%%BeginDocument')
const DOCUMENT_END = ascii('%%EndDocument')
const END_DATA = ascii('%%EndData')
const startsWith = (u8, prefix) => u8.length >= prefix.length && prefix.every((b, i) => u8[i] === b)

const isSpace = b => b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a || b === 0x0c || b === 0
const isEol = b => b === 0x0d || b === 0x0a
const DELIMS = new Set([...'()<>[]{}/%'].map(c => c.charCodeAt(0)))
const isDelim = b => DELIMS.has(b)

export function number(w) {
  if (!w.length) return null
  const f = w[0]
  if (!(f >= '0' && f <= '9') && f !== '+' && f !== '-' && f !== '.') return null
  if (/[a-df-zA-DF-Z]/.test(w)) return null
  const v = Number(w)
  return Number.isFinite(v) ? v : null
}

export class Lexer {
  constructor(src) {
    this.src = src
    this.pos = 0
    this.hidden = false
  }

  rest() { return this.src.subarray(this.pos) }
  atLineStart() { return this.pos === 0 || isEol(this.src[this.pos - 1]) }

  /** El resto de la línea actual (sin su fin), con la posición movida hasta ahí. */
  line() {
    const start = this.pos
    while (this.pos < this.src.length && !isEol(this.src[this.pos])) this.pos++
    return this.src.subarray(start, this.pos)
  }

  /** Salta hasta después de `needle` y devuelve lo saltado. */
  skipPast(needle) {
    const i = find(this.src, needle, this.pos)
    const end = i < 0 ? this.src.length : i + needle.length
    const out = this.src.subarray(this.pos, end)
    this.pos = end
    return out
  }

  next() {
    for (;;) {
      if (this.pos >= this.src.length) return null
      const b = this.src[this.pos]
      if (isEol(b)) { this.pos++; this.hidden = false; continue }
      if (isSpace(b)) { this.pos++; continue }
      if (b === 0x25 /* % */) {
        const start = this.atLineStart()
        if (start && this.src[this.pos + 1] === 0x5f /* _ */) {
          this.pos += 2
          this.hidden = true
          continue
        }
        const prefixed = this.hidden && this.pos >= 2 && this.src[this.pos - 2] === 0x25 && this.src[this.pos - 1] === 0x5f
        const line = this.line()
        if (start || prefixed) {
          const t = this.special(line)
          if (t) { t.hidden = prefixed; return t }
        }
        if (start) return { t: 'comment', v: latin1(line, 1), hidden: false }
        continue
      }
      const hidden = this.hidden
      this.pos++
      if (b === 0x28 /* ( */) return { t: 'str', v: this.string(), hidden }
      if (b === 0x3c /* < */) {
        const end = this.src.indexOf(0x3e, this.pos)
        const stop = end < 0 ? this.src.length : end
        let hex = latin1(this.src, this.pos, stop).replace(/[^0-9a-fA-F]/g, '')
        if (hex.length % 2) hex += '0'
        const bytes = new Uint8Array(hex.length >> 1)
        for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16)
        this.pos = stop + (end < 0 ? 0 : 1)
        return { t: 'hex', v: bytes, hidden }
      }
      if (b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d || b === 0x29 || b === 0x3e) {
        return { t: 'word', v: String.fromCharCode(b), hidden }
      }
      if (b === 0x2f /* / */) { const w = this.word(); return { t: 'name', v: latin1(w), hidden } }
      this.pos--
      const w = latin1(this.word())
      const n = number(w)
      return n === null ? { t: 'word', v: w, hidden } : { t: 'num', v: n, hidden }
    }
  }

  /** Lo que una línea de comentario significa cuando abre una sección que se lee distinto. */
  special(line) {
    for (const [begin, end, kind] of [[PREVIEW_BEGIN, PREVIEW_END, 'preview'], [DOCUMENT_BEGIN, DOCUMENT_END, 'comment']]) {
      if (startsWith(line, begin)) {
        const from = this.pos
        const i = find(this.src, end, this.pos)
        const after = i < 0 ? this.src.length : i
        this.pos = after
        this.line()
        if (kind === 'preview') return { t: 'preview', v: this.src.subarray(from, after), hidden: false }
        return { t: 'comment', v: latin1(line, 1), hidden: false }
      }
    }
    if (!startsWith(line, ascii('%%BeginData:'))) return null
    const text = latin1(line)
    const n = parseInt(text.slice('%%BeginData:'.length).trim().split(/\s+/)[0], 10)
    if (!Number.isFinite(n)) return null
    // La cuenta empieza tras el carácter de fin de la línea del comentario.
    const from = this.pos + 1
    let skip = 0
    while (from + skip < this.src.length && isSpace(this.src[from + skip])) skip++
    const head = latin1(this.src, from + skip, Math.min(this.src.length, from + skip + 4))
    const hidden = head.startsWith('%_XI')
    if (hidden) skip += 2
    else if (!head.startsWith('XI')) return null
    let data = from + skip + 2
    if (this.src[data] === 0x0d && this.src[data + 1] === 0x0a) data += 2
    else if (isEol(this.src[data])) data += 1
    // La cuenta no incluye el canal alfa: los datos acaban donde empieza `%%EndData`.
    const declared = Math.max(Math.min(from + n, this.src.length), data)
    const wStart = Math.max(declared - 4, data)
    const wEnd = Math.min(declared + n * 2 + 64, this.src.length)
    const i = find(this.src.subarray(wStart, wEnd), END_DATA)
    const end = i < 0 ? declared : wStart + i
    this.pos = end
    let samples = this.src.subarray(data, end)
    if (hidden && samples.length >= 2 && samples[samples.length - 2] === 0x25 && samples[samples.length - 1] === 0x5f) samples = samples.subarray(0, -2)
    return { t: 'data', v: samples, hidden: false }
  }

  word() {
    const start = this.pos
    while (this.pos < this.src.length) {
      const b = this.src[this.pos]
      if (isSpace(b) || isDelim(b)) break
      this.pos++
    }
    return this.src.subarray(start, this.pos)
  }

  /** Una cadena literal tras su `(`, con los escapes deshechos. */
  string() {
    const out = []
    let depth = 0
    while (this.pos < this.src.length) {
      const b = this.src[this.pos++]
      if (b === 0x28) { depth++; out.push(b); continue }
      if (b === 0x29) { if (depth === 0) break; depth--; out.push(b); continue }
      if (b !== 0x5c) { out.push(b); continue }
      if (this.pos >= this.src.length) break
      const e = this.src[this.pos++]
      switch (e) {
        case 0x6e: out.push(10); break
        case 0x72: out.push(13); break
        case 0x74: out.push(9); break
        case 0x62: out.push(8); break
        case 0x66: out.push(12); break
        case 0x0d: if (this.src[this.pos] === 0x0a) this.pos++; break
        case 0x0a: break
        default:
          if (e >= 0x30 && e <= 0x37) {
            let v = e - 0x30
            for (let k = 0; k < 2; k++) {
              const d = this.src[this.pos]
              if (d >= 0x30 && d <= 0x37) { v = v * 8 + (d - 0x30); this.pos++ } else break
            }
            out.push(v & 0xff)
          } else out.push(e)
      }
    }
    return Uint8Array.from(out)
  }
}

/** Texto de los bytes de los datos: UTF-8, y si no, Windows-1252. */
const UTF8 = new TextDecoder('utf-8', { fatal: true })
const CP1252 = new TextDecoder('windows-1252')
export function text (buf) {
  try { return UTF8.decode(buf) } catch { return CP1252.decode(buf) }
}
