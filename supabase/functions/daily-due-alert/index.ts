// Alerta diário de vencimento.
// Agenda: todo dia às 7h, no fuso de São Paulo (America/Sao_Paulo).
// Consulta os boletos guardados de cada usuário e dispara um e-mail
// com o que vence dentro da janela configurada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('ALERT_FROM') ?? 'Real Total <onboarding@resend.dev>'
const APP_URL = Deno.env.get('APP_URL') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T12:00:00`).getTime()
  const to = new Date(`${toIso}T12:00:00`).getTime()
  return Math.round((to - from) / 86400000)
}

function prettyDate(iso) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function labelFor(days) {
  if (days < 0) return 'Vencido'
  if (days === 0) return 'Vence hoje'
  if (days === 1) return 'Vence amanhã'
  return `Vence em ${days} dias`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function buildEmail(userName, items) {
  const total = items.reduce((sum, item) => sum + item.share, 0)
  const rows = items.map((item) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eef1f5;">
          <div style="color:#11182d;font-size:15px;font-weight:700;">${escapeHtml(item.description)}</div>
          <div style="color:#7d8799;font-size:12px;margin-top:3px;">
            ${escapeHtml(item.category || 'Sem categoria')} · vencimento ${prettyDate(item.dueDate)}
          </div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #eef1f5;text-align:right;white-space:nowrap;">
          <div style="color:#11182d;font-size:15px;font-weight:700;">${money(item.share)}</div>
          <div style="color:${item.days < 0 || item.days === 0 ? '#b14f58' : '#a8752f'};font-size:11px;font-weight:700;margin-top:3px;">
            ${escapeHtml(labelFor(item.days))}
          </div>
        </td>
      </tr>`).join('')

  const overdue = items.filter((item) => item.days < 0).length

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#6a5cf6;padding:22px 24px;color:#ffffff;">
                <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;">Real Total</div>
                <div style="font-size:12px;opacity:.85;margin-top:4px;">Alerta de vencimento</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <div style="color:#11182d;font-size:18px;font-weight:800;">Olá, ${escapeHtml(userName)}</div>
                <p style="color:#4a5163;font-size:14px;line-height:1.6;margin:10px 0 18px;">
                  ${overdue > 0
                    ? `<strong>${overdue} conta(s) já venceram</strong> e ${items.length - overdue} vencem em breve. Confira os valores abaixo.`
                    : `Você tem <strong>${items.length} conta(s)</strong> vencendo nos próximos dias. Confira os valores abaixo.`}
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
                  <tr>
                    <td style="padding:14px 0;color:#7d8799;font-size:12px;">Total da sua parte</td>
                    <td style="padding:14px 0;text-align:right;color:#11182d;font-size:17px;font-weight:800;">${money(total)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;">
                ${APP_URL ? `<a href="${APP_URL}"
                   style="display:inline-block;background:#11182d;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:12px 18px;border-radius:9px;">
                  Abrir o Real Total
                </a>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#fbfcfe;border-top:1px solid #eef1f5;color:#9ba5b7;font-size:11px;line-height:1.5;">
                Você recebeu este aviso porque ativou o alerta de vencimento no Real Total.
                Para desativar, entre no app e desligue o alerta em Configurações.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

Deno.serve(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL ou SERVICE_ROLE_KEY ausente' }), { status: 500 })
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY ausente' }), { status: 500 })
  }

  const today = todayIso()
  const { data: settings, error: settingsError } = await supabase
    .from('alert_settings')
    .select('user_id, email, enabled, days_before, last_sent_on')
    .eq('enabled', true)

  if (settingsError) return new Response(JSON.stringify({ error: settingsError.message }), { status: 500 })

  const report = []

  for (const setting of settings ?? []) {
    if (setting.last_sent_on === today) {
      report.push({ user: setting.email, status: 'ja enviado hoje' })
      continue
    }

    const { data: stateRow, error: stateError } = await supabase
      .from('app_state')
      .select('state')
      .eq('user_id', setting.user_id)
      .maybeSingle()

    if (stateError) {
      report.push({ user: setting.email, status: `erro ao ler dados: ${stateError.message}` })
      continue
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', setting.user_id)
      .maybeSingle()

    const bills = Array.isArray(stateRow?.state?.bills) ? stateRow.state.bills : []
    const window = Number(setting.days_before) || 0

    const items = bills
      .filter((bill) => bill && bill.dueDate && bill.status !== 'paid' && !bill.matchedTransactionId)
      .map((bill) => {
        const days = daysBetween(today, bill.dueDate)
        const share = (Number(bill.amount) || 0) * (Number(bill.mySharePercent ?? 100) / 100)
        return { ...bill, days, share }
      })
      .filter((item) => item.days <= window && item.days >= -30)
      .sort((a, b) => a.days - b.days)

    if (!items.length) {
      // Nada vencendo na janela. Não marca o dia: se um boleto for
      // cadastrado mais tarde, o próximo disparo ainda consegue avisar.
      report.push({ user: setting.email, status: 'nenhum vencimento na janela' })
      continue
    }

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'real-total/1.0',
      },
      body: JSON.stringify({
        from: FROM,
        to: [setting.email],
        subject: items[0].days < 0
          ? `${items.length} conta(s) vencida(s) no Real Total`
          : `${items.length} conta(s) vencendo em breve`,
        html: buildEmail(profile?.full_name || 'por aqui', items),
      }),
    })

    const body = await send.json().catch(() => ({}))

    // Só marca o dia quando o e-mail realmente saiu. Marcar numa falha
    // trava o alerta do dia inteiro, sem chance de nova tentativa.
    if (send.ok) {
      await supabase.from('alert_settings').update({ last_sent_on: today }).eq('user_id', setting.user_id)
    }

    report.push({
      user: setting.email,
      status: send.ok ? `enviado (${items.length} itens)` : `falhou: ${send.status} ${JSON.stringify(body)}`,
    })
  }

  return new Response(JSON.stringify({ date: today, processed: report.length, report }), {
    headers: { 'Content-Type': 'application/json' },
  })
})