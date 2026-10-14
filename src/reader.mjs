// Intérprete de los datos de edición de Illustrator: el programa de operadores → un árbol de
// capas, grupos, trazados, imágenes y gradientes, en el espacio del arte (y hacia arriba).
//
// Semántica (de la especificación AI7 de Adobe y de lo que se observa en archivos actuales):
//   capas       %AI5_BeginLayer … `… Lb` (opciones) `(nombre) Ln` … `LB`
//   grupos      u … U      compuestos *u … *U      recorte q … Q (o `W` en un grupo)
//   trazados    x y m | l/L | x1 y1 x2 y2 x3 y3 c/C | v/V | y/Y | h ; pintar: N n F f S s B b
//   colores     g/G gris · k/K CMYK · x/X tinta nombrada · Xa/XA RGB (con su CMYK delante)
//               Xx/XX, Xk/XK nombrados de cualquier modelo. Minúscula = relleno, mayúscula = trazo.
//   trazo       w J j M d ; regla XR ; sobreimpresión O R
//   estado      modo opacidad aislar knockout forma Xy ; 1 Xw = oculto ; A = bloqueado
//   gradientes  (nombre) tipo n Bd … Bs … BD (definición) ; Bb Bg Xm Bm Bh BB (instancia)
//   imágenes    %AI5_BeginRaster … /Espacio XN … [matriz] … XI <bytes> %%EndData
//   enlazados   %AI5_BeginPlace … [matriz] llx lly urx ury … (ruta) … vista previa … ~
//   diccionarios /Tipo : … valores clave , … ;   (/Document lleva las mesas de trabajo)
//   `%_`        líneas con el "aspecto dibujado" de objetos con estilos: un grupo oculto delante
//               del objeto, y `1 (estilo) XW` detrás. Se dibuja el aspecto, no el objeto.
import { Lexer, text } from './lexer.mjs'
import { fromHex, latin1 } from './bytes.mjs'
import { cmykToRgb, cmyk8ToRgb8 } from './color.mjs'

const MAX_DEPTH = 256
const CANVAS_CENTRE = 8191.5
const MAX_PIXELS = 1 << 25

export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn',
  'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']

const SKIPPED = [
  ['BeginPattern', 'EndPattern'], ['BeginBrushPattern', 'EndBrushPattern'], ['BeginSVGFilter', 'EndSVGFilter'],
  ['BeginSymbol', 'EndSymbol'], ['BeginPluginObject', 'EndPluginObject'], ['BeginArtStyles', 'EndArtStyles'],
  ['BeginArtStyleList', 'EndArtStyleList'], ['BeginPalette', 'EndPalette'], ['BeginSymbolList', 'EndSymbolList'],
  ['BeginTextDocument', 'EndTextDocument'], ['BeginEncoding', 'EndEncoding'], ['Alternate_Content', 'End_Versioned_Content'],
]
const IGNORED = new Set(['Bc', 'Ae', 'AE', 'Ap', 'As', 'Xd', 'Xr', 'XG', 'Xh', 'XH', 'XF', 'D', 'X=', 'Xr', 'XI', 'Bn', 'Np', 'Pc', 'Zmz', 'XP', 'Xt', 'XT', 'XY', 'Xz', 'XQ', 'Xg', 'XD', 'Xi', 'Xs', 'XS', 'XV', 'Xv', 'XL', 'XE', 'Xe', 'XC', 'Xc', 'Xb', 'XB', 'Xn', 'Xo', 'Xq', 'Xu', 'XU', 'Xl', 'XJ', 'XZ', 'XM', 'XO', '%_'])

/** Marcador de un comentario de sección sin su prefijo `AI<versión>_` (`AI14_BeginSymbol` → `BeginSymbol`). */
function marker(c) {
  const word = c.split(/[:\s]/)[0]
  const m = word.match(/^AI\d*_(.*)$/)
  return m ? m[1] : word
}

// Valores de la pila: number | {s:Uint8Array} | {n:string} | {a:[]} | {o:Obj} | MARK
const MARK = Symbol('[')
const num = v => (typeof v === 'number' ? v : null)
const nums = vals => vals.filter(v => typeof v === 'number')
const vtext = v => (v && v.s ? text(v.s) : v && v.n !== undefined ? v.n : null)
const lastText = vals => { for (let i = vals.length - 1; i >= 0; i--) { const t = vtext(vals[i]); if (t !== null) return t } return null }
const lastArr = vals => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] && vals[i].a) return nums(vals[i].a); return null }

function affine(n) {
  if (n.length !== 6 || !n.every(Number.isFinite)) return null
  return n.slice()
}
export function mul(m, n) { // m ∘ n: primero n, después m
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
}
export function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] }
export function det(m) { return m[0] * m[3] - m[1] * m[2] }
export function invert(m) {
  const d = det(m)
  if (Math.abs(d) < 1e-12) return null
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}
const FLIP = [1, 0, 0, -1, 0, 0]

// ---- colores ------------------------------------------------------------------------------

