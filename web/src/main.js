/**
 * iatosvg — archivos de Illustrator (.ai) a SVG, en el aparato. Lee los datos de edición del
 * archivo (no su copia PDF) con la misma librería que el CLI (../../src). Los archivos no salen
 * de la pestaña: ni se suben ni se guardan; en el almacén solo quedan los ajustes y la lista de
 * lo convertido.
 */
import { registerSW } from 'virtual:pwa-register'
import '@dotrino/topbar'
import '@dotrino/install'
import { getIdentity } from './services/identity'
import { getReputation } from './services/reputation'
import { getStore, loadPrefs, savePrefs, loadHistory, addHistory, clearHistory } from './services/store'
import { MINE } from './services/compat'
import './style.css'

// Recarga cuando el SW nuevo toma control + re-chequeo periódico (CONVENCIONES §3).
const updateSW = registerSW({ immediate: true })
setInterval(() => updateSW(), 30 * 60 * 1000)

/* ---------------- i18n ---------------- */
const I18N = {
  es: {
    title: 'Archivos de Illustrator a SVG',
    drop: 'Arrastra aquí tus archivos .ai',
    dropHint: 'y, si los tienes, las fotos que usan (la carpeta «Links»)',
    pickAi: 'Elegir archivos .ai',
    pickLinks: 'Añadir fotos enlazadas',
    pickFolder: 'Añadir carpeta',
    linksReady: n => (n === 1 ? '1 foto enlazada lista' : `${n} fotos enlazadas listas`),
    linksNone: 'Sin fotos enlazadas: se usará la vista previa pequeña que guarda cada .ai.',
    clearLinks: 'Quitar',
    maxImage: 'Tamaño de las fotos',
    maxOpts: { 1024: 'Pequeño (1024 px)', 2048: 'Normal (2048 px)', 4096: 'Grande (4096 px)' },
    hiddenLayers: 'Incluir capas ocultas',
    queued: 'En espera',
    step: { decode: 'Abriendo el archivo…', read: 'Leyendo el dibujo…', link: n => `Leyendo «${n}»…`, encode: 'Preparando las imágenes…', svg: 'Escribiendo el SVG…' },
    download: 'Descargar SVG',
    downloadAll: 'Descargar todas',
    open: 'Ver',
    retry: 'Volver a convertir',
    remove: 'Quitar',
    artboards: n => (n === 1 ? '1 mesa de trabajo' : `${n} mesas de trabajo`),
    photos: (f, t) => `${f} de ${t} fotos en alta`,
    missingHint: 'Añade las fotos que faltan y vuelve a convertir para tenerlas en alta.',
    errors: {
      'no-editing-data': 'Este archivo no guarda los datos de edición de Illustrator.',
      'not-pdf': 'Este .ai es de una versión muy antigua de Illustrator y todavía no se puede leer.',
      'too-large': 'El archivo es demasiado grande para abrirlo aquí.',
      generic: m => `No se pudo convertir: ${m}`,
    },
    history: 'Convertidos antes',
    historyEmpty: 'Todavía no has convertido nada.',
    clearHistory: 'Borrar la lista',
    storeProblem: 'No se pudo abrir tu almacén: la app convierte igual, pero no recuerda tus ajustes ni la lista.',
    privacy: 'Tus archivos no salen de tu equipo: se convierten aquí y no se guardan en ningún lado.',
    info: 'El SVG lleva capas, degradados, fotos y mesas de trabajo. El texto sale como formas (no editable), y las mallas de degradado y los símbolos todavía no se dibujan.',
    infoLabel: 'Qué sale en el SVG',
    version: v => `Versión ${v}`,
    warn: [
      [/^placed file "(.*)" not found: its low-resolution preview was used$/, (m) => `Falta la foto «${m[1]}»: va su vista previa en baja resolución.`],
      [/^placed file "(.*)" not found and the file keeps no preview of it: left out$/, (m) => `Falta la foto «${m[1]}» y el archivo no guarda una vista previa: no aparece.`],
      [/^placed file "(.*)" could not be (read|decoded)/, (m) => `No se pudo leer la foto «${m[1]}».`],
      [/^placed file "(.*)" is of a kind that is not read/, (m) => `La foto «${m[1]}» es de un tipo que no se lee (solo PNG, JPEG y PSD).`],
      [/^type objects are not read/, () => 'El texto sale como formas dibujadas, no como texto editable.'],
      [/^gradient meshes/, () => 'Las mallas de degradado no se dibujan.'],
      [/^pattern fills/, () => 'Los rellenos con motivo salen como color plano.'],
      [/^symbol instances/, () => 'Los símbolos no se dibujan.'],
      [/^non-native art/, () => 'El contenido de un PDF colocado no se dibuja.'],
      [/^operators not known/, () => 'Hay partes del archivo que todavía no se leen.'],
      [/image/, () => 'Una imagen del archivo no se pudo leer.'],
    ],
  },
  en: {
    title: 'Illustrator files to SVG',
    drop: 'Drop your .ai files here',
    dropHint: 'and, if you have them, the photos they use (the "Links" folder)',
    pickAi: 'Choose .ai files',
    pickLinks: 'Add linked photos',
    pickFolder: 'Add folder',
    linksReady: n => (n === 1 ? '1 linked photo ready' : `${n} linked photos ready`),
    linksNone: 'No linked photos: the small preview each .ai keeps will be used.',
    clearLinks: 'Remove',
    maxImage: 'Photo size',
    maxOpts: { 1024: 'Small (1024 px)', 2048: 'Normal (2048 px)', 4096: 'Large (4096 px)' },
    hiddenLayers: 'Include hidden layers',
    queued: 'Waiting',
    step: { decode: 'Opening the file…', read: 'Reading the drawing…', link: n => `Reading "${n}"…`, encode: 'Preparing the images…', svg: 'Writing the SVG…' },
    download: 'Download SVG',
    downloadAll: 'Download all',
    open: 'View',
    retry: 'Convert again',
    remove: 'Remove',
    artboards: n => (n === 1 ? '1 artboard' : `${n} artboards`),
    photos: (f, t) => `${f} of ${t} photos in full size`,
    missingHint: 'Add the missing photos and convert again to get them in full size.',
    errors: {
      'no-editing-data': 'This file does not keep Illustrator\'s editing data.',
      'not-pdf': 'This .ai comes from a very old version of Illustrator and cannot be read yet.',
      'too-large': 'The file is too large to open here.',
      generic: m => `Could not convert: ${m}`,
    },
    history: 'Converted before',
    historyEmpty: 'You have not converted anything yet.',
    clearHistory: 'Clear the list',
    storeProblem: 'Your storage could not be opened: the app still converts, but it will not remember your settings or the list.',
    privacy: 'Your files never leave your device: they are converted here and not saved anywhere.',
    info: 'The SVG keeps layers, gradients, photos and artboards. Text comes out as shapes (not editable), and gradient meshes and symbols are not drawn yet.',
    infoLabel: 'What the SVG keeps',
    version: v => `Version ${v}`,
    warn: [
      [/^placed file "(.*)" not found: its low-resolution preview was used$/, (m) => `The photo "${m[1]}" is missing: its low-resolution preview is used.`],
      [/^placed file "(.*)" not found and the file keeps no preview of it: left out$/, (m) => `The photo "${m[1]}" is missing and the file keeps no preview: it is left out.`],
      [/^placed file "(.*)" could not be (read|decoded)/, (m) => `The photo "${m[1]}" could not be read.`],
      [/^placed file "(.*)" is of a kind that is not read/, (m) => `The photo "${m[1]}" is of a kind that is not read (only PNG, JPEG and PSD).`],
      [/^type objects are not read/, () => 'Text comes out as drawn shapes, not as editable text.'],
      [/^gradient meshes/, () => 'Gradient meshes are not drawn.'],
      [/^pattern fills/, () => 'Pattern fills come out as a plain colour.'],
      [/^symbol instances/, () => 'Symbols are not drawn.'],
      [/^non-native art/, () => 'The content of a placed PDF is not drawn.'],
      [/^operators not known/, () => 'Some parts of the file cannot be read yet.'],
      [/image/, () => 'An image in the file could not be read.'],
    ],
  },
}

