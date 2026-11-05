// Las formas de datos de la PWA: lo que va y viene del worker, los trabajos y lo guardado.
import type { Progress, Counts } from '../../src/types.js'

export type WorkerProgress = Progress | { step: 'svg' }

/** Lo que la página manda al worker. */
export interface WorkerRequest {
  id: string
  file: File
  links: File[]
  maxImage: number
  hiddenLayers: boolean
}

export interface ConvertedArtboard {
  name: string
  w: number
  h: number
  blob: Blob
  /** El objectURL del SVG; lo pone la página al recibirlo. */
  url?: string
}
export interface PlacedFile { name: string, found: boolean }
export interface JobError { message: string, code: string | null }

export interface WorkerDone {
  id: string
  done: true
  artboards: ConvertedArtboard[]
  warnings: string[]
  counts: Counts
  placed: PlacedFile[]
}
/** Lo que el worker contesta, sin el id del trabajo (lo pone `post`). */
export type WorkerPost =
  | { progress: WorkerProgress }
  | { error: JobError }
  | Omit<WorkerDone, 'id'>

/** Lo que el worker contesta. */
export type WorkerReply =
  | { id: string, progress: WorkerProgress }
  | { id: string, error: JobError }
  | WorkerDone

export interface Job {
  id: string
  file: File
  status: 'queued' | 'working' | 'done' | 'error'
  progress?: WorkerProgress | null
  result?: WorkerDone | null
  error?: JobError | null
}

export interface Prefs { maxImage: number, hiddenLayers: boolean }

/** Una conversión apuntada en el almacén (nunca el archivo). */
export interface HistoryEntry {
  id: string
  ts: number
  name: string
  size: number
  artboards: number
  placed: number
  found: number
}

/** Los textos de un idioma. */
export interface Texts {
  title: string
  drop: string
  dropHint: string
  pickAi: string
  pickLinks: string
  pickFolder: string
  linksReady: (n: number) => string
  linksNone: string
  clearLinks: string
  maxImage: string
  maxOpts: Record<number, string>
  hiddenLayers: string
  queued: string
  step: { decode: string, read: string, link: (name: string) => string, encode: string, svg: string }
  download: string
  downloadAll: string
  open: string
  retry: string
  remove: string
  artboards: (n: number) => string
  photos: (found: number, total: number) => string
  missingHint: string
  errors: { 'no-editing-data': string, 'not-pdf': string, 'too-large': string, generic: (message: string) => string }
  history: string
  historyEmpty: string
  clearHistory: string
  storeProblem: string
  privacy: string
  info: string
  infoLabel: string
  howto: string
  version: (v: string) => string
  /** Avisos del lector (en inglés) → texto llano. */
  warn: [RegExp, (m: RegExpMatchArray) => string][]
}