const unit = v => Math.min(1, Math.max(0, v))
export { cmykToRgb }
const tinted = (rgb, tint) => rgb.map(v => 1 - (1 - v) * tint)
const solid = (rgb, extra = {}) => ({ type: 'solid', rgb, ...extra })

/** `c m y k (nombre) tinta x` o `c m y k [r g b | L a b] (nombre) tinta tipo Xx` (tipo 1 RGB, 2 Lab). */
function named(vals, forceRgb) {
  let at = -1
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] && vals[i].s) { at = i; break }
  if (at < 0) return null
  const name = text(vals[at].s)
  const before = nums(vals.slice(0, at))
  const after = nums(vals.slice(at + 1))
  if (!after.length) return null
  const tint = 1 - unit(after[0])
  const kind = after[1]
  const n = before.length
  let rgb
  if (forceRgb === true || (forceRgb === undefined && kind === 1)) {
    if (n < 3) return null
    rgb = before.slice(n - 3).map(unit)
  } else if (forceRgb === undefined && kind === 2) {
    if (n < 3) return null
    rgb = labToRgb(...before.slice(n - 3))
  } else {
    const from = n >= 7 ? n - 7 : n - 4
    if (from < 0) return null
    rgb = cmykToRgb(...before.slice(from, from + 4))
  }
  return solid(tinted(rgb, tint), { swatch: name, tint })
}
function labToRgb(L, a, b) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200
  const f = t => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  x = 0.95047 * f(x); y = 1.0 * f(y); z = 1.08883 * f(z)
  const g = v => { v = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v; return unit(v) }
  return [g(3.2406 * x - 1.5372 * y - 0.4986 * z), g(-0.9689 * x + 1.8758 * y + 0.0415 * z), g(0.0557 * x - 0.204 * y + 1.057 * z)]
}
function colorOp(op, vals) {
  const n = nums(vals)
  const last = k => (n.length >= k ? n.slice(n.length - k) : null)
  switch (op.toLowerCase()) {
    case 'g': return n.length ? solid([1 - unit(n[n.length - 1])].flatMap(v => [v, v, v])) : null
    case 'k': { const v = last(4); return v ? solid(cmykToRgb(...v), { cmyk: v }) : null }
    case 'xa': { const v = last(3); return v ? solid(v.map(unit)) : null }
    case 'x': return named(vals, false)
    case 'xx': return named(vals, undefined)
    case 'xk': return named(vals, undefined)
    default: return null
  }
}
function stopColor(style, comps) {
  const n = nums(comps)
  const tail = k => (n.length >= k ? n.slice(n.length - k) : null)
  switch (style | 0) {
    case 0: return n.length ? [1 - unit(n[n.length - 1])].flatMap(v => [v, v, v]) : null
    case 1: { const v = tail(4); return v ? cmykToRgb(...v) : null }
    case 2: { const v = tail(3); return v ? v.map(unit) : null }
    default: { const p = named(comps, (style | 0) === 4 ? true : undefined); return p ? p.rgb : null }
  }
}

// ---- diccionarios ---------------------------------------------------------------------------

class Obj {
  constructor(ty) { this.ty = ty; this.entries = []; this.content = [] }
  get(key) { const e = this.entries.find(([k]) => k === key); return e ? e[1] : null }
  nums(key) { return nums(this.get(key) ?? []) }
  text(key) { const v = (this.get(key) ?? []).find(x => x && x.s); return v ? text(v.s) : null }
  items() { return [...this.entries.flatMap(([, v]) => v), ...this.content].filter(v => v && v.o).map(v => v.o) }
}
function addEntry(o, stack, base) {
  const vals = stack.splice(Math.min(base, stack.length))
  if (o.ty === 'Array') { o.entries.push([null, vals]); return }
  let key = null
  const last = vals[vals.length - 1]
  if (last && (last.s || last.n !== undefined)) { vals.pop(); key = vtext(last) }
  o.entries.push([key, vals])
}
function closeObj(o, stack, base) {
  if (stack.length <= base) return
  const last = stack[stack.length - 1]
  if (o.ty !== 'Array' && last && last.n !== undefined) addEntry(o, stack, base)
  else o.content.push(...stack.splice(base))
}
function findEntry(o, key, depth) {
  const direct = o.get(key)
  if (direct) { const v = direct.find(x => x && x.o); if (v) return v.o }
  if (depth >= 8) return null
  for (const item of o.items()) { const f = findEntry(item, key, depth + 1); if (f) return f }
  return null
}

// ---- el lector --------------------------------------------------------------------------------

function defaultGs() {
  return { fill: solid([0, 0, 0]), stroke: solid([0, 0, 0]), width: 1, cap: 'butt', join: 'miter', miter: 4, dash: null,
    rule: 'nonzero', opacity: 1, blend: 'normal', hidden: false, locked: false, overprintFill: false, overprintStroke: false }
}

