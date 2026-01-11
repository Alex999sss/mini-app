README.txt
==========

Проект
------
Telegram Mini App (WebApp) для генерации фото/видео по текстовому запросу.
Пользователь может (в зависимости от выбранной модели) прикреплять изображения/видео, выбирать модель и параметры.
Запросы к нейросервисам выполняются через n8n (self-host), результат (URL) возвращается обратно в Mini App.
Баланс пользователя и вся бизнес-аналитика/логи/история задач хранятся в Supabase.

Важные решения (уже зафиксировано)
---------------------------------
- Бот реализован в n8n.
- Mini App + backend шлюз: TypeScript/Node.js.
- n8n webhook: https://yanan8n.ru/webhook/generate
- Ответ от n8n: синхронный (Mini App ждёт ответ 2–5 минут).
- Входные файлы: до 8 фото (но некоторые модели имеют другие лимиты).
- Выход: URL результата.
- Файлы “не хранить” (хранить только метаданные/логи в Supabase; входные файлы — только временно).
- Баланс и user_id должны отображаться в Mini App (из Supabase).
- Запуск Mini App: из приватного чата с ботом.
- Результат показывать в Mini App + кнопка “выслать документом в боте”.
Политика ошибок:
   - если генерация не удалась — делать автоматический возврат средств (refund)
Где физически лежат выходные файлы (URL):
   - нейросервис предоставляет ссылку для скачивания
   - нужно ли сохранять копию в Storage при необходимости (сейчас: НЕ нужно).
Ограничение параллельных задач:
   - разрешить несколько задач одновременно на пользователя

Целевая архитектура (MVP)
-------------------------
Mini App не общается с n8n и Supabase напрямую по “денежным” операциям.
Все операции, которые могут привести к расходу денег или подмене user_id, идут через backend API.

Потоки данных:

(1) Авторизация
Mini App -> API (/auth/telegram) -> валидация Telegram initData -> Supabase upsert user -> API выдаёт session JWT -> Mini App

(2) Загрузка входных файлов (временное хранение)
Mini App -> API (/uploads/create-signed) -> Supabase Storage createSignedUploadUrl -> Mini App загружает файл в Storage через uploadToSignedUrl
Далее Mini App передаёт в API только “пути” объектов (paths).

(3) Генерация (синхронно)
Mini App -> API (/generate)
API:
  a) проверяет JWT
  b) считает стоимость
  c) атомарно: проверяет баланс и списывает (Supabase RPC/transaction) + создаёт job
  d) вызывает n8n webhook (server-to-server) и ждёт ответ до 6–8 минут
  e) на успех: сохраняет output_url в job, статус succeeded
     на ошибку: статус failed + (опционально) refund
API -> Mini App (output_url + job_id + meta)

(4) Отправка “документом в боте”
Mini App -> Telegram.WebApp.sendData({ action: "send_document", output_url, job_id })
n8n Telegram workflow -> Telegram sendDocument(output_url)

Почему нужен API-шлюз
---------------------
- Telegram initData нужно валидировать перед тем как доверять user_id (иначе можно “подставить” чужой id и тратить/получать чужой баланс).
- Supabase service role key нельзя отдавать в браузер.
- Нужна атомарная операция: “проверить баланс + списать + создать job”.
- n8n webhook лучше не светить в клиенте (иначе запросы можно дергать обходя правила и баланс).

Стек и библиотеки (фикс)
------------------------
Monorepo: pnpm workspaces, TypeScript (strict).

apps/web (Mini App UI):
- React 18 + Vite
- TypeScript
- @tanstack/react-query (запросы к API, кэш, retries)
- react-hook-form + zod + @hookform/resolvers (формы и валидация)
- zod (валидация схем)
- react-dropzone (drag&drop файлов)
- @supabase/supabase-js (только для uploadToSignedUrl в Storage по signed token)
- @tma.js/sdk-react (интеграция Mini App API) ИЛИ нативный window.Telegram.WebApp (одно из двух; выбрать один и использовать везде)
- tailwindcss (быстрое UI)
- clsx (условные классы)
- dayjs (таймер ожидания/elapsed time)

