// Los datos de edición de Illustrator: los streams AIPrivateData unidos empiezan con una
// cabecera en claro (%!PS-Adobe… %%Creator… %AI7_Thumbnail…) y después un marcador:
//   %AI24_ZStandard_Data  → lo que sigue es Zstandard
//   %AI12_CompressedData  → lo que sigue es zlib
// Sin marcador, los datos van tal cual.
import zlib from 'node:zlib'

const MAX_DATA = 256 << 20

export function decodePrivate(raw) {
  const markers = [
    ['%AI24_ZStandard_Data', b => zlib.zstdDecompressSync(b, { maxOutputLength: MAX_DATA })],
    ['%AI12_CompressedData', b => zlib.inflateSync(b, { maxOutputLength: MAX_DATA })],
  ]
  for (const [marker, decode] of markers) {
    const at = raw.indexOf(marker)
    if (at >= 0) {
      const header = raw.subarray(0, at)
      const body = raw.subarray(at + marker.length)
      return { header, data: decode(body), codec: marker }
    }
  }
  return { header: Buffer.alloc(0), data: raw, codec: null }
}
