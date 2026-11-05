// Tipos mínimos de fzstd (copiado tal cual en fzstd.mjs, fuera del chequeo): solo lo que se usa.
/**
 * Descomprime un bloque Zstandard. `buf`, si se pasa, es donde se escribe la salida.
 */
export function decompress (dat: Uint8Array, buf?: Uint8Array): Uint8Array
