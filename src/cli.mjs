#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { readAi, editingData, toSvg } from './index.mjs'

const args = process.argv.slice(2)
const opts = { artboard: 0, all: false, dump: false, hiddenLayers: false, out: null, quiet: false, links: [], noLinks: false, maxImage: 2048 }
const files = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-o' || a === '--out') opts.out = args[++i]
  else if (a === '--artboard') opts.artboard = Number(args[++i])
  else if (a === '--all') opts.all = true
  else if (a === '--dump') opts.dump = true
  else if (a === '--hidden-layers') opts.hiddenLayers = true
  else if (a === '--links') opts.links.push(args[++i])
  else if (a === '--no-links') opts.noLinks = true
  else if (a === '--max-image') opts.maxImage = Number(args[++i])
  else if (a === '-q' || a === '--quiet') opts.quiet = true
  else if (a === '-h' || a === '--help') { usage(); process.exit(0) }
  else files.push(a)
}
if (!files.length) { usage(); process.exit(2) }

function usage() {
  console.error(`usage: iatosvg <file.ai>... [-o <out.svg | dir>] [--artboard N] [--all] [--hidden-layers] [--dump] [-q]

Reads the native Illustrator editing data (not the PDF-compatible part) and writes SVG.
  -o, --out        output file (one input) or directory (several, or --all)
  --artboard N     which artboard (0-based; default 0)
  --all            one SVG per artboard (<name>-<n>.svg)
  --hidden-layers  keep hidden layers (display="none") instead of dropping them
  --links DIR      where the placed (linked) files are; repeatable. Default: the .ai's folder and its Links/
  --no-links       do not look for placed files: embed the previews the .ai keeps
  --max-image N    longest side when embedding a decoded PSD (default 2048)
  --dump           write the decoded editing data (<name>.ai.ps) instead of SVG
  -q               no summary on stderr`)
}

const log = (...m) => { if (!opts.quiet) console.error(...m) }
let failed = 0
for (const file of files) {
  try {
    const buf = fs.readFileSync(file)
    const base = path.basename(file).replace(/\.ai$/i, '')
    const outDir = opts.out && (files.length > 1 || opts.all || isDir(opts.out)) ? opts.out : null
    if (outDir) fs.mkdirSync(outDir, { recursive: true })
    if (opts.dump) {
      const { data, codec } = editingData(buf)
      const target = outDir ? path.join(outDir, base + '.ai.ps') : opts.out ?? base + '.ai.ps'
      fs.writeFileSync(target, data)
      log(`${file}: ${data.length} bytes of editing data (${codec ?? 'uncompressed'}) → ${target}`)
      continue
    }
    const dir = path.dirname(path.resolve(file))
    const links = opts.noLinks ? [] : [...opts.links, dir, path.join(dir, 'Links')]
    const doc = readAi(buf, { links, maxImage: opts.maxImage })
    const boards = opts.all ? doc.artboards.map((_, i) => i) : [opts.artboard]
    for (const i of boards) {
      const svg = toSvg(doc, { artboard: i, hiddenLayers: opts.hiddenLayers, title: base })
      const name = opts.all ? `${base}-${i + 1}.svg` : `${base}.svg`
      const target = outDir ? path.join(outDir, name) : opts.out ?? path.join(path.dirname(file), name)
      fs.writeFileSync(target, svg)
      const ab = doc.artboards[i]
      log(`${file} → ${target} (${ab.name}, ${(ab.x1 - ab.x0).toFixed(1)}×${(ab.y1 - ab.y0).toFixed(1)} pt)`)
    }
    const c = doc.counts
    log(`  layers ${doc.layers.length}, artboards ${doc.artboards.length}, paths ${c.paths}, groups ${c.groups}, images ${c.images}, placed ${c.placed}, drawn looks ${c.looks}`)
    for (const w of doc.warnings) log(`  warning: ${w}`)
  } catch (e) {
    failed++
    console.error(`${file}: ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
function isDir(p) { try { return fs.statSync(p).isDirectory() } catch { return false } }
