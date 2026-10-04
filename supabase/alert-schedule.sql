-- Agendamento do alerta de vencimento.
-- Rode no SQL Editor do Supabase DEPOIS de criar a Edge Function
-- daily-due-alert e configurar a chave RESEND_API_KEY nela.

-- remove agendamento anterior, se existir
select cron.unschedule('alerta-vencimento-diario')
where exists (select 1 from cron.job where jobname = 'alerta-vencimento-diario');

-- agenda todo dia às 7h (horário de São Paulo)
select cron.schedule(
  'alerta-vencimento-diario',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/daily-due-alert',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);

-- confere o que está agendado
select jobname, schedule, active from cron.job where jobname = 'alerta-vencimento-diario';