const topbar = document.querySelector('dotrino-topbar')
let lang = topbar?.lang === 'en' ? 'en' : 'es'
const t = () => I18N[lang]
topbar.addEventListener('dotrino-lang', e => { lang = e.detail?.lang === 'en' ? 'en' : 'es'; render() })

/* ---------------- Estado ---------------- */
const LINK_EXT = /\.(psd|psb|png|jpe?g)$/i
const jobs = []            // { id, file, status: 'queued'|'working'|'done'|'error', progress, result, error }
const links = new Map()    // nombre en minúsculas → File
let prefs = { maxImage: 2048, hiddenLayers: false }
let history = []
let storeOk = true
let infoOpen = false

/* ---------------- Pilares ---------------- */
;(async () => {
  const identity = await getIdentity()
  if (!identity) return
  topbar.identity = identity
  topbar.reputation = await getReputation()
})()

;(async () => {
  try {
    const store = await getStore()
    topbar.store = store
    const saved = await loadPrefs()
    if (saved) prefs = { ...prefs, ...saved }
    history = await loadHistory()
  } catch (e) {
    console.error('[iatosvg] store unavailable: settings and history are not saved', e)
    storeOk = false
  }
  render()
})()

/* ---------------- Conversión ---------------- */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
let running = null

worker.onmessage = ({ data }) => {
  const job = jobs.find(j => j.id === data.id)
  if (!job) return
  if (data.progress) { job.progress = data.progress; renderJob(job); return }
  if (data.error) { job.status = 'error'; job.error = data.error }
  if (data.done) {
    job.status = 'done'
    for (const ab of data.artboards) ab.url = URL.createObjectURL(ab.blob)
    job.result = data
    remember(job)
  }
  running = null
  renderJob(job)
  next()
}