export class Reader {
  constructor(data) {
    this.lex = new Lexer(data)
    this.stack = []
    this.marks = []
    this.frames = []
    this.layers = []
    this.gs = defaultGs()
    this.path = []
    this.clipNext = false
    this.gradients = new Map()
    this.gradientDef = null
    this.instance = null
    this.pendingFill = null
    this.pendingStroke = null
    this.raster = null
    this.place = null
    this.afterObject = false
    this.groupEnded = false
    this.artboards = []
    this.cropmarks = null
    this.templateCenter = null
    this.bbox = null
    this.colorModel = null
    this.warnings = new Set()
    this.unknown = new Set()
    this.counts = { paths: 0, images: 0, placed: 0, groups: 0, looks: 0 }
    this.done = false
  }

  warn(w) { this.warnings.add(w) }

  run() {
    let t
    while (!this.done && (t = this.lex.next())) {
      switch (t.t) {
        case 'num': this.stack.push(t.v); break
        case 'str': case 'hex': this.stack.push({ s: t.v }); break
        case 'name': this.stack.push({ n: t.v }); break
        case 'word': this.op(t.v, t.hidden); break
        case 'comment': this.comment(t.v); break
        case 'data': this.image(t.v, t.hidden); break
        case 'preview': if (this.place) this.place.preview = t.v; break
      }
      if (this.stack.length > 100000) this.stack.splice(0, 50000)
    }
    return this.finish()
  }

  // ---- comentarios ----
  comment(c) {
    const line = c.trimEnd()
    const m = marker(line)
    const skipped = SKIPPED.find(([b]) => b === m)
    if (skipped) return this.skipTo(skipped[1], skipped[0])
    if (m === '%BeginProlog') return this.skipTo('%EndProlog')
    if (m === '%BeginResource') return this.skipTo('%EndResource')
    if (m === '%PageTrailer' || m === '%Trailer') { this.done = true; return }
    if (line.startsWith('AI5_BeginLayer')) return this.open('layer', false)
    if (line.startsWith('AI5_BeginRaster')) this.raster = { space: null }
    else if (line.startsWith('AI5_EndRaster')) this.raster = null
    else if (line.startsWith('AI5_BeginPlace')) this.place = { matrix: null, bounds: null, path: '', preview: null }
    else if (line.startsWith('AI5_EndPlace')) { if (this.place) { this.place = null; this.warn('a placed file without preview was left out') } }
    else if (line.startsWith('%HiResBoundingBox:')) this.bbox = four(line.slice(18)) ?? this.bbox
    else if (line.startsWith('%BoundingBox:') && !this.bbox) this.bbox = four(line.slice(13))
    else if (line.startsWith('AI3_Cropmarks:')) this.cropmarks = four(line.slice(14))
    else if (line.startsWith('AI3_TemplateBox:')) { const n = four(line.slice(16)); if (n) this.templateCenter = [n[0], n[1]] }
    else if (line.startsWith('AI9_ColorModel:')) this.colorModel = line.slice(15).trim()
  }

  /** Salta hasta el comentario con marcador `end` (las secciones iguales anidadas cuentan). */
  skipTo(end, begin = '') {
    if (end === 'End_Versioned_Content') begin = 'Begin_Content_if_version_gt'
    let depth = 0, t
    while ((t = this.lex.next())) {
      if (t.t !== 'comment') continue
      const m = marker(t.v.trimEnd())
      if (begin && m === begin) depth++
      else if (m === end) { if (depth === 0) return; depth-- }
    }
    throw new Error(`section ending with %${end} does not end`)
  }

  // ---- marcos ----
  open(kind, hidden) {
    if (this.frames.length >= MAX_DEPTH) throw new Error('objects nested too deeply')
    const base = kind === 'obj' ? this.stack.length : (this.frames.length ? this.frames[this.frames.length - 1].base : 0)
    this.frames.push({ kind, children: [], hidden, gs: { ...this.gs }, base, clips: [], attrs: {} })
    this.afterObject = false
  }
  top() { return this.frames[this.frames.length - 1] }
  operands() {
    const base = Math.min(this.top() ? this.top().base : 0, this.stack.length)
    return this.stack.splice(base)
  }
  add(node, hidden) {
    node.hidden = hidden
    const f = this.top()
    if (!f) throw new Error('art outside its layers')
    f.children.push(node)
    this.lastObject = node
    this.afterObject = true
  }

