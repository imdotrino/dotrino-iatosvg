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
import '@dotrino/theme/theme.css'
import './style.css'

/** @typedef {import('./types').Job} Job */
/** @typedef {import('./types').WorkerDone} WorkerDone */
/** @typedef {import('./types').Prefs} Prefs */
/** @typedef {import('./types').HistoryEntry} HistoryEntry */

// Recarga cuando el SW nuevo toma control + re-chequeo periódico (CONVENCIONES §3).
const updateSW = registerSW({ immediate: true })
setInterval(() => updateSW(), 30 * 60 * 1000)

/* ---------------- i18n ---------------- */
/** @type {Record<'es' | 'en', import('./types').Texts>} */
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
    howto: 'Cómo se usa',
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
    howto: 'How to use it',
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
if (!topbar) throw new Error('index.html has no <dotrino-topbar>')
/** @type {'es' | 'en'} */
let lang = topbar?.lang === 'en' ? 'en' : 'es'
const t = () => I18N[lang]
topbar.addEventListener('dotrino-lang', e => { lang = e.detail?.lang === 'en' ? 'en' : 'es'; render() })

/* ---------------- Estado ---------------- */
const LINK_EXT = /\.(psd|psb|png|jpe?g)$/i
/** @type {Job[]} */
const jobs = []            // { id, file, status: 'queued'|'working'|'done'|'error', progress, result, error }
/** @type {Map<string, File>} */
const links = new Map()    // nombre en minúsculas → File
/** @type {Prefs} */
let prefs = { maxImage: 2048, hiddenLayers: false }
/** @type {HistoryEntry[]} */
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
/** @type {Job | null} */
let running = null