function next () {
  if (running) return
  const job = jobs.find(j => j.status === 'queued')
  if (!job) return
  running = job
  job.status = 'working'
  job.progress = { step: 'decode' }
  renderJob(job)
  worker.postMessage({ id: job.id, file: job.file, links: [...links.values()], maxImage: prefs.maxImage, hiddenLayers: prefs.hiddenLayers })
}

function enqueue (file) {
  jobs.unshift({ id: crypto.randomUUID(), file, status: 'queued' })
  render()
  next()
}

function retry (job) {
  release(job)
  Object.assign(job, { status: 'queued', result: null, error: null, progress: null })
  renderJob(job)
  next()
}

function release (job) { for (const ab of job.result?.artboards ?? []) URL.revokeObjectURL(ab.url) }

async function remember (job) {
  if (!storeOk) return
  const r = job.result
  const placed = r.placed.length
  const found = r.placed.filter(p => p.found).length
  try {
    await addHistory({ name: job.file.name, size: job.file.size, artboards: r.artboards.length, placed, found })
    history = await loadHistory()
    renderHistory()
  } catch (e) { console.error('[iatosvg] could not save history', e) }
}

/* ---------------- Archivos entrantes ---------------- */
function take (files) {
  let addedLinks = 0
  for (const f of files) {
    if (/\.ai$/i.test(f.name)) enqueue(f)
    else if (LINK_EXT.test(f.name)) { links.set(f.name.toLowerCase(), f); addedLinks++ }
  }
  if (addedLinks) render()
}