apps/api (Backend шлюз):
- Node.js 20+
- Fastify
- @fastify/cors
- @fastify/helmet
- @fastify/rate-limit
- zod (env schema + DTO)
- @tma.js/init-data-node (валидация initData)
- @supabase/supabase-js (server-side через service role key)
- jose (JWT)
- undici / встроенный fetch Node 20 (HTTP к n8n)
- pino (логирование; Fastify включает)

Инфраструктура:
- Supabase (Postgres + Storage) — managed
- Docker + docker-compose на VPS Beget
- n8n self-host (уже есть домен)

Структура репозитория (рекомендация)
------------------------------------
/apps
  /web
  /api
/packages
  /shared   (общие типы DTO, model catalog, zod схемы)
/infra
  /docker   (docker-compose, nginx конфиги)

Модели и параметры (каталог, использовать как источник истины)
-------------------------------------------------------------
Общий принцип:
- В Mini App выбор модели определяет:
  - тип генерации (image/video),
  - какие входные файлы разрешены (image/video, min/max, max size),
  - какие параметры доступны и допустимые значения,
  - какие поля обязательны.

Модели (вынести в /packages/shared/models.ts):

1) Nano banana pro
   model = "nano-banana-pro"
   type = image
   prompt: string (required)
   image_input: 0-8 images (JPEG/PNG/WEBP), <=30MB each
   aspect_ratio: 1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9|auto
   resolution: 1K|2K|4K
   output_format: png|jpg
   pricing: 1K/2K - 15 руб за изображение, 4K - 20 руб за изображение

2) Nano banana
   model = "google/nano-banana"
   type = image
   prompt: string (required)
   output_format: png|jpeg
   image_size: 1:1|9:16|16:9|3:4|4:3|3:2|2:3|5:4|4:5|21:9|auto
   inputs: none
   pricing: 7 руб за изображение

3) seedance-1.5-pro
   model = "bytedance/seedance-1.5-pro"
   type = video
   prompt: string (required)
   input_urls: 0-2 images (JPEG/PNG/WEBP), <=10MB each
   aspect_ratio: 1:1|21:9|4:3|3:4|16:9|9:16
   resolution: 480p|720p
   duration: 4|8|12
   fixed_lens: boolean
   generate_audio: boolean
   pricing: 480P video — 4s no-audio 10 руб or with audio 15 руб; 8s no-audio 15 руб or with audio 20 руб; 12s no-audio 17 руб or with audio 27 руб. 
   720P video — 4s 12 руб or with audio 18 руб; 8s no-audio 18 руб or with audio 34 руб; 12s no-audio 30 руб or with audio 50 руб

4) wan 2.6 t2v
   model = "wan/2-6-text-to-video"
   type = video
   prompt: string (required)
   duration: 5|10|15
   resolution: 720p|1080p
   multi_shots: boolean
   inputs: none
   pricing: just 50 руб / 90 руб / 110 руб for 5 / 10 / 15 s at 720 p and 65 руб / 110 руб / 165 руб (~$0.53 / $1.05 / $1.58) for 5 / 10 / 15 s at 1080 p

5) wan 2.6 i2v
   model = "wan/2-6-image-to-video"
   type = video
   prompt: string (required)
   image_urls: 1 image (JPEG/PNG/WEBP), <=10MB
   duration: 5|10|15
   resolution: 720p|1080p
   multi_shots: boolean
   pricing: just 50 руб / 90 руб / 110 руб for 5 / 10 / 15 s at 720 p and 65 руб / 110 руб / 165 руб (~$0.53 / $1.05 / $1.58) for 5 / 10 / 15 s at 1080 p

6) wan 2.6 v2v
   model = "wan/2-6-video-to-video"
   type = video
   prompt: string (required)
   video_urls: 1-3 videos (MP4/QuickTime/Matroska), <=10MB each
   duration: 5|10
   resolution: 720p|1080p
   multi_shots: boolean
   pricing: just 50 руб / 90 руб / 110 руб for 5 / 10 / 15 s at 720 p and 65 руб / 110 руб / 165 руб (~$0.53 / $1.05 / $1.58) for 5 / 10 / 15 s at 1080 p