worker.onmessage = (/** @type {MessageEvent<import('./types').WorkerReply>} */ { data }) => {
  const job = jobs.find(j => j.id === data.id)
  if (!job) return
  if ('progress' in data) { job.progress = data.progress; renderJob(job); return }
  if ('error' in data) { job.status = 'error'; job.error = data.error }
  if ('done' in data) {
    job.status = 'done'
    for (const ab of data.artboards) ab.url = URL.createObjectURL(ab.blob)
    job.result = data
    remember(job, data)
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
  /** @type {import('./types').WorkerRequest} */
  const request = { id: job.id, file: job.file, links: [...links.values()], maxImage: prefs.maxImage, hiddenLayers: prefs.hiddenLayers }
  worker.postMessage(request)
}

/** @param {File} file */
function enqueue (file) {
  jobs.unshift({ id: crypto.randomUUID(), file, status: 'queued' })
  render()
  next()
}

/** @param {Job} job */
function retry (job) {
  release(job)
  Object.assign(job, { status: 'queued', result: null, error: null, progress: null })
  renderJob(job)
  next()
}

/** @param {Job} job */
function release (job) { for (const ab of job.result?.artboards ?? []) if (ab.url) URL.revokeObjectURL(ab.url) }

/**
 * @param {Job} job
 * @param {WorkerDone} r  lo que acaba de devolver el worker
 */
async function remember (job, r) {
  if (!storeOk) return
  const placed = r.placed.length
  const found = r.placed.filter(p => p.found).length
  try {
    await addHistory({ name: job.file.name, size: job.file.size, artboards: r.artboards.length, placed, found })
    history = await loadHistory()
    renderHistory()
  } catch (e) { console.error('[iatosvg] could not save history', e) }
}

/* ---------------- Archivos entrantes ---------------- */
/** @param {File[]} files */
function take (files) {
  let addedLinks = 0
  for (const f of files) {
    if (/\.ai$/i.test(f.name)) enqueue(f)
    else if (LINK_EXT.test(f.name)) { links.set(f.name.toLowerCase(), f); addedLinks++ }
  }
  if (addedLinks) render()
}

/**
 * Los archivos de una carpeta soltada, recorriéndola entera.
 * @param {FileSystemEntry} entry
 * @returns {Promise<File[]>}
 */
async function entryFiles (entry) {
  if (entry.isFile) {
    const fileEntry = /** @type {FileSystemFileEntry} */ (entry)
    return [await /** @type {Promise<File>} */ (new Promise((res, rej) => fileEntry.file(res, rej)))]
  }
  if (!entry.isDirectory) return []
  const reader = /** @type {FileSystemDirectoryEntry} */ (entry).createReader()
  /** @type {File[]} */
  const out = []
  for (;;) {
    /** @type {FileSystemEntry[]} */
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
  const items = [...(e.dataTransfer?.items ?? [])].map(i => i.webkitGetAsEntry?.()).filter(x => x != null)
  if (items.length) {
    /** @type {File[]} */
    const files = []
    for (const it of items) files.push(...await entryFiles(it))
    take(files)
  } else take([...(e.dataTransfer?.files ?? [])])
})

// Abrir un .ai con la app instalada (file_handlers del manifiesto).
if (window.launchQueue) {
  window.launchQueue.setConsumer(async params => {
    /** @type {File[]} */
    const files = []
    for (const h of params.files ?? []) files.push(await h.getFile())
    take(files)
  })
}

/**
 * @template {keyof Prefs} K
 * @param {K} k
 * @param {Prefs[K]} v
 */
async function setPref (k, v) {
  prefs = { ...prefs, [k]: v }
  render()
  if (!storeOk) return
  try { await savePrefs(prefs) } catch (e) { console.error('[iatosvg] could not save settings', e) }
}

/* ---------------- Render ---------------- */
const app = document.getElementById('app') ?? missingElement('#app')

/**
 * Un elemento que index.html tiene que traer: sin él la página no se puede pintar.
 * @param {string} what
 * @returns {never}
 */
function missingElement (what) { throw new Error(`index.html has no ${what}`) }

/** @typedef {string | number | boolean | null | undefined | ((e: Event) => void)} Attr */
/** @typedef {Node | string | null | undefined | false} Kid */

/**
 * Un elemento con sus atributos (`on…` son escuchas) y sus hijos.
 * @param {string} tag
 * @param {Record<string, Attr>} [attrs]
 * @param {...(Kid | Kid[])} kids
 * @returns {HTMLElement}
 */
function h (tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue
    if (k.startsWith('on')) {
      if (typeof v !== 'function') throw new TypeError(`${k} needs a function`)
      el.addEventListener(k.slice(2), v)
    } else if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k)
  return el
}

/**
 * @param {string} label
 * @param {string} testid
 * @param {Record<string, Attr>} attrs
 */
function picker (label, testid, attrs) {
  const input = h('input', { type: 'file', hidden: true, ...attrs, onchange: e => { const el = /** @type {HTMLInputElement} */ (e.target); take([...(el.files ?? [])]); el.value = '' } })
  return h('label', { class: 'btn', 'data-testid': testid }, label, input)
}

/** @param {number} b */
const fmtSize = b => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
/** @param {number} v */
const fmtPt = v => `${Math.round(v)} pt`
/** @param {number} ts */
const fmtDate = ts => new Date(ts).toLocaleString(lang === 'en' ? 'en' : 'es', { dateStyle: 'medium', timeStyle: 'short' })

/** @param {string} w */
function plainWarning (w) {
  for (const [re, fn] of t().warn) { const m = w.match(re); if (m) return fn(m) }
  return w
}