  // ---- operadores ----
  op(w, hidden) {
    if (w === '[') { this.marks.push(this.stack.length); this.stack.push(MARK); return }
    if (w === ']') {
      let at = this.stack.length
      while (this.marks.length) { const m = this.marks.pop(); if (this.stack[m] === MARK) { at = m; break } }
      const items = this.stack.splice(at).slice(1)
      this.stack.push({ a: items })
      return
    }
    if (w === ':') { // abre un diccionario: su tipo es el nombre de encima
      const ty = this.stack.length && this.stack[this.stack.length - 1].n !== undefined ? this.stack.pop().n : ''
      this.open('obj', hidden)
      this.top().obj = new Obj(ty)
      return
    }
    if (w === ',') {
      const f = this.top()
      if (f && f.kind === 'obj') {
        addEntry(f.obj, this.stack, f.base)
        const last = f.obj.entries[f.obj.entries.length - 1]
        const key = last ? last[0] : null
        if (f.obj.ty === 'Binary' && key === 'ASCII85Decode') this.lex.skipPast('~>')
        else if (f.obj.ty === 'ForeignObject' && key === 'Data') { this.lex.skipPast('~>'); this.warn('non-native art (a placed PDF) was left out') }
      }
      return
    }
    if (w === ';') return this.endObj()

    if (!['Xy', 'Xd', 'XW', 'BB'].includes(w)) this.afterObject = false
    const groupEnded = this.groupEnded; this.groupEnded = false
    const vals = this.operands()

    if (this.gradientDef) {
      if (w === 'Bs') this.gradientStop(vals)
      else if (w === 'BD') this.gradientEnd()
      return
    }
    if (w === 'X!' || this.mesh) {
      const name = lastText(vals)
      if (w === 'X!' && name === 'Mesh') { this.path = []; this.mesh = true; this.warn('gradient meshes are not drawn'); return }
      if (w === 'X!' && name === 'End') { this.mesh = false; return }
      if (this.mesh) return
    }
    switch (w) {
      case 'u': this.path = []; this.open('group', hidden); break
      case '*u': this.path = []; this.open('compound', hidden); break
      case 'q': this.path = []; this.open('clip', hidden); break
      case 'U': case '*U': case 'Q': this.endContainer(w, hidden); break
      case 'Lb': this.layerAttrs(vals); break
      case 'Ln': { const f = this.top(); if (f && f.kind === 'layer') f.attrs.name = lastText(vals) ?? ''; break }
      case 'LB': this.endLayer(); break
      case 'm': case 'l': case 'L': case 'c': case 'C': case 'v': case 'V': case 'y': case 'Y': this.pathOp(w, vals); break
      case 'h': this.closePath(); break
      case 'H': break
      case 'W': this.clipNext = true; break
      case 'N': case 'n': case 'F': case 'f': case 'S': case 's': case 'B': case 'b': this.paint(w, hidden, false); break
      case '*': this.paint(lastText(vals) ?? 'N', hidden, true); break
      case 'g': case 'G': case 'k': case 'K': case 'x': case 'X': case 'Xa': case 'XA': case 'Xx': case 'XX': case 'Xk': case 'XK': {
        const p = colorOp(w, vals)
        if (p) { const last = w[w.length - 1]; if (last === last.toLowerCase()) this.gs.fill = p; else this.gs.stroke = p }
        break
      }
      case 'p': case 'P': this.warn('pattern fills are not drawn (they come as plain colour)'); break
      case 'O': this.gs.overprintFill = nums(vals).pop() === 1; break
      case 'R': this.gs.overprintStroke = nums(vals).pop() === 1; break
      case 'XR': this.gs.rule = nums(vals).pop() === 1 ? 'evenodd' : 'nonzero'; break
      case 'w': { const v = nums(vals).pop(); if (v >= 0) this.gs.width = v; break }
      case 'J': this.gs.cap = ['butt', 'round', 'square'][nums(vals).pop() | 0] ?? 'butt'; break
      case 'j': this.gs.join = ['miter', 'round', 'bevel'][nums(vals).pop() | 0] ?? 'miter'; break
      case 'M': { const v = nums(vals).pop(); if (v >= 1) this.gs.miter = Math.min(v, 500); break }
      case 'd': {
        const pattern = lastArr(vals) ?? []
        const offset = nums(vals).pop() ?? 0
        this.gs.dash = pattern.length && pattern.every(v => v >= 0) ? { pattern, offset } : null
        break
      }
      case 'Xy': this.transparency(vals); break
      case 'Xd': if (groupEnded && this.lastObject && this.lastObject.type === 'group') { Object.assign(this.lastObject, { opacity: this.gs.opacity, blend: this.gs.blend }) } break
      case 'Xw': this.gs.hidden = nums(vals).pop() === 1; break
      case 'A': this.gs.locked = nums(vals).pop() === 1; break
      case 'XW': this.styleMarker(vals, hidden); break
      case 'Bd': this.gradientBegin(vals); break
      case 'Bs': case 'BD': break
      case 'Bb': this.instance = { stroke: nums(vals).pop() === 1, name: null, origin: [0, 0], angle: 0, length: 1, bg: null, xm: null, bm: null, hilight: [0, 0] }; break
      case 'Bg': if (this.instance) {
        let at = -1; for (let i = vals.length - 1; i >= 0; i--) if (vals[i] && vals[i].s) { at = i; break }
        if (at >= 0) {
          this.instance.name = text(vals[at].s)
          const n = nums(vals.slice(at + 1))
          if (n.length >= 4) { this.instance.origin = [n[0], n[1]]; this.instance.angle = n[2]; this.instance.length = n[3]; this.instance.bg = affine(n.slice(4, 10)) }
        }
      } break
      case 'Bm': if (this.instance) { const m = matrixOf(vals); if (m) this.instance.bm = [this.instance.bm ? this.instance.bm[0] : m, m] } break
      case 'Xm': if (this.instance) this.instance.xm = matrixOf(vals); break
      case 'Bh': if (this.instance) { const n = nums(vals); if (n.length >= 2) this.instance.hilight = [n[0], n[1]] } break
      case 'BB': if (this.instance) { const i = this.instance; this.instance = null; if (this.path.length) this.setInstance(i) } break
      case 'XN': if (this.raster) this.raster.space = lastText(vals); break
      case '`': if (this.place) this.placeOperands(vals); break
      case '~': if (this.place) { if (!this.place.matrix) this.placeOperands(vals); this.endPlace(hidden) } break
      case 'To': case 'TO': case 'Tp': case 'TP': case 'Tx': case 'TX': case 'Tj': case 'Tk':
        this.warn('type objects are not read: only their drawn look (if the file keeps one)'); break
      default:
        if (IGNORED.has(w) || !this.frames.length) break
        if (this.unknown.size < 32) this.unknown.add(w)
    }
  }

