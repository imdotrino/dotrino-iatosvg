// Registro de reputación: cualquier app puede ser calificada (CONVENCIONES §6.1).
import { createVaultReputation } from '@dotrino/reputation'
import { getIdentity } from './identity'

let rep = null
export async function getReputation () {
  if (rep) return rep
  const id = await getIdentity()
  if (!id) return null
  try { rep = createVaultReputation(id) } catch { rep = null }
  return rep
}
