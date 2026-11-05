// Identidad = vault id.dotrino.com (única fuente). No reimplementamos nada.
import { Identity } from '@dotrino/identity'

/** @type {Identity | null} */
let identity = null

/**
 * La identidad del ecosistema, o null si el iframe no contesta (la app convierte igual).
 * @returns {Promise<Identity | null>}
 */
export async function getIdentity () {
  if (identity) return identity
  try { identity = await Identity.connect() } catch (e) {
    console.warn('[identity] vault unreachable:', e && /** @type {{ message?: unknown }} */ (e).message)
    identity = null
  }
  return identity
}