  endObj() {
    const f = this.top()
    if (!f || f.kind !== 'obj') return
    this.frames.pop()
    closeObj(f.obj, this.stack, f.base)
    const o = f.obj
    if (o.ty === 'Document') this.document(o)
    else if (o.ty === 'ArtDictionary') { const name = o.text('AIArtName'); if (name && this.afterObject && this.lastObject) this.lastObject.name = name }
    else if (o.ty === 'SymbolInstance') this.warn('symbol instances are not drawn')
    this.stack.push({ o })
  }

  document(o) {
    const list = findEntry(o, 'ArtboardArray', 0)
    if (!list) return
    list.items().slice(0, 1000).forEach((ab, i) => {
      const p1 = ab.nums('PositionPoint1'), p2 = ab.nums('PositionPoint2')
      if (p1.length < 2 || p2.length < 2) return
      const r = { x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1]) }
      if (r.x1 - r.x0 <= 0 || r.y1 - r.y0 <= 0) return
      this.artboards.push({ name: ab.text('Name') ?? `Artboard ${i + 1}`, ...r })
    })
  }

  layerAttrs(vals) {
    const f = this.top()
    if (!f || f.kind !== 'layer') return
    const n = nums(vals)
    const flag = (i, d) => (n[i] === undefined ? d : n[i] !== 0)
    f.attrs.visible = flag(0, true)
    f.attrs.preview = flag(1, true)
    f.attrs.locked = !flag(2, true)
    f.attrs.printable = flag(3, true)
  }

  endLayer() {
    const f = this.frames.pop()
    if (!f || f.kind !== 'layer') throw new Error('`LB` closes something it did not open')
    const node = { type: 'layer', name: f.attrs.name ?? '', visible: f.attrs.visible !== false, printable: f.attrs.printable !== false,
      ...this.clipFirst(f.children, f.clips), hidden: false }
    if (this.frames.length) { this.top().children.push(node); this.afterObject = true } else this.layers.push(node)
  }

  endContainer(w, hidden) {
    const want = { U: 'group', '*U': 'compound', Q: 'clip' }[w]
    const f = this.frames.pop()
    if (!f || f.kind !== want) throw new Error(`\`${w}\` closes something it did not open`)
    const clipping = f.kind === 'compound' && f.clips.length > 0
    this.groupEnded = f.kind !== 'compound'
    let node, painted = null
    if (f.kind === 'compound' && !f.children.some(k => k.look)) {
      const kids = ungrouped(f.children)
      const fills = kids.filter(k => k.clipFillCopy), rest = kids.filter(k => !k.clipFillCopy)
      painted = this.compound(fills, f.gs)
      node = this.compound(rest, f.gs)
      if (!node) return
      if (clipping) node.clipping = true
    } else {
      node = { type: 'group', ...this.clipFirst(f.children, f.clips), opacity: 1, blend: 'normal' }
      this.counts.groups++
    }
    if (clipping) this.top().clips.push(this.top().children.length)
    this.add(node, f.hidden || hidden)
    if (painted) { painted.clipFillCopy = true; this.add(painted, f.hidden || hidden) }
  }

  compound(kids, gs) {
    if (!kids.length) return null
    const shown = [...kids].reverse().find(k => k.fill || k.stroke) ?? kids[kids.length - 1]
    const node = { type: 'compound', children: kids, fill: shown.fill, stroke: shown.stroke, strokeProps: shown.strokeProps,
      rule: shown.rule, opacity: shown.opacity, blend: shown.blend, visible: kids.every(k => k.visible !== false) || shown.visible !== false }
    for (const k of kids) { k.opacity = 1; k.blend = 'normal' }
    return node
  }

  /** Los hijos con los trazados de recorte aparte: { children, clip: [paths] | null }. */
  clipFirst(kids, clips) {
    const clipNodes = kids.filter((_, i) => clips.includes(i))
    const rest = kids.filter((_, i) => !clips.includes(i))
    const fills = rest.filter(k => k.clipFillCopy), others = rest.filter(k => !k.clipFillCopy)
    return { children: [...fills, ...others], clip: clipNodes.length ? clipNodes : null }
  }

  // ---- trazados ----
  pathOp(w, vals) {
    const n = nums(vals)
    const p = i => (n.length >= i ? [n[n.length - i], n[n.length - i + 1]] : null)
    const cur = this.current()
    switch (w) {
      case 'm': { const a = p(2); if (a) this.path.push(['M', ...a]); break }
      case 'l': case 'L': { const a = p(2); if (cur && a) this.path.push(['L', ...a]); break }
      case 'c': case 'C': { const a = p(6), b = p(4), c = p(2); if (cur && a && b && c) this.path.push(['C', ...a, ...b, ...c]); break }
      case 'v': case 'V': { const b = p(4), c = p(2); if (cur && b && c) this.path.push(['C', ...cur, ...b, ...c]); break }
      default: { const a = p(4), c = p(2); if (cur && a && c) this.path.push(['C', ...a, ...c, ...c]) }
    }
  }
  current() {
    for (let i = this.path.length - 1; i >= 0; i--) {
      const s = this.path[i]
      if (s[0] === 'Z') { // tras cerrar, el punto actual es el inicio del subtrazado
        for (let j = i - 1; j >= 0; j--) if (this.path[j][0] === 'M') return [this.path[j][1], this.path[j][2]]
        return null
      }
      return [s[s.length - 2], s[s.length - 1]]
    }
    return null
  }
  closePath() { if (this.path.length && this.path[this.path.length - 1][0] !== 'Z') this.path.push(['Z']) }

  paint(op, hidden, guide) {
    const segs = this.path; this.path = []
    const clip = this.clipNext; this.clipNext = false
    if (this.instance) { const i = this.instance; this.instance = null; this.setInstance(i) }
    const fillPaint = this.pendingFill, strokePaint = this.pendingStroke
    this.pendingFill = this.pendingStroke = null
    if (!segs.length) return
    if (op[0] === op[0].toLowerCase()) { if (segs[segs.length - 1][0] !== 'Z') segs.push(['Z']) }
    const gs = this.gs
    const lower = op.toLowerCase()
    const fill = (lower === 'f' || lower === 'b') && !clip
    const stroke = (lower === 's' || lower === 'b') && !clip
    const node = { type: 'path', segs, rule: gs.rule, clipping: clip, guide,
      fill: fill ? (fillPaint ?? gs.fill) : null,
      stroke: stroke ? (strokePaint ?? gs.stroke) : null,
      strokeProps: { width: gs.width, cap: gs.cap, join: gs.join, miter: gs.miter, dash: gs.dash },
      opacity: gs.opacity, blend: gs.blend, visible: !gs.hidden }
    this.counts.paths++
    if (clip) this.top().clips.push(this.top().children.length)
    // El relleno de un trazado de recorte se pinta también, bajo lo que recorta.
    const paintedToo = clip && (lower === 'f' || lower === 'b') && (fillPaint ?? gs.fill)
    this.add(node, hidden)
    if (paintedToo) {
      const copy = { ...node, clipping: false, fill: fillPaint ?? gs.fill, stroke: null, clipFillCopy: true }
      this.add(copy, hidden)
    }
  }

  // ---- transparencia y estilos ----
  transparency(vals) {
    const n = nums(vals)
    if (n.length < 2) return
    const [mode, opacity] = n
    this.gs.blend = BLENDS[mode | 0] ?? 'normal'
    this.gs.opacity = Number.isFinite(opacity) ? unit(opacity) : 1
    if (this.afterObject && this.lastObject && (this.lastObject.type === 'group' || this.lastObject.type === 'compound')) {
      this.lastObject.opacity = this.gs.opacity
      this.lastObject.blend = this.gs.blend
    }
  }

  /** `n (estilo) XW` tras un objeto: con `1`, el objeto tiene un estilo y lo que va justo antes
   *  (un grupo en líneas `%_`) es su aspecto dibujado. Se dibuja el aspecto y se quita el objeto. */
  styleMarker(vals, hidden) {
    const code = nums(vals).pop()
    const after = this.afterObject; this.afterObject = false
    const f = this.top()
    if (!f) return
    if (code === 9) { const look = f.children[f.children.length - 1]; if (look && look.type === 'group') look.look = true }
    if (code !== 1 || !after) return
    const n = f.children.length
    const object = f.children[n - 1], look = f.children[n - 2]
    if (!object || !look || !object.hidden || look.hidden !== hidden || look.type !== 'group' || look.clip) return
    f.children.splice(n - 1, 1)
    look.name = object.name ?? look.name
    look.visible = object.visible
    look.promoted = true
    if (!hidden) this.counts.looks++
  }

  // ---- gradientes ----
  gradientBegin(vals) {
    const name = vtext(vals.find(v => v && v.s))
    if (name === null) return
    const n = nums(vals)
    this.gradientDef = { name, kind: n[0] === 1 ? 'radial' : 'linear', stops: [] }
  }
  gradientStop(vals) {
    const d = this.gradientDef
    if (d.stops.length >= 256) return
    const n = vals.length
    const at = i => (i >= 0 ? num(vals[i]) : null)
    const ramp = at(n - 1), mid = at(n - 2)
    if (ramp === null || mid === null) return
    const newer = n >= 5 && at(n - 3) === 6
    const styleAt = newer ? n - 5 : n - 3
    const opacity = newer ? (at(n - 4) ?? 1) : 1
    const style = at(styleAt)
    if (style === null) return
    const rgb = stopColor(style, vals.slice(0, styleAt))
    if (!rgb) return
    d.stops.push({ offset: unit(ramp / 100), rgb, opacity: unit(opacity), midpoint: Math.min(0.87, Math.max(0.13, mid / 100)) })
  }
  gradientEnd() {
    const d = this.gradientDef; this.gradientDef = null
    if (!d.stops.length) return
    if (d.stops[0].offset > d.stops[d.stops.length - 1].offset) d.stops.reverse()
    d.stops.sort((a, b) => a.offset - b.offset)
    this.gradients.set(d.name, d)
  }
  setInstance(i) {
    const paint = this.instancePaint(i)
    if (!paint) return
    if (i.stroke) this.pendingStroke = paint; else this.pendingFill = paint
  }
  /** La pintura de una instancia en el espacio del arte: { type:'gradient', def, unit: matriz | null, line: {a,b} | null, focal } */
  instancePaint(i) {
    const def = i.name !== null ? this.gradients.get(i.name) : null
    if (!def) { if (i.name !== null) this.warn(`gradient "${i.name}" is used but not defined`); return null }
    const radial = def.kind === 'radial'
    let unitM = i.xm ?? (radial && i.bm ? i.bm[0] : null)
    if (unitM) return { type: 'gradient', def, unit: unitM, focal: i.hilight }
    if (i.bm) { // los Bm de un lineal solos: van del primer stop al último
      const a = apply(i.bm[0], 0, 0), b = apply(i.bm[1], 1, 0)
      const from = def.stops[0].offset, to = def.stops[def.stops.length - 1].offset
      const k = 1 / Math.max(to - from, 1e-6)
      const whole = [(b[0] - a[0]) * k, (b[1] - a[1]) * k]
      const start = [a[0] - whole[0] * from, a[1] - whole[1] * from]
      return { type: 'gradient', def, unit: [whole[0], whole[1], -whole[1], whole[0], start[0], start[1]], focal: [0, 0] }
    }
    const a = (i.angle * Math.PI) / 180
    const L = i.length
    const local = [L * Math.cos(a), L * Math.sin(a), -L * Math.sin(a), L * Math.cos(a), i.origin[0], i.origin[1]]
    return { type: 'gradient', def, unit: i.bg ? mul(i.bg, local) : local, focal: i.hilight }
  }

  // ---- imágenes ----
  image(data, hidden) {
    const vals = this.operands()
    const m = lastArr(vals)
    const n = nums(vals)
    if (!m || m.length !== 6 || n.length < 11) return
    const [, , , , w, h, bits, kind, alpha, , binary] = n
    if (!w || !h || w * h > MAX_PIXELS || ![1, 8].includes(bits)) { this.warn('an image that cannot be read was left out'); return }
    const space = this.raster ? this.raster.space : null
    const channels = space === 'DeviceGray' ? 1 : space === 'DeviceCMYK' ? 4 : space === 'DeviceRGB' ? 3 : kind === 1 ? 1 : kind === 4 ? 4 : 3
    if (binary === 0) data = fromHex(latin1(data))
    const row = bits === 1 ? Math.ceil((w * channels) / 8) : w * channels
    const need = row * h
    if (data.length < need) { this.warn('an image whose data is cut short was left out'); return }
    const alphaLen = alpha > 0 ? w * h : 0
    const opacity = alphaLen && data.length >= need + alphaLen ? data.subarray(need, need + alphaLen) : null
    const rgba = new Uint8Array(w * h * 4)
    let o = 0
    for (let y = 0; y < h; y++) {
      const base = y * row
      for (let x = 0; x < w; x++) {
        let r, g, b
        if (bits === 1) { const bit = (data[base + (x >> 3)] >> (7 - (x & 7))) & 1; r = g = b = bit ? 255 : 0 }
        else if (channels === 1) { r = g = b = data[base + x] }
        else if (channels === 4) {
          ;[r, g, b] = cmyk8ToRgb8(data[base + x * 4], data[base + x * 4 + 1], data[base + x * 4 + 2], data[base + x * 4 + 3])
        } else { r = data[base + x * 3]; g = data[base + x * 3 + 1]; b = data[base + x * 3 + 2] }
        rgba[o++] = r; rgba[o++] = g; rgba[o++] = b; rgba[o++] = opacity ? opacity[y * w + x] : 255
      }
    }
    // La matriz lleva píxeles (y hacia abajo) al espacio del arte con su y invertida.
    const xf = mul(FLIP, [m[0], m[1], m[2], m[3], m[4], -m[5]])
    if (Math.abs(det(xf)) < 1e-12) return
    this.counts.images++
    this.add({ type: 'image', rgba, w, h, xf, opacity: this.gs.opacity, blend: this.gs.blend, visible: !this.gs.hidden }, hidden)
  }

  placeOperands(vals) {
    const m = lastArr(vals)
    const n = nums(vals)
    const path = lastText(vals)
    if (m && m.length === 6) this.place.matrix = m
    if (n.length >= 4) this.place.bounds = n.slice(0, 4)
    if (path) this.place.path = path
  }

  /** `~`: un archivo enlazado. Queda con su caja y la vista previa que el .ai guarda; el
   *  archivo original lo busca después `resolveImages` (images.mjs), que puede ser asíncrono. */
  endPlace(hidden) {
    const p = this.place; this.place = null
    if (!p.matrix || !p.bounds) { this.warn('a placed file without matrix or bounds was left out'); return }
    const [x0, y0, x1, y1] = p.bounds
    const bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0)
    // Los píxeles del archivo (y hacia abajo) empiezan en la esquina (llx, lly) de su caja, en
    // coordenadas del lienzo; la caja mide el archivo en píxeles, y la matriz lleva el lienzo
    // al espacio del arte (y lo voltea). `box` lleva el cuadrado unidad a la imagen entera.
    const box = mul(p.matrix, [bw, 0, 0, bh, Math.min(x0, x1), Math.min(y0, y1)])
    if (Math.abs(det(box)) < 1e-12) return
    this.counts.placed++
    this.add({ type: 'image', placed: true, link: p.path, box, preview: p.preview ? previewRgba(p.preview) : null, filePixels: [bw, bh],
      opacity: this.gs.opacity, blend: this.gs.blend, visible: !this.gs.hidden }, hidden)
  }

  finish() {
    if (this.unknown.size) this.warn(`operators not known: ${[...this.unknown].join(', ')}`)
    let artboards = this.artboards
    if (!artboards.length && this.cropmarks) artboards = [{ name: 'Artboard 1', x0: this.cropmarks[0], y0: this.cropmarks[1], x1: this.cropmarks[2], y1: this.cropmarks[3] }]
    if (!artboards.length && this.bbox) artboards = [{ name: 'Artboard 1', x0: this.bbox[0], y0: this.bbox[1], x1: this.bbox[2], y1: this.bbox[3] }]
    for (const l of this.layers) prune(l, false)
    return { layers: this.layers, artboards, warnings: [...this.warnings], counts: this.counts, gradients: this.gradients }
  }
}