/** Los archivos de una carpeta soltada, recorriéndola entera. */
async function entryFiles (entry) {
  if (entry.isFile) return [await new Promise((res, rej) => entry.file(res, rej))]
  if (!entry.isDirectory) return []
  const reader = entry.createReader()
  const out = []
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej))
    if (!batch.length) break
    for (const e of batch) out.push(...await entryFiles(e))
  }
  return out
}

window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging') })
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging') })
window.addEventListener('drop', async e => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  const items = [...(e.dataTransfer?.items ?? [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean)
  if (items.length) {
    const files = []
    for (const it of items) files.push(...await entryFiles(it))
    take(files)
  } else take([...(e.dataTransfer?.files ?? [])])
})

// Abrir un .ai con la app instalada (file_handlers del manifiesto).
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    const files = []
    for (const h of params.files ?? []) files.push(await h.getFile())
    take(files)
  })
}

async function setPref (k, v) {
  prefs = { ...prefs, [k]: v }
  render()
  if (!storeOk) return
  try { await savePrefs(prefs) } catch (e) { console.error('[iatosvg] could not save settings', e) }
}

/* ---------------- Render ---------------- */
const app = document.getElementById('app')

function h (tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k)
  return el
}

function picker (label, testid, attrs) {
  const input = h('input', { type: 'file', hidden: true, ...attrs, onchange: e => { take([...e.target.files]); e.target.value = '' } })
  return h('label', { class: 'btn', 'data-testid': testid }, label, input)
}

const fmtSize = b => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const fmtPt = v => `${Math.round(v)} pt`
const fmtDate = ts => new Date(ts).toLocaleString(lang === 'en' ? 'en' : 'es', { dateStyle: 'medium', timeStyle: 'short' })

function plainWarning (w) {
  for (const [re, fn] of t().warn) { const m = w.match(re); if (m) return fn(m) }
  return w
}

function errorText (err) {
  return t().errors[err.code] ?? t().errors.generic(err.message)
}

function render () {
  const L = t()
  app.replaceChildren(...[
    h('section', { class: 'drop', 'data-testid': 'drop' },
      h('div', { class: 'drop-head' },
        h('h1', {}, L.title),
        h('button', { class: 'i', type: 'button', 'aria-label': L.infoLabel, 'aria-expanded': String(infoOpen), onclick: () => { infoOpen = !infoOpen; render() } }, 'i')),
      infoOpen ? h('p', { class: 'info' }, L.info) : null,
      h('p', { class: 'drop-text' }, L.drop),
      h('p', { class: 'muted' }, L.dropHint),
      h('div', { class: 'actions' },
        picker(L.pickAi, 'pick-ai', { accept: '.ai', multiple: true }),
        picker(L.pickLinks, 'pick-links', { accept: '.psd,.psb,.png,.jpg,.jpeg', multiple: true }),
        picker(L.pickFolder, 'pick-folder', { webkitdirectory: true }))),
    h('section', { class: 'bar' },
      h('div', { class: 'links', 'data-testid': 'links' },
        links.size ? [h('span', {}, L.linksReady(links.size)), h('button', { class: 'link', type: 'button', onclick: () => { links.clear(); render() } }, L.clearLinks)] : h('span', { class: 'muted' }, L.linksNone)),
      h('label', { class: 'opt' }, L.maxImage, ' ',
        h('select', { 'data-testid': 'max-image', onchange: e => setPref('maxImage', Number(e.target.value)) },
          ...Object.entries(L.maxOpts).map(([v, label]) => h('option', { value: v, selected: Number(v) === prefs.maxImage }, label)))),
      h('label', { class: 'opt' },
        h('input', { type: 'checkbox', 'data-testid': 'hidden-layers', checked: prefs.hiddenLayers, onchange: e => setPref('hiddenLayers', e.target.checked) }), ' ', L.hiddenLayers)),
    storeOk ? null : h('p', { class: 'notice' }, L.storeProblem),
    h('section', { class: 'jobs', id: 'jobs' }, ...jobs.map(jobCard)),
    h('section', { class: 'history', id: 'history' }),
    h('footer', {}, h('p', {}, L.privacy), h('p', { class: 'muted' }, L.version(MINE.version))),
  ].filter(Boolean))
  renderHistory()
}

