// Del árbol del lector a SVG. El espacio del arte va con la y hacia arriba; el SVG, hacia abajo:
// un punto (x, y) del arte sale como (x - x0, y1 - y), con (x0, y1) la esquina superior
// izquierda de la mesa de trabajo, así que el viewBox es `0 0 ancho alto`.
import { mul, apply, invert } from './reader.mjs'
import { toBase64 } from './bytes.mjs'

const fmt = v => (Math.abs(v) < 1e-9 ? '0' : Number(v.toFixed(3)).toString())
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const hex = rgb => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

export function toSvg(doc, { artboard = 0, hiddenLayers = false, title = '' } = {}) {
  const ab = doc.artboards[artboard]
  if (!ab) throw new Error(`artboard ${artboard} does not exist (${doc.artboards.length} found)`)
  const T = [1, 0, 0, -1, -ab.x0, ab.y1] // arte → documento
  const w = ab.x1 - ab.x0, h = ab.y1 - ab.y0
  const ctx = { T, defs: [], ids: 0, hiddenLayers }
  const body = doc.layers.map(l => layer(l, ctx)).join('')
  const name = esc(ab.name || title)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${fmt(w)}pt" height="${fmt(h)}pt" viewBox="0 0 ${fmt(w)} ${fmt(h)}">\n` +
    (name ? `<title>${name}</title>\n` : '') +
    (ctx.defs.length ? `<defs>\n${ctx.defs.join('\n')}\n</defs>\n` : '') + body + '</svg>\n'
}

function layer(l, ctx) {
  if (!l.visible && !ctx.hiddenLayers) return ''
  const attrs = [`id="${esc(idOf(l.name, ctx))}"`, `data-layer="${esc(l.name)}"`]
  if (!l.visible) attrs.push('display="none"')
  return `<g ${attrs.join(' ')}${clipAttr(l, ctx)}>\n${children(l.children, ctx)}</g>\n`
}

function idOf(name, ctx) { return (name || 'layer').replace(/[^\w.-]+/g, '_') + '_' + (++ctx.ids) }

function children(kids, ctx) { return kids.map(k => node(k, ctx)).join('') }

/** El atributo clip-path de un contenedor con trazados de recorte, con su <clipPath> en defs. */
function clipAttr(n, ctx) {
  if (!n.clip || !n.clip.length) return ''
  const id = `clip${++ctx.ids}`
  const rule = n.clip[0].rule ?? 'nonzero'
  const d = n.clip.map(c => pathData(c, ctx)).join(' ')
  ctx.defs.push(`<clipPath id="${id}"><path clip-rule="${rule}" d="${d}"/></clipPath>`)
  return ` clip-path="url(#${id})"`
}

function common(n) {
  const a = []
  if (n.opacity !== undefined && n.opacity < 1) a.push(`opacity="${fmt(n.opacity)}"`)
  if (n.blend && n.blend !== 'normal') a.push(`style="mix-blend-mode:${n.blend}"`)
  if (n.name) a.push(`data-name="${esc(n.name)}"`)
  return a.length ? ' ' + a.join(' ') : ''
}

function node(n, ctx) {
  if (n.visible === false) return ''
  switch (n.type) {
    case 'layer': return layer(n, ctx)
    case 'group': return `<g${common(n)}${clipAttr(n, ctx)}>\n${children(n.children, ctx)}</g>\n`
    case 'compound': {
      if (n.clipping) return ''
      const d = n.children.map(c => pathData(c, ctx)).join(' ')
      return `<path${common(n)} d="${d}"${paintAttrs(n, ctx)}/>\n`
    }
    case 'path': {
      if (n.clipping || n.guide) return ''
      if (!n.fill && !n.stroke) return ''
      return `<path${common(n)} d="${pathData(n, ctx)}"${paintAttrs(n, ctx)}/>\n`
    }
    case 'image': {
      if (!n.bytes || !n.xf) return ''
      const m = mul(ctx.T, n.xf)
      const href = `data:${n.mime};base64,${toBase64(n.bytes)}`
      const link = n.link ? ` data-link="${esc(n.link)}"` : ''
      return `<image${common(n)}${link} width="${n.w}" height="${n.h}" transform="matrix(${m.map(fmt).join(' ')})" preserveAspectRatio="none" xlink:href="${href}"/>\n`
    }
    default: return ''
  }
}

