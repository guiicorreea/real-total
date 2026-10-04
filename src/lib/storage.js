import { isCloudConfigured, supabase } from './supabase.js'

// A chave permanece com o nome antigo de propósito: alterá-la apagaria
// todos os dados já salvos neste navegador.
const STORAGE_KEY = 'iasgui-finance-state-v1'
const LEGACY_STORAGE_KEYS = ['clara-finance-state-v1']
const SYNCED_AT_KEY = 'iasgui-last-cloud-sync'

let activeUserId = null
let pushTimer = null
let lastSyncedAt = null

function safeLocalGet(key) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalSet(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // O cache local e uma conveniencia: o app continua funcionando sem ele.
  }
}

function safeLocalRemove(key) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignora erro de storage; o reset em memoria continua funcionando.
  }
}

export function loadState() {
  const raw = safeLocalGet(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeLocalState(state) {
  safeLocalSet(STORAGE_KEY, JSON.stringify(state))
}

export function saveState(state) {
  writeLocalState(state)
  if (!activeUserId) return
  schedulePush(state)
}

export function clearState() {
  safeLocalRemove(STORAGE_KEY)
  safeLocalRemove(LEGACY_STORAGE_KEYS[0])
  if (activeUserId) schedulePush({}, true)
}

export function setActiveUser(userId) {
  activeUserId = userId ?? null
  lastSyncedAt = safeLocalGet(SYNCED_AT_KEY)
}

export function isCloudReady() {
  return isCloudConfigured && Boolean(activeUserId)
}

export function getLastSyncedAt() {
  return lastSyncedAt
}

function schedulePush(state, immediate = false) {
  if (pushTimer) clearTimeout(pushTimer)
  const run = () => pushState(state).catch(() => {})
  if (immediate) run()
  else pushTimer = setTimeout(run, 1200)
}

async function pushState(state) {
  if (!supabase || !activeUserId) return
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('app_state')
    .upsert({ user_id: activeUserId, state, updated_at: now }, { onConflict: 'user_id' })
  if (error) throw error
  lastSyncedAt = now
  safeLocalSet(SYNCED_AT_KEY, now)
}

export async function pullState() {
  if (!supabase || !activeUserId) return { state: null, updatedAt: null, migrated: false }

  const { data, error } = await supabase
    .from('app_state')
    .select('state, updated_at')
    .eq('user_id', activeUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (!data) {
    const local = loadState()
    if (local && Object.keys(local).length) {
      await pushState(local)
      return { state: local, updatedAt: lastSyncedAt, migrated: true }
    }
    return { state: null, updatedAt: null, migrated: false }
  }

  lastSyncedAt = data.updated_at
  safeLocalSet(SYNCED_AT_KEY, data.updated_at)
  return { state: data.state, updatedAt: data.updated_at, migrated: false }
}

export async function ensureProfile(user) {
  if (!supabase || !user) return
  await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email ?? null,
    full_name: user.user_metadata?.full_name ?? null,
  }, { onConflict: 'id' })
}