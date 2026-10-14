# dotrino-iatosvg

Convierte archivos `.ai` de Adobe Illustrator a SVG **leyendo los datos de edición nativos**,
no la parte PDF de compatibilidad. Node ≥ 22.15, sin dependencias.

```bash
npx @dotrino/iatosvg "Arte.ai"                  # escribe Arte.svg al lado
iatosvg a.ai b.ai -o salida/           # varios, a un directorio
iatosvg a.ai --all -o salida/          # un SVG por mesa de trabajo
iatosvg a.ai --links /ruta/Links       # dónde están los archivos enlazados (por defecto: la carpeta del .ai y su Links/)
iatosvg a.ai --no-links                # incrustar solo las vistas previas que guarda el .ai
iatosvg a.ai --dump                    # vuelca los datos de edición decodificados (a.ai.ps)
```

Como módulo:

```js
import fs from 'node:fs'
import { aiToSvg, readAi, editingData } from '@dotrino/iatosvg'
const { svg, doc } = aiToSvg(fs.readFileSync('Arte.ai'), { artboard: 0 })
```

## El formato, en corto

Un `.ai` moderno es un PDF. Lo que Illustrator edita de verdad va en la primera página, en
`/PieceInfo /Illustrator /Private`: los streams `AIPrivateData1…N` (`/NumBlock` dice cuántos).
Unidos, empiezan con una cabecera en claro (`%!PS-Adobe-3.0`, `%%Creator`, `%AI5_FileFormat`…) y
un marcador que dice cómo sigue:

| Marcador | Compresión |
|---|---|
| `%AI24_ZStandard_Data` | Zstandard (Illustrator 24+) |
| `%AI12_CompressedData` | zlib |
| ninguno | los datos tal cual |

Lo descomprimido es un programa PostScript-like (líneas terminadas en `\r`) con los operadores
del formato legacy de Illustrator (especificación AI7, 1998) más los que vinieron después:

| Qué | Operadores |
|---|---|
| capas | `%AI5_BeginLayer` · `… Lb` (visible, vista previa, bloqueo, imprimible…) · `(nombre) Ln` · `LB` |
| contenedores | `u … U` grupo · `*u … *U` trazado compuesto · `q … Q` grupo de recorte |
| trazados | `m` `l/L` `c/C` `v/V` `y/Y` `h`; pintar: `f` relleno, `s` trazo, `b` ambos, `n/N` nada (mayúscula = sin cerrar); `W` lo hace recorte |
| colores | `g/G` gris · `k/K` CMYK · `x/X` tinta nombrada · `Xa/XA` RGB · `Xx/XX` `Xk/XK` nombrados. Minúscula = relleno, mayúscula = trazo |
| trazo | `w` ancho · `J` remate · `j` unión · `M` inglete · `d` guiones · `XR` regla par/impar |
| estado | `modo opacidad aislar knockout forma Xy` · `1 Xw` oculto · `A` bloqueado |
| gradientes | `(nombre) tipo n Bd` + `… Bs` por stop + `BD` en el setup; en el objeto `Bb` `Bg` `Xm` `Bm` `Bh` `BB` |
| imágenes | `%AI5_BeginRaster` · `/DeviceCMYK XN` · `[matriz] … w h bits canales alfa … XI` + bytes hasta `%%EndData` |
| enlazados | `%AI5_BeginPlace` · `[matriz] llx lly urx ury …` · ruta · vista previa binaria (`%AI26_BeginPlacedObjectPreview`) · `~` |
| diccionarios | `/Tipo :` … `valores clave ,` … `;` (de `/Document` salen las mesas de trabajo: `ArtboardArray`) |
| aspecto dibujado | un objeto con estilo (varios rellenos, efectos) va en líneas `%_` y delante lleva su dibujo plano; `1 (estilo) XW` lo cierra |

Las coordenadas van con la **y hacia arriba**; el SVG sale con el origen en la esquina superior
izquierda de la mesa de trabajo. Las posiciones de imágenes y enlazados vienen en coordenadas del
**lienzo** (16383 pt, centro 8191,5) y su matriz las lleva al arte.

Los colores CMYK se convierten a sRGB con una tabla generada desde el perfil
*U.S. Web Coated (SWOP) v2* (el CMYK por defecto de Illustrator) con lcms2; `scripts/make-lut.py`
la regenera con otro perfil.

## Qué sale y qué no

Sale: capas (las ocultas se omiten, `--hidden-layers` las deja con `display="none"`), grupos,
trazados compuestos, recortes, rellenos y trazos sólidos, gradientes lineales y radiales (con
foco, matriz y punto medio aproximado), opacidad y modos de fusión, imágenes incrustadas (CMYK,
RGB, gris, con alfa) y archivos enlazados: se buscan por nombre en la carpeta del `.ai`, en su
`Links/` y en lo que diga `--links`; un PNG o JPEG se incrusta tal cual y un PSD se decodifica
(imagen compuesta, 8 bits, RGB/CMYK/gris con alfa, reducido a `--max-image`, 2048 por defecto).
Si no aparece, va **la vista previa que el `.ai` guarda** (baja resolución, y se avisa),
mesas de trabajo, y el aspecto dibujado de los objetos con estilos y efectos.

No sale (se avisa en stderr): texto editable (solo su aspecto dibujado, si el archivo lo tiene),
mallas de gradiente, motivos, símbolos, máscaras de opacidad, arte no nativo (PDF colocados).

## Referencias

- Adobe, *Illustrator File Format Specification 7.0* (1998): los operadores legacy.
- [vectorcraft](https://github.com/storytold/vectorcraft) (`crates/eps/src/import/ai/`): de ahí
  salió la semántica de los operadores nuevos (transparencia, matrices de gradiente, imágenes,
  enlazados, diccionarios) y el truco de las líneas `%_`. Este proyecto no usa su código: lo
  reimplementa en JavaScript.

MIT.
