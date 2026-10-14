import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Reader } from '../src/reader.mjs'
import { toSvg } from '../src/svg.mjs'
import { decodePrivate } from '../src/private.mjs'
import zlib from 'node:zlib'

// Un programa de edición mínimo, como lo escribe Illustrator (líneas con \r).
const program = (body, setup = '') => Buffer.from([
  '%!PS-Adobe-3.0', '%%Creator: Adobe Illustrator(R) 24.0', '%AI3_Cropmarks: 0 0 200 100', '%AI3_TemplateBox: 100.5 50.5 100.5 50.5',
  '%%EndComments', '%%BeginSetup', setup, '%%EndSetup', '%AI5_BeginLayer', '1 1 1 1 0 0 1 0 79 128 255 0 50 0 Lb', '(Capa 1) Ln',
  body, 'LB', '%AI5_EndLayer--', '%%PageTrailer', '%%EOF',
].join('\r'), 'latin1')

test('a filled rectangle in CMYK becomes a path in sRGB, y flipped', () => {
  const doc = new Reader(program('0 1 0 0 k\r10 10 m\r60 10 L\r60 40 L\r10 40 L\rf')).run()
  assert.equal(doc.artboards.length, 1)
  assert.equal(doc.layers[0].children.length, 1)
  const p = doc.layers[0].children[0]
  assert.equal(p.type, 'path')
  assert.deepEqual(p.fill.rgb.map(v => Math.round(v * 255)), [236, 0, 140])
  const svg = toSvg(doc)
  assert.match(svg, /viewBox="0 0 200 100"/)
  assert.match(svg, /<path d="M10 90 L60 90 L60 60 L10 60 Z" fill="#ec008c"\/>/)
})

test('RGB, grey and named colours, stroke properties and the fill rule', () => {
  const body = ['0 0 0 0 1 0.5 0 Xa', '0.3 G', '2 w 1 J 1 j [4 2] 0 d', '1 XR', '0 0 m 10 0 L 10 10 L h', 'b'].join('\r')
  const doc = new Reader(program(body)).run()
  const p = doc.layers[0].children[0]
  assert.deepEqual(p.fill.rgb, [1, 0.5, 0])
  assert.deepEqual(p.stroke.rgb.map(v => +v.toFixed(2)), [0.7, 0.7, 0.7])
  assert.deepEqual(p.strokeProps, { width: 2, cap: 'round', join: 'round', miter: 4, dash: { pattern: [4, 2], offset: 0 } })
  assert.equal(p.rule, 'evenodd')
  const svg = toSvg(doc)
  assert.match(svg, /fill-rule="evenodd" stroke="#b3b3b3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2"/)
})

test('groups keep the graphics state (u/U are not gsave/grestore) and take their own Xy', () => {
  const body = ['u', '0 0 0 1 k', '0 0 m 1 0 L 1 1 L f', 'U', '0 0.5 0 0 0 Xy', '*u', '5 5 m 6 5 L 6 6 L f', '7 7 m 8 7 L 8 8 L f', '*U'].join('\r')
  const doc = new Reader(program(body)).run()
  const [g, c] = doc.layers[0].children
  assert.equal(g.type, 'group'); assert.equal(g.opacity, 0.5)
  assert.equal(c.type, 'compound'); assert.equal(c.children.length, 2)
  assert.deepEqual(c.fill.rgb.map(v => Math.round(v * 255)), [35, 31, 32]) // K100 por SWOP, heredado del grupo anterior
})

test('a clipping path clips its group and its own fill paints under the art', () => {
  const body = ['q', '1 0 0 0 k', '0 0 m 50 0 L 50 50 L 0 50 L', 'W f', '0 1 0 0 k', '0 0 m 100 0 L 100 100 L f', 'Q'].join('\r')
  const doc = new Reader(program(body)).run()
  const g = doc.layers[0].children[0]
  assert.equal(g.clip.length, 1)
  assert.equal(g.children.length, 2) // la copia pintada del recorte y el trazado
  assert.equal(g.children[0].clipFillCopy, true)
  const svg = toSvg(doc)
  assert.match(svg, /<clipPath id="clip\d+"><path clip-rule="nonzero" d="M0 100 L50 100 L50 50 L0 50 Z"\/><\/clipPath>/)
  assert.match(svg, /<g clip-path="url\(#clip\d+\)">/)
})

