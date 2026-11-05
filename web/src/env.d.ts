/** La versión del package.json, que pone Vite (vite.config.js, `define`). */
declare const __APP_VERSION__: string

// @dotrino/compat no publica .d.ts: solo lo que usa la app.
declare module '@dotrino/compat' {
  export interface Declaration { product: string, version: string, protocol: number, speaks: number[] }
  export function declare (d: { product: string, version: string, protocol: number, speaks?: number[] }): Declaration
}

// Abrir archivos con la app instalada (file_handlers del manifiesto): Chromium, sin tipos en el DOM.
interface LaunchParams { readonly files: readonly FileSystemFileHandle[] }
interface LaunchQueue { setConsumer (consumer: (params: LaunchParams) => void): void }
interface Window { launchQueue?: LaunchQueue }