function pathData(n, ctx) {
  const T = ctx.T
  const out = []
  for (const s of n.segs) {
    switch (s[0]) {
      case 'M': case 'L': { const [x, y] = apply(T, s[1], s[2]); out.push(`${s[0]}${fmt(x)} ${fmt(y)}`); break }
      case 'C': {
        const p = [apply(T, s[1], s[2]), apply(T, s[3], s[4]), apply(T, s[5], s[6])]
        out.push(`C${p.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' ')}`); break
      }
      case 'Z': out.push('Z'); break
    }
  }
  return out.join(' ')
}

function paintAttrs(n, ctx) {
  const a = [`fill="${paintRef(n.fill, ctx)}"`]
  if (n.fill && (n.rule ?? 'nonzero') === 'evenodd') a.push('fill-rule="evenodd"')
  if (n.stroke) {
    const sp = n.strokeProps ?? {}
    a.push(`stroke="${paintRef(n.stroke, ctx)}"`, `stroke-width="${fmt(sp.width ?? 1)}"`)
    if (sp.cap && sp.cap !== 'butt') a.push(`stroke-linecap="${sp.cap}"`)
    if (sp.join && sp.join !== 'miter') a.push(`stroke-linejoin="${sp.join}"`)
    if (sp.miter && sp.miter !== 4) a.push(`stroke-miterlimit="${fmt(sp.miter)}"`)
    if (sp.dash) { a.push(`stroke-dasharray="${sp.dash.pattern.map(fmt).join(' ')}"`); if (sp.dash.offset) a.push(`stroke-dashoffset="${fmt(sp.dash.offset)}"`) }
  }
  return ' ' + a.join(' ')
}

function paintRef(p, ctx) {
  if (!p) return 'none'
  if (p.type === 'solid') return hex(p.rgb)
  if (p.type === 'gradient') return `url(#${gradientDef(p, ctx)})`
  return 'none'
}

/** El gradiente en defs: unidades del usuario, con la matriz que lleva el vector (o el círculo) unidad al arte. */
function gradientDef(p, ctx) {
  const id = `grad${++ctx.ids}`
  const m = mul(ctx.T, p.unit)
  const stops = []
  const s = p.def.stops
  for (let i = 0; i < s.length; i++) {
    stops.push(s[i])
    const next = s[i + 1]
    // SVG no tiene punto medio: un stop intermedio con el color mezclado lo aproxima.
    if (next && Math.abs(s[i].midpoint - 0.5) > 0.02 && next.offset > s[i].offset) {
      const mid = s[i].midpoint
      stops.push({ offset: s[i].offset + (next.offset - s[i].offset) * mid, rgb: s[i].rgb.map((v, k) => (v + next.rgb[k]) / 2), opacity: (s[i].opacity + next.opacity) / 2 })
    }
  }
  const stopXml = stops.map(st => `<stop offset="${fmt(st.offset)}" stop-color="${hex(st.rgb)}"${st.opacity < 1 ? ` stop-opacity="${fmt(st.opacity)}"` : ''}/>`).join('')
  const tf = `gradientUnits="userSpaceOnUse" gradientTransform="matrix(${m.map(fmt).join(' ')})"`
  if (p.def.kind === 'radial') {
    // El foco es un desplazamiento desde el centro en el espacio del arte: al espacio unidad por la inversa lineal.
    let focal = ''
    const [hx, hy] = p.focal ?? [0, 0]
    if (Math.hypot(hx, hy) > 1e-9) {
      const inv = invert([p.unit[0], p.unit[1], p.unit[2], p.unit[3], 0, 0])
      if (inv) { const [fx, fy] = apply(inv, hx, hy); focal = ` fx="${fmt(fx)}" fy="${fmt(fy)}"` }
    }
    ctx.defs.push(`<radialGradient id="${id}" cx="0" cy="0" r="1"${focal} ${tf}>${stopXml}</radialGradient>`)
  } else {
    ctx.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" ${tf}>${stopXml}</linearGradient>`)
  }
  return id
}