test('a gradient definition and its instance become an SVG gradient in user space', () => {
  const setup = ['%AI5_BeginGradient: (G)', '(G) 0 2 Bd', '[', '0 0 0 0 1 50 100 Bs', '1 0 0 0 1 50 0 Bs', 'BD', '%AI5_EndGradient'].join('\r')
  const body = ['0 0 m 100 0 L 100 50 L 0 50 L', 'Bb', '1 (G) 0 0 0 1 1 0 0 1 0 0 Bg', '100 0 0 100 0 25 Xm', 'f', '0 BB'].join('\r')
  const doc = new Reader(program(body, setup)).run()
  assert.equal(doc.gradients.get('G').stops.length, 2)
  const p = doc.layers[0].children[0]
  assert.equal(p.fill.type, 'gradient')
  const svg = toSvg(doc)
  // Los stops se listan desde cualquier extremo de la rampa: salen ordenados por su punto.
  assert.match(svg, /<linearGradient id="grad\d+" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix\(100 0 0 -100 0 75\)"><stop offset="0" stop-color="#00aeef"\/><stop offset="1" stop-color="#ffffff"\/><\/linearGradient>/)
  assert.match(svg, /fill="url\(#grad\d+\)"/)
})

test('the drawn look on plain lines replaces the styled object written on %_ lines', () => {
  const body = ['u', '0 0 0 1 k', '0 0 m 1 0 L 1 1 L f', 'U', '9 () XW', '%_0 1 0 0 k', '%_5 5 m 6 5 L 6 6 L f', '1 (Estilo) XW', '%_0 0 1 0 k', '%_9 9 m 9 8 L 8 8 L f'].join('\r')
  const doc = new Reader(program(body)).run()
  const kids = doc.layers[0].children
  assert.equal(kids.length, 1) // el aspecto; el objeto con estilo y la copia suelta en %_ se van
  assert.equal(kids[0].type, 'group'); assert.equal(kids[0].promoted, true)
})

test('hidden objects and hidden layers are not drawn', () => {
  const body = ['1 Xw', '0 0 m 1 0 L 1 1 L f', '0 Xw', '0 0 m 1 0 L 1 1 L f'].join('\r')
  const doc = new Reader(program(body)).run()
  assert.equal(doc.layers[0].children[0].visible, false)
  assert.equal(doc.layers[0].children[1].visible, true)
  assert.equal((toSvg(doc).match(/<path /g) ?? []).length, 1)
})

test('the artboards come from the /Document dictionary', () => {
  const body = ['%_/Document :', '%_/Dictionary :', '%_/Array :', '%_/Dictionary :', '%_(Tablero) /String (Name) ,', '%_10 20 /RealPoint (PositionPoint1) ,',
    '%_110 70 /RealPoint (PositionPoint2) ,', '%_;', '%_,', '%_; (ArtboardArray) ,', '%_; /NotRecorded ,', '%_;'].join('\r')
  const doc = new Reader(program(body)).run()
  assert.deepEqual(doc.artboards, [{ name: 'Tablero', x0: 10, y0: 20, x1: 110, y1: 70 }])
  assert.match(toSvg(doc), /viewBox="0 0 100 50"/)
})

test('decodePrivate undoes the Zstandard and zlib markers', () => {
  const data = Buffer.from('hola')
  assert.equal(decodePrivate(Buffer.concat([Buffer.from('%!PS\r%AI24_ZStandard_Data'), zlib.zstdCompressSync(data)])).data.toString(), 'hola')
  assert.equal(decodePrivate(Buffer.concat([Buffer.from('%AI12_CompressedData'), zlib.deflateSync(data)])).data.toString(), 'hola')
  assert.equal(decodePrivate(data).codec, null)
})
