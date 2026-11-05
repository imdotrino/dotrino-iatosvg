// Las formas de datos del lector y del SVG. Solo tipos: el código es JS con JSDoc.
/** Matriz afín `[a b c d e f]`: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = number[]
/** Color sRGB, cada canal en 0..1. */
export type Rgb = number[]

/** Un token del scanner (lexer.mjs). */
export type Token =
  | { t: 'num', v: number, hidden: boolean }
  | { t: 'str' | 'hex' | 'data' | 'preview', v: Uint8Array, hidden: boolean }
  | { t: 'name' | 'word' | 'comment', v: string, hidden: boolean }

/** Un valor de la pila del intérprete: número, cadena, nombre, arreglo, diccionario o la marca `[`. */
export type Val = number | symbol | Boxed
export interface Boxed {
  s?: Uint8Array
  n?: string
  a?: Val[]
  o?: Dict
}

/** Un diccionario `/Tipo : … ;` de los datos de edición (la clase Obj de reader.mjs). */
export interface Dict {
  ty: string
  entries: [string | null, Val[]][]
  content: Val[]
  get (key: string): Val[] | null
  nums (key: string): number[]
  text (key: string): string | null
  items (): Dict[]
}

export interface SolidPaint {
  type: 'solid'
  rgb: Rgb
  cmyk?: number[]
  swatch?: string
  tint?: number
}
export interface GradientStop {
  offset: number
  rgb: Rgb
  opacity: number
  /** Punto medio entre este stop y el siguiente (0.13..0.87). */
  midpoint: number
}
export interface GradientDef {
  name: string
  kind: 'linear' | 'radial'
  stops: GradientStop[]
}
/** Un gradiente en el espacio del arte: `unit` lleva el vector (o el círculo) unidad al arte. */
export interface GradientPaint {
  type: 'gradient'
  def: GradientDef
  unit: Matrix
  focal: number[]
}
export type Paint = SolidPaint | GradientPaint

export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z']

export interface Dash { pattern: number[], offset: number }
export interface StrokeProps {
  width: number
  cap: string
  join: string
  miter: number
  dash: Dash | null
}

/** El estado gráfico vigente. */
export interface Gs extends StrokeProps {
  fill: Paint
  stroke: Paint
  rule: 'nonzero' | 'evenodd'
  opacity: number
  blend: string
  hidden: boolean
  locked: boolean
  overprintFill: boolean
  overprintStroke: boolean
}

/** Lo que tienen (o reciben por el camino) todos los nodos del árbol. */
interface NodeCommon {
  /** Vino en líneas `%_` (el aspecto dibujado de un objeto con estilo). */
  hidden?: boolean
  name?: string
  visible?: boolean
  opacity?: number
  blend?: string
  /** Un grupo marcado como aspecto dibujado (`9 XW`). */
  look?: boolean
  /** Un aspecto dibujado que reemplaza a su objeto. */
  promoted?: boolean
  /** La copia pintada del relleno de un trazado de recorte. */
  clipFillCopy?: boolean
  clipping?: boolean
  children?: ArtNode[]
  clip?: ArtNode[] | null
}

export interface PathNode extends NodeCommon {
  type: 'path'
  segs: Seg[]
  rule: 'nonzero' | 'evenodd'
  clipping: boolean
  guide: boolean
  fill: Paint | null
  stroke: Paint | null
  strokeProps: StrokeProps
}
export interface CompoundNode extends NodeCommon {
  type: 'compound'
  children: ArtNode[]
  fill: Paint | null
  stroke: Paint | null
  strokeProps?: StrokeProps
  rule?: 'nonzero' | 'evenodd'
}
export interface GroupNode extends NodeCommon {
  type: 'group'
  children: ArtNode[]
  clip: ArtNode[] | null
}
export interface LayerNode extends NodeCommon {
  type: 'layer'
  name: string
  visible: boolean
  printable: boolean
  children: ArtNode[]
  clip: ArtNode[] | null
}
/** Píxeles RGBA sin comprimir. */
export interface Raster { w: number, h: number, rgba: Uint8Array }
interface ImageBase extends NodeCommon {
  type: 'image'
  w?: number
  h?: number
  /** Píxeles (y hacia abajo) → espacio del arte. */
  xf?: Matrix
  rgba?: Uint8Array | null
  /** PNG o JPEG listo para el SVG (images.mjs). */
  bytes?: Uint8Array
  mime?: string
}
/** Una imagen incrustada en el .ai. */
export interface EmbeddedImage extends ImageBase {
  placed?: false
  w: number
  h: number
}
/** Un archivo enlazado: `link` es su ruta y `box` lleva el cuadrado unidad a su imagen. */
export interface PlacedImage extends ImageBase {
  placed: true
  link: string
  box: Matrix
  preview: Raster | null
  filePixels: number[]
  /** Se encontró el archivo (si no, va la vista previa que guarda el .ai). */
  found?: boolean
}
export type ImageNode = EmbeddedImage | PlacedImage
export type ArtNode = PathNode | CompoundNode | GroupNode | LayerNode | ImageNode

export interface Artboard { name: string, x0: number, y0: number, x1: number, y1: number }

export interface Counts { paths: number, images: number, placed: number, groups: number, looks: number }

/** Lo que devuelve `Reader.run()`. */
export interface AiDocument {
  layers: LayerNode[]
  artboards: Artboard[]
  warnings: string[]
  counts: Counts
  gradients: Map<string, GradientDef>
}

/** El avance de la lectura, para enseñarlo. */
export type Progress =
  | { step: 'decode' }
  | { step: 'read', bytes: number }
  | { step: 'link', name: string, index: number, total: number }
  | { step: 'encode', index: number, total: number }

export interface ResolveOptions {
  /** El archivo enlazado por su nombre, o null si no está. */
  resolveLink?: ((name: string) => Promise<Uint8Array | null>) | null
  /** Lado mayor al incrustar un PSD enlazado (2048). */
  maxImage?: number
  onProgress?: (p: Progress) => void
}

export interface SvgOptions {
  artboard?: number
  hiddenLayers?: boolean
  title?: string
}