function renderJob (job) {
  const el = document.querySelector(`[data-job="${job.id}"]`)
  if (el) el.replaceWith(jobCard(job)); else render()
}

function jobCard (job) {
  const L = t()
  const head = h('div', { class: 'job-head' },
    h('strong', { class: 'job-name' }, job.file.name),
    h('span', { class: 'muted' }, fmtSize(job.file.size)),
    h('button', { class: 'link', type: 'button', 'data-testid': 'remove', disabled: job.status === 'working', onclick: () => { release(job); jobs.splice(jobs.indexOf(job), 1); render() } }, L.remove))
  const card = h('article', { class: `job ${job.status}`, 'data-job': job.id, 'data-testid': 'job' }, head)
  if (job.status === 'queued') card.append(h('p', { class: 'muted' }, L.queued))
  if (job.status === 'working') {
    const p = job.progress ?? {}
    const text = p.step === 'link' ? L.step.link(p.name) : L.step[p.step] ?? '…'
    card.append(h('p', { class: 'working-text' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text))
  }
  if (job.status === 'error') {
    card.append(h('p', { class: 'error' }, errorText(job.error)))
  }
  if (job.status === 'done') {
    const r = job.result
    const found = r.placed.filter(p => p.found).length
    const missing = r.placed.length - found
    card.append(
      h('p', { class: 'muted' }, L.artboards(r.artboards.length), r.placed.length ? ` · ${L.photos(found, r.placed.length)}` : ''),
      h('div', { class: 'boards' }, ...r.artboards.map((ab, i) => h('figure', { class: 'board' },
        h('a', { href: ab.url, target: '_blank', rel: 'noopener', title: L.open },
          h('img', { src: ab.url, alt: ab.name, loading: 'lazy' })),
        h('figcaption', {},
          h('span', {}, ab.name, h('span', { class: 'muted' }, ` · ${fmtPt(ab.w)} × ${fmtPt(ab.h)} · ${fmtSize(ab.blob.size)}`)),
          h('a', { class: 'btn primary', href: ab.url, download: fileName(job.file.name, r.artboards.length > 1 ? i : -1, ab.name), 'data-testid': 'download' }, L.download))))),
      r.warnings.length ? h('ul', { class: 'warnings' }, ...[...new Set(r.warnings.map(plainWarning))].map(w => h('li', {}, w))) : null,
      missing ? h('p', { class: 'hint' }, L.missingHint, ' ', h('button', { class: 'btn', type: 'button', 'data-testid': 'retry', onclick: () => retry(job) }, L.retry)) : null,
    )
  }
  return card
}

function fileName (aiName, index, boardName) {
  const base = aiName.replace(/\.ai$/i, '')
  if (index < 0) return `${base}.svg`
  const safe = boardName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || String(index + 1)
  return `${base} - ${safe}.svg`
}

function renderHistory () {
  const el = document.getElementById('history')
  if (!el || !storeOk) { el?.replaceChildren(); return }
  const L = t()
  el.replaceChildren(
    h('div', { class: 'history-head' },
      h('h2', {}, L.history),
      h('button', { class: 'link', type: 'button', disabled: !history.length, 'data-testid': 'clear-history', onclick: async () => { await clearHistory(); history = []; renderHistory() } }, L.clearHistory)),
    history.length
      ? h('ul', {}, ...history.map(e => h('li', {},
        h('span', {}, e.name),
        h('span', { class: 'muted' }, ` · ${L.artboards(e.artboards)}${e.placed ? ` · ${L.photos(e.found, e.placed)}` : ''} · ${fmtDate(e.ts)}`))))
      : h('p', { class: 'muted' }, L.historyEmpty))
}

render()
