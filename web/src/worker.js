// Convierte un .ai fuera del hilo de la interfaz. Los archivos llegan como File (no se copian
// hasta leerlos) y no salen de este aparato: no hay red en todo este camino.
import { readAi, toSvg } from '../../src/index.mjs'

self.onmessage = async ({ data }) => {
  const { id, file, links, maxImage, hiddenLayers } = data
  const post = msg => self.postMessage({ id, ...msg })
  try {
    const byName = new Map(links.map(f => [f.name.toLowerCase(), f]))
    const resolveLink = async name => {
      const f = byName.get(name.toLowerCase())
      return f ? new Uint8Array(await f.arrayBuffer()) : null
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const doc = await readAi(bytes, { resolveLink, maxImage, onProgress: p => post({ progress: p }) })
    post({ progress: { step: 'svg' } })
    const base = file.name.replace(/\.ai$/i, '')
    const artboards = doc.artboards.map((ab, i) => {
      const svg = toSvg(doc, { artboard: i, hiddenLayers, title: base })
      return { name: ab.name, w: ab.x1 - ab.x0, h: ab.y1 - ab.y0, blob: new Blob([svg], { type: 'image/svg+xml' }) }
    })
    const placed = []
    const walk = n => { if (n.placed) placed.push({ name: n.link.split(/[\\/]/).pop(), found: !!n.found }); for (const k of n.children ?? []) walk(k) }
    doc.layers.forEach(walk)
    post({ done: true, artboards, warnings: doc.warnings, counts: doc.counts, placed })
  } catch (e) {
    post({ error: { message: e.message, code: e.code ?? null } })
  }
}
