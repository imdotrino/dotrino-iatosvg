/**
 * Almacén del usuario: @dotrino/store, atado al perfil (CONVENCIONES §4). Guarda los ajustes y
 * la lista de lo convertido (nombre, fecha, mesas). NUNCA los archivos: esos no salen de la
 * pestaña y no se guardan en ningún lado.
 *
 * Sin repliegue: si el almacén no abre, la app sigue convirtiendo, no guarda nada y LO DICE.
 */
import { Store } from '@dotrino/store'
import { getIdentity } from './identity'

const PREFS = 'iatosvg.prefs'
const HISTORY = 'iatosvg.history'
const HISTORY_MAX = 50

let storePromise = null
export function getStore () {
  if (storePromise) return storePromise
  storePromise = (async () => {
    const identity = await getIdentity()
    if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' })
    const store = await Store.connect({ identity, adoptCommon: ['iatosvg.'] })
    if (typeof store.ready === 'function') await store.ready()
    return store
  })()
  storePromise.catch(() => { storePromise = null })
  return storePromise
}

export async function loadPrefs () {
  const s = await getStore()
  const e = await s.listThread(PREFS, { limit: 1 })
  return e.length ? e[e.length - 1].prefs : null
}

export async function savePrefs (prefs) {
  const s = await getStore()
  await s.removeThread(PREFS)
  await s.appendMessage(PREFS, { id: 'prefs', prefs })
}

export async function loadHistory () {
  const s = await getStore()
  return (await s.listThread(HISTORY, { limit: HISTORY_MAX })).reverse()
}

/** Apunta una conversión: solo datos de la conversión, nunca el archivo. */
export async function addHistory (entry) {
  const s = await getStore()
  await s.appendMessage(HISTORY, { id: crypto.randomUUID(), ts: Date.now(), ...entry })
}

export async function clearHistory () {
  const s = await getStore()
  await s.removeThread(HISTORY)
}