7) OpenAI sora 2 pro t2v
   model = "sora-2-pro-text-to-video"
   type = video
   prompt: string (required)
   aspect_ratio: portrait|landscape
   n_frames: 10|15
   size: standard|high
   remove_watermark: boolean
   character_id_list: 0-5 ids
   inputs: none
   pricing: Standard now costs 85 руб per 10-second video and 270 credits 140 руб per 15-second video. Sora 2 Pro High costs 180 руб per 10-second video and 350 руб per 15-second video

8) OpenAI sora 2 pro i2v
   model = "sora-2-pro-image-to-video"
   type = video
   prompt: string (required)
   image_urls: 1 image (JPEG/PNG/WEBP), <=10MB
   aspect_ratio: portrait|landscape
   n_frames: 10|15
   size: standard|high
   remove_watermark: boolean
   character_id_list: 0-5 ids
   pricing: Standard now costs 85 руб per 10-second video and 270 credits 140 руб per 15-second video. Sora 2 Pro High costs 180 руб per 10-second video and 350 руб per 15-second video
   

UI требования (Mini App)
------------------------
Экран “Главная”:
- Отображать:
  - Telegram user_id
  - balance из Supabase
- Кнопки:
  - “Новая генерация”
  - “История” (последние N задач)

Экран “Новая генерация”:
- Выбор модели (dropdown + краткое описание/лимиты).
- Prompt (textarea, required).
- Динамические поля параметров в зависимости от модели.
- Входные файлы:
  - отображать, сколько нужно (min/max) и ограничения (форматы/размер).
  - drag&drop + предпросмотр (картинки) / список (видео).
- Кнопка Generate:
  - disabled пока форма невалидна
  - показывает “спишется X кредитов” (после расчёта cost на клиенте или возвращать cost с API).
- После отправки:
  - статус “processing…”
  - таймер ожидания (elapsed mm:ss)
  - если API вернул timeout/error — показать понятную ошибку и job_id (если создан) + кнопку “повторить”

Экран “Результат”:
- Превью результата:
  - если image: <img>
  - если video: <video controls>
- output_url (копировать)
- кнопка “Отправить документом в бот”
  - вызывает Telegram.WebApp.sendData(JSON.stringify(...))
  - важно: sendData закрывает мини-апп после отправки (учесть в UX)

Экран “История”:
- список jobs (последние 20–50):
  - created_at, model, status, cost
  - если succeeded — превью/ссылка

Backend API (apps/api) — эндпойнты (MVP)
---------------------------------------
Все ответы JSON. Все protected endpoints требуют Authorization: Bearer <jwt>.

1) POST /auth/telegram
body: { initData: string }
resp:
{
  accessToken: string,
  user: { id: string, telegram_id: number, balance: number }
}

2) GET /me
resp:
{ user: { id: string, telegram_id: number, balance: number } }

3) POST /uploads/create-signed
Назначение: выдать signed upload tokens/urls для Supabase Storage.
body:
{
  files: [
    { filename: string, contentType: string, sizeBytes: number }
  ]
}
Правила:
- максимум 8 файлов (или меньше по модели — можно проверять на уровне /generate).
- не принимать >30MB на файл (глобальный максимум; а точнее — проверять по модели в /generate).
resp:
{
  bucket: "tmp-inputs",
  items: [
    { path: string, token: string }   // token из createSignedUploadUrl
  ]
}

4) POST /generate
Назначение: списать баланс, создать job, дернуть n8n, получить output_url.
body:
{
  model: string,
  prompt: string,
  params: object,
  inputs: [
    { kind: "image"|"video", path: string }  // paths из signed upload
  ]
}
resp (успех):
{
  job: {
    id: string,
    status: "succeeded",
    cost: number,
    output_url: string,
    created_at: string
  },
  user: { balance: number }
}
resp (ошибка):
{
  job?: { id: string, status: "failed" },
  error: { code: string, message: string },
  user?: { balance: number }
}

5) GET /jobs
resp: { items: Job[] }

6) GET /jobs/:id
resp: { job: Job }

