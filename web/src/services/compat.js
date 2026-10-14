/**
 * Qué versión soy (CONVENCIONES §14). Esta app no habla con nadie por red: convierte en el
 * aparato. Se declara igual, y la versión se enseña en la pantalla.
 * `protocol` sube solo si cambia lo que la app intercambia (hoy: nada).
 */
import { declare } from '@dotrino/compat'

export const MINE = declare({ product: 'iatosvg', version: __APP_VERSION__, protocol: 1, speaks: [1] })
