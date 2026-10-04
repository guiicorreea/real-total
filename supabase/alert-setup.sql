-- Alerta de vencimento por e-mail
-- Rode este arquivo no SQL Editor do Supabase (uma vez).

create table if not exists public.alert_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  enabled      boolean not null default false,
  days_before  int    not null default 1,
  last_sent_on date,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.alert_settings enable row level security;

drop policy if exists "le o proprio alerta"       on public.alert_settings;
drop policy if exists "cria o proprio alerta"     on public.alert_settings;
drop policy if exists "atualiza o proprio alerta" on public.alert_settings;

create policy "le o proprio alerta"       on public.alert_settings for select using (auth.uid() = user_id);
create policy "cria o proprio alerta"     on public.alert_settings for insert with check (auth.uid() = user_id);
create policy "atualiza o proprio alerta" on public.alert_settings for update using (auth.uid() = user_id);