(Опционально) 7) POST /internal/cleanup-inputs
Закрытый endpoint, если н8н/крон будет просить удалить входные файлы.

Supabase схема данных (рекомендация)
------------------------------------
Таблицы:

public.users
- id uuid pk default gen_random_uuid()
- telegram_id bigint unique not null
- balance numeric not null default 0
- created_at timestamptz default now()
- updated_at timestamptz default now()

public.jobs
- id uuid pk default gen_random_uuid()
- user_id uuid references users(id)
- model text not null
- type text not null ("image"|"video")
- prompt text not null
- params jsonb not null default '{}'::jsonb
- inputs jsonb not null default '[]'::jsonb   // массив {kind,path}
- status text not null ("queued"|"processing"|"succeeded"|"failed")
- cost numeric not null default 0
- output_url text
- error jsonb
- created_at timestamptz default now()
- finished_at timestamptz

public.transactions
- id uuid pk default gen_random_uuid()
- user_id uuid references users(id)
- job_id uuid references jobs(id)
- amount numeric not null         // дебет отрицательный или отдельный type
- type text not null ("debit"|"refund"|"topup")
- meta jsonb
- created_at timestamptz default now()

public.logs (опционально)
- id uuid pk
- user_id uuid
- level text
- message text
- meta jsonb
- created_at timestamptz

RPC для атомарного списания (рекомендуется)
-------------------------------------------
Создать Postgres function (RPC), которая:
- лочит строку users по telegram_id (SELECT ... FOR UPDATE),
- проверяет balance >= cost,
- списывает balance,
- создаёт job со статусом processing,
- пишет transaction (debit),
- возвращает job_id и новый баланс.

Отдельная RPC для refund (если политика = refund on failure).

Supabase Storage (временные файлы)
----------------------------------
Bucket: tmp-inputs (private)
- Файлы хранятся временно (например, удалить через cron через 1–6 часов).
- Mini App загружает через:
  - backend выдаёт token/path (createSignedUploadUrl)
  - frontend вызывает supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)

Зачем так:
- не грузить 8*30MB через n8n webhook (есть лимиты payload и память).
- n8n/нейросервис сможет скачать input по подписанным URL при необходимости.

Н8н workflow (описание, синхронный ответ)
-----------------------------------------
Webhook: POST https://yanan8n.ru/webhook/generate

Рекомендуемая схема запроса (API -> n8n):
headers:
- Content-Type: application/json
- X-Signature: <HMAC_SHA256_HEX(body, N8N_SHARED_SECRET)>

body:
{
  "job_id": "uuid",
  "telegram_id": 123,
  "model": "nano-banana-pro",
  "prompt": "...",
  "params": { ... },
  "inputs": [
    { "kind": "image", "signed_url": "https://<supabase>/storage/v1/object/sign/..." }
  ]
}

Workflow steps:
1) Webhook node (Respond: “Using Respond to Webhook” или “When Last Node Finishes”).
2) Code node: verify X-Signature (HMAC) -> если не совпадает, вернуть 401.
3) HTTP Request nodes:
   - при необходимости: скачать входные файлы по signed_url
   - вызвать ваш “сервис связи с нейронками” (как сейчас планируется)
4) На успех: вернуть JSON:
   { "ok": true, "output_url": "https://..." , "meta": {...} }
   На ошибку:
   { "ok": false, "error": { "code": "...", "message": "..." } }

ВАЖНО про синхронность (2–5 минут):
- Нужно увеличить таймауты в reverse proxy (nginx) перед n8n и перед API.
- Иначе браузер/прокси оборвёт соединение раньше, чем n8n вернёт ответ.

Nginx таймауты (пример)
-----------------------
Для API (если за nginx):
proxy_read_timeout 600s;
proxy_send_timeout 600s;
send_timeout 600s;

Для n8n (если за nginx):
proxy_read_timeout 600s;
proxy_send_timeout 600s;

Если n8n docker:
- учесть настройки WEBHOOK_URL и корректную базовую ссылку (если работаете на subpath).

