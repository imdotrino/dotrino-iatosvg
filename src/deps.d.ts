// @dotrino/update está tipado con JSDoc pero no publica .d.ts: aquí solo lo que usa el CLI.
declare module '@dotrino/update/notice' {
  /** Imprime por stderr si hay versión nueva (una vez al día). Devuelve si imprimió algo. */
  export function printUpdateNotice (opts?: {
    current?: string
    source?: string
    pkg?: string
    product?: string
    how?: string
  }): Promise<boolean>
}
