import { supabase } from './supabase.js'

const DAYS_BEFORE_OPTIONS = [
  { value: 0, label: 'No dia do vencimento' },
  { value: 1, label: '1 dia antes' },
  { value: 2, label: '2 dias antes' },
  { value: 3, label: '3 dias antes' },
  { value: 5, label: '5 dias antes' },
  { value: 7, label: '1 semana antes' },
]

export { DAYS_BEFORE_OPTIONS }

export async function fetchAlertSettings(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('alert_settings')
    .select('email, enabled, days_before, last_sent_on')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

export async function saveAlertSettings(userId, settings) {
  if (!supabase || !userId) return
  const { error } = await supabase.from('alert_settings').upsert({
    user_id: userId,
    email: settings.email,
    enabled: settings.enabled,
    days_before: Number(settings.days_before) || 0,
    last_sent_on: settings.last_sent_on ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}