ENV переменные
--------------
apps/api (.env):
- PORT=3001
- API_BASE_URL=https://api.<ваш_домен>          (для ссылок/логов)
- TELEGRAM_BOT_TOKEN=xxxxx
- JWT_SECRET=xxxxx

# Supabase
- SUPABASE_URL=https://<project>.supabase.co
- SUPABASE_SERVICE_ROLE_KEY=xxxxx
- SUPABASE_STORAGE_BUCKET=tmp-inputs

# n8n
- N8N_WEBHOOK_URL=https://yanan8n.ru/webhook/generate
- N8N_SHARED_SECRET=xxxxx
- N8N_TIMEOUT_MS=480000          # 8 минут

apps/web (.env):
- VITE_API_BASE_URL=https://api.<ваш_домен>
- VITE_SUPABASE_URL=https://<project>.supabase.co
- VITE_SUPABASE_ANON_KEY=xxxxx
- VITE_SUPABASE_BUCKET=tmp-inputs

Docker / Deploy (VPS Beget)
---------------------------
- Собрать apps/web в статику (Vite build) и раздавать через nginx.
- apps/api запускать как node process в контейнере.
- Обязательно HTTPS для домена Mini App (Telegram требует).

Пример docker-compose (упрощённо):

services:
  api:
    build: ./apps/api
    env_file: ./apps/api/.env
    ports:
      - "3001:3001"
  web:
    build: ./apps/web
    ports:
      - "8080:80"

(На практике лучше один внешний nginx, который:
- раздаёт web,
- проксирует /api -> api:3001,
- ставит таймауты 600s.)

Roadmap (последовательность для Codex)
--------------------------------------
[0] Repo bootstrap
- [ ] pnpm workspaces + TypeScript strict
- [ ] eslint/prettier
- [ ] /packages/shared (модели, DTO, zod схемы)

[1] Backend: base
- [ ] Fastify server + /health
- [ ] Zod env validation
- [ ] Telegram initData validation (через @tma.js/init-data-node)
- [ ] POST /auth/telegram: upsert user в Supabase, вернуть JWT + balance

[2] Supabase schema
- [ ] SQL миграции: users, jobs, transactions (+ индексы)
- [ ] RPC: create_job_and_debit (atomic debit + job insert)
- [ ] (опц.) RPC refund_job

[3] Frontend: base
- [ ] Vite+React
- [ ] Telegram WebApp init (get initData)
- [ ] Авторизация: вызвать /auth/telegram, сохранить JWT
- [ ] Главная: user_id + balance

[4] Model catalog + dynamic form
- [ ] Реализовать единый каталог моделей (shared)
- [ ] На основе модели строить форму параметров и лимиты файлов
- [ ] Полная клиентская валидация (zod)

[5] Upload flow (Supabase Storage signed upload)
- [ ] API: /uploads/create-signed
- [ ] Web: выбор файлов + preview + uploadToSignedUrl
- [ ] Возврат paths в UI

[6] Generate flow (sync)
- [ ] API: /generate
  - validate input vs model rules
  - pricing + debit (RPC)
  - call n8n webhook (fetch with timeout 8 min)
  - update job status/result
- [ ] Web: кнопка Generate + экран ожидания + показ результата/ошибки

[7] History
- [ ] API: GET /jobs и GET /jobs/:id
- [ ] Web: история + детали

[8] Send to bot
- [ ] Web: кнопка sendData({action:"send_document", ...})
- [ ] n8n: обработка web_app_data и отправка document по output_url

[9] Hardening
- [ ] Rate limit /generate
- [ ] Server-side validation всех полей
- [ ] Логи в Supabase (таблица logs или в jobs.error/meta)
- [ ] Таймауты nginx 600s
- [ ] Cleanup tmp-inputs (cron в n8n или отдельный job)

Definition of Done (MVP)
------------------------
- Mini App открывается из бота в приватном чате.
- После открытия видны user_id и balance из Supabase.
- Пользователь выбирает модель, вводит prompt, загружает файлы согласно лимитам.
- Нажимает Generate -> списание баланса -> ожидание -> получает output_url и превью.
- История задач доступна.
- По кнопке “Отправить документом” результат отправляется в чат ботом (n8n).

