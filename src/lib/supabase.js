import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isCloudConfigured = Boolean(url && anonKey)

export const supabase = isCloudConfigured ? createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null

export async function getActiveUser() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.user ?? null
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(normalizeAuthError(error.message))
  return data.user
}

export async function signUp({ email, password, fullName }) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName?.trim() || null } },
  })
  if (error) throw new Error(normalizeAuthError(error.message))
  return data
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

export function onAuthChange(callback) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return () => data.subscription.unsubscribe()
}

function normalizeAuthError(message) {
  const text = String(message ?? '')
  if (/invalid login credentials/i.test(text)) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(text)) return 'Confirme o e-mail antes de entrar.'
  if (/user already registered/i.test(text)) return 'Este e-mail já tem conta. Tente entrar.'
  if (/password should be at least/i.test(text)) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (/rate limit|too many/i.test(text)) return 'Muitas tentativas. Aguarde um instante e tente de novo.'
  return text || 'Não foi possível autenticar.'
}