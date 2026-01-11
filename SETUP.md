SETUP
=====

Быстрый старт
-------------
1) Установите зависимости:
   pnpm install

2) Скопируйте env файлы:
   apps/api/.env.example -> apps/api/.env
   apps/web/.env.example -> apps/web/.env

3) Supabase
   - Выполните SQL ниже (таблицы + RPC)
   - Создайте storage bucket tmp-inputs (private)

4) n8n
   - Настройте webhook URL и общий секрет HMAC
   - Возвращайте { ok: true, output_url } или { ok: false, error }

5) Запуск dev:
   pnpm -r dev

Supabase SQL (таблицы + RPC)
---------------------------
```sql
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  model text not null,
  type text not null check (type in ('image', 'video')),
  prompt text not null,
  params jsonb not null default '{}'::jsonb,
  inputs jsonb not null default '[]'::jsonb,
  status text not null check (status in ('queued', 'processing', 'succeeded', 'failed')),
  cost numeric not null default 0,
  output_url text,
  error jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  amount numeric not null,
  type text not null check (type in ('debit', 'refund', 'topup')),
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  level text,
  message text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists jobs_user_id_created_at_idx on public.jobs (user_id, created_at desc);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists transactions_user_id_created_at_idx on public.transactions (user_id, created_at desc);

create or replace function public.create_job_and_debit(
  p_telegram_id bigint,
  p_model text,
  p_type text,
  p_prompt text,
  p_params jsonb default '{}'::jsonb,
  p_inputs jsonb default '[]'::jsonb,
  p_cost numeric
)
returns table (job_id uuid, balance numeric)
language plpgsql
as $$
declare
  v_user_id uuid;
  v_balance numeric;
  v_job_id uuid;
begin
  if p_cost <= 0 then
    raise exception 'invalid_cost';
  end if;

  select id, balance
    into v_user_id, v_balance
    from public.users
    where telegram_id = p_telegram_id
    for update;

  if not found then
    raise exception 'user_not_found';
  end if;

  if v_balance < p_cost then
    raise exception 'insufficient_balance';
  end if;

  update public.users
    set balance = balance - p_cost,
        updated_at = now()
    where id = v_user_id
    returning balance into v_balance;

  insert into public.jobs (user_id, model, type, prompt, params, inputs, status, cost)
  values (v_user_id, p_model, p_type, p_prompt, p_params, p_inputs, 'processing', p_cost)
  returning id into v_job_id;

  insert into public.transactions (user_id, job_id, amount, type, meta)
  values (v_user_id, v_job_id, -p_cost, 'debit', jsonb_build_object('model', p_model));

  return query select v_job_id, v_balance;
end;
$$;

create or replace function public.refund_job(
  p_job_id uuid
)
returns table (balance numeric)
language plpgsql
as $$
declare
  v_user_id uuid;
  v_cost numeric;
  v_balance numeric;
  v_status text;
begin
  select user_id, cost, status
    into v_user_id, v_cost, v_status
    from public.jobs
    where id = p_job_id
    for update;

  if not found then
    raise exception 'job_not_found';
  end if;

  if v_status <> 'failed' then
    raise exception 'job_not_failed';
  end if;

  if exists (
    select 1 from public.transactions
    where job_id = p_job_id and type = 'refund'
  ) then
    select balance into v_balance from public.users where id = v_user_id;
    return query select v_balance;
    return;
  end if;

  update public.users
    set balance = balance + v_cost,
        updated_at = now()
    where id = v_user_id
    returning balance into v_balance;

  insert into public.transactions (user_id, job_id, amount, type, meta)
  values (v_user_id, p_job_id, v_cost, 'refund', jsonb_build_object('reason', 'auto'));

  return query select v_balance;
end;
$$;
```

n8n + HMAC (что это и зачем)
----------------------------
- API отправляет JSON в n8n на `N8N_WEBHOOK_URL` и подписывает тело HMAC SHA256.
- Общий секрет задается один раз: `N8N_SHARED_SECRET` в `apps/api/.env` и в n8n.
- В n8n вы проверяете подпись и отклоняете запросы без корректного HMAC.

Минимальная проверка подписи в Code node (n8n):
- Возьмите сырое тело запроса (raw body) из Webhook node.
- Посчитайте HMAC SHA256 с тем же секретом.
- Сравните с заголовком `X-Signature`.
- Если не совпало — вернуть 401 или `{ ok: false, error }`.

HTTPS и домен для Mini App
---------------------------
- Telegram требует публичный HTTPS URL для Mini App.
- Разверните web (Vite build) и API за nginx с TLS сертификатом (например, Let's Encrypt).
- В BotFather:
  - `/setdomain` -> выберите бота -> укажите домен (без пути)
  - `/setmenubutton` -> задайте URL мини-приложения (https://ваш-домен/...)

Docker (VPS Beget с Docker ОС)
------------------------------
1) Убедитесь, что домен указывает на IP сервера (A запись) и открыты 80/443 порты.
2) Скопируйте репозиторий на сервер и создайте env файлы:
   - `apps/api/.env`
   - `apps/web/.env`
3) В `docker-compose.yml` замените `APP_DOMAIN=example.com` на ваш домен.
4) Запуск:
   docker compose up -d --build
5) Для обновления:
   git pull
   docker compose up -d --build

Важно: `VITE_API_BASE_URL` в `apps/web/.env` должен быть `https://ваш-домен/api`.

Примечания
----------
- RPC `create_job_and_debit` ожидает параметры:
  telegram_id, model, type, prompt, params, inputs, cost
- RPC `refund_job` вызывается с параметром: job_id
- Загрузка файлов: createSignedUploadUrl + uploadToSignedUrl
- Если включите RLS, добавьте политики для service role или оставьте RLS выключенным.
