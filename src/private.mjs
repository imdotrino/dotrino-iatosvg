// Los datos de edición de Illustrator: los streams AIPrivateData unidos empiezan con una
// cabecera en claro (%!PS-Adobe… %%Creator… %AI7_Thumbnail…) y después un marcador:
//   %AI24_ZStandard_Data  → lo que sigue es Zstandard
//   %AI12_CompressedData  → lo que sigue es zlib
// Sin marcador, los datos van tal cual.
import { find, inflate } from './bytes.mjs'
import { decompress as unzstd } from './vendor/fzstd.mjs'

const MAX_DATA = 256 << 20

export async function decodePrivate (raw) {
  const markers = [
    ['%AI24_ZStandard_Data', b => unzstd(b)],
    ['%AI12_CompressedData', b => inflate(b, MAX_DATA)],
  ]
  for (const [marker, decode] of markers) {
    const at = find(raw, marker)
    if (at >= 0) {
      const data = await decode(raw.subarray(at + marker.length))
      if (data.length > MAX_DATA) throw Object.assign(new Error('decompressed data too large'), { code: 'too-large' })
      return { header: raw.subarray(0, at), data, codec: marker }
    }
  }
  return { header: new Uint8Array(0), data: raw, codec: null }
}