/** @param {import('./types').JobError} err */
function errorText (err) {
  const errors = t().errors
  const known = err.code ? /** @type {Record<string, unknown>} */ (errors)[err.code] : undefined
  return typeof known === 'string' ? known : errors.generic(err.message)
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
        h('select', { 'data-testid': 'max-image', onchange: e => setPref('maxImage', Number(/** @type {HTMLSelectElement} */ (e.target).value)) },
          ...Object.entries(L.maxOpts).map(([v, label]) => h('option', { value: v, selected: Number(v) === prefs.maxImage }, label)))),
      h('label', { class: 'opt' },
        h('input', { type: 'checkbox', 'data-testid': 'hidden-layers', checked: prefs.hiddenLayers, onchange: e => setPref('hiddenLayers', /** @type {HTMLInputElement} */ (e.target).checked) }), ' ', L.hiddenLayers)),
    storeOk ? null : h('p', { class: 'notice' }, L.storeProblem),
    h('section', { class: 'jobs', id: 'jobs' }, ...jobs.map(jobCard)),
    h('section', { class: 'history', id: 'history' }),
    h('footer', {}, h('p', {}, L.privacy), h('p', { class: 'muted' }, h('a', { href: lang === 'en' ? 'https://wiki.dotrino.com/en/apps/iatosvg/' : 'https://wiki.dotrino.com/apps/iatosvg/' }, L.howto), ' · ', L.version(MINE.version))),
  ].filter(x => x != null))
  renderHistory()
}

/** @param {Job} job */
function renderJob (job) {
  const el = document.querySelector(`[data-job="${job.id}"]`)
  if (el) el.replaceWith(jobCard(job)); else render()
}

/** @param {Job} job */
function jobCard (job) {
  const L = t()
  const head = h('div', { class: 'job-head' },
    h('strong', { class: 'job-name' }, job.file.name),
    h('span', { class: 'muted' }, fmtSize(job.file.size)),
    h('button', { class: 'link', type: 'button', 'data-testid': 'remove', disabled: job.status === 'working', onclick: () => { release(job); jobs.splice(jobs.indexOf(job), 1); render() } }, L.remove))
  const card = h('article', { class: `job ${job.status}`, 'data-job': job.id, 'data-testid': 'job' }, head)
  if (job.status === 'queued') card.append(h('p', { class: 'muted' }, L.queued))
  if (job.status === 'working') {
    const p = job.progress
    const text = p?.step === 'link' ? L.step.link(p.name) : (p ? L.step[p.step] : undefined) ?? '…'
    card.append(h('p', { class: 'working-text' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text))
  }
  if (job.status === 'error') {
    if (!job.error) throw new Error('a failed job without its error')
    card.append(h('p', { class: 'error' }, errorText(job.error)))
  }
  if (job.status === 'done') {
    const r = job.result
    if (!r) throw new Error('a finished job without its result')
    const found = r.placed.filter(p => p.found).length
    const missing = r.placed.length - found
    // Sin avisos ni fotos que falten, esos dos son null: append los pintaría como el texto «null».
    card.append(...[
      h('p', { class: 'muted' }, L.artboards(r.artboards.length), r.placed.length ? ` · ${L.photos(found, r.placed.length)}` : ''),
      h('div', { class: 'boards' }, ...r.artboards.map((ab, i) => h('figure', { class: 'board' },
        h('a', { href: ab.url, target: '_blank', rel: 'noopener', title: L.open },
          h('img', { src: ab.url, alt: ab.name, loading: 'lazy' })),
        h('figcaption', {},
          h('span', {}, ab.name, h('span', { class: 'muted' }, ` · ${fmtPt(ab.w)} × ${fmtPt(ab.h)} · ${fmtSize(ab.blob.size)}`)),
          h('a', { class: 'btn primary', href: ab.url, download: fileName(job.file.name, r.artboards.length > 1 ? i : -1, ab.name), 'data-testid': 'download' }, L.download))))),
      r.warnings.length ? h('ul', { class: 'warnings' }, ...[...new Set(r.warnings.map(plainWarning))].map(w => h('li', {}, w))) : null,
      missing ? h('p', { class: 'hint' }, L.missingHint, ' ', h('button', { class: 'btn', type: 'button', 'data-testid': 'retry', onclick: () => retry(job) }, L.retry)) : null,
    ].filter(x => x != null))
  }
  return card
}

/**
 * @param {string} aiName
 * @param {number} index  -1 si hay una sola mesa
 * @param {string} boardName
 */
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