/** Quita de cada contenedor los hijos ocultos (en líneas `%_`) que no se promovieron a aspecto dibujado. */
function prune(node, parentHidden) {
  const kids = node.children ?? []
  node.children = kids.filter(k => !(k.hidden && !parentHidden && !k.promoted))
  for (const k of node.children) prune(k, k.hidden)
  if (node.clip) node.clip = node.clip.filter(k => !(k.hidden && !parentHidden))
}

function ungrouped(kids) {
  const out = []
  for (const k of kids) { if (k.type === 'group' && !k.clip) out.push(...ungrouped(k.children)); else if (k.type === 'path') out.push(k) }
  return out
}
function matrixOf(vals) { const n = nums(vals); const m = affine(n.slice(Math.max(0, n.length - 6))); return m && Math.abs(det(m)) > 1e-12 ? m : null }
function four(v) { const n = v.trim().split(/\s+/).map(Number); return n.length >= 4 && n.slice(0, 4).every(Number.isFinite) ? n.slice(0, 4) : null }

/** La vista previa de un archivo enlazado: `w h fila bits x` y filas ARGB premultiplicado → { w, h, rgba }. */
function previewRgba(data) {
  let p = 0
  while (p < data.length && (data[p] === 0x20 || data[p] === 0x0d || data[p] === 0x0a || data[p] === 0x09)) p++
  const head = []
  for (let i = 0; i < 5; i++) {
    const sp = data.indexOf(0x20, p)
    if (sp < 0) return null
    head.push(parseInt(latin1(data, p, sp), 10))
    p = sp + 1
  }
  const [w, h, row, bits] = head
  if (!w || !h || w * h > MAX_PIXELS || bits !== 32 || row < w * 4) return null
  if (data.length - p < (h - 1) * row + w * 4) return null
  const rgba = new Uint8Array(w * h * 4)
  let o = 0
  for (let y = 0; y < h; y++) {
    const base = p + y * row
    for (let x = 0; x < w; x++) {
      const a = data[base + x * 4], r = data[base + x * 4 + 1], g = data[base + x * 4 + 2], b = data[base + x * 4 + 3]
      const st = c => (a === 0 ? 0 : Math.min(255, Math.round((c * 255) / a)))
      rgba[o++] = st(r); rgba[o++] = st(g); rgba[o++] = st(b); rgba[o++] = a
    }
  }
  return { w, h, rgba }
}
