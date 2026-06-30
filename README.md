# InboxZero — AI Batch Triage Service

Submit a batch of text messages (support emails, feedback, etc.); a **background worker**
processes each one with AI — classify, score priority + sentiment, summarize, and draft a
reply — while the job and per-item status converge from `queued → processing → done/failed`.

This challenge is about **asynchronous, queue-based processing done right**: a real job
queue, a separate worker process, status tracking, retries with backoff, idempotency, and
multi-tenant safety. The AI itself is intentionally trivial.

**Live demo:** https://inboxzero-two.vercel.app
_(The frontend is always-on; the backend runs locally behind a Cloudflare tunnel — see [Deployment](#deployment). If the live app can't reach the backend, the tunnel/laptop is offline; the demo video shows the full working flow.)_

---

## Tech choices

| Layer | Choice | Why |
|---|---|---|
| API | Node.js + Express + TypeScript | One language across the whole stack |
| Queue / broker | **BullMQ on Redis** | Battle-tested; built-in retries, backoff, concurrency |
| Worker | Separate Node process (own container) | Real offloading — never blocks the API |
| Database | PostgreSQL | Required; relational job/item model |
| ORM + migrations | **Prisma** | Type-safe client + real, committed migration files |
| Auth | JWT (`jsonwebtoken` + `bcryptjs`) | Simple email/password → token |
| AI | **Groq** (OpenAI-compatible) | Free tier, fast; *optional* — see below |
| Frontend | Next.js (App Router) + **React Query** | Live polling that stops when done; cache invalidation |
| Containers | Docker + docker-compose | `api` + `worker` + `postgres` + `redis` |

### AI works with **no API key**
If `GROQ_API_KEY` is unset, the worker falls back to a **deterministic stub classifier**, so
the entire async pipeline runs and demos with zero key and zero cost. Set the key to switch to
real Groq inference automatically. (Provider used: **Groq**, model `llama-3.3-70b-versatile`.)

---

## Architecture

```
                 POST /jobs (returns instantly)
   Client ───────────────────────────────────►  Express API
                                                    │  1. create Job + Items (one tx)
                                                    │  2. enqueue one job per item
                                                    ▼
                                              Redis (BullMQ queue)
                                                    │
                                                    ▼
                                          Worker process (separate container)
                                          - concurrency cap + queue rate limiter
                                          - classify() each item with AI
                                          - retries w/ exponential backoff
                                          - 429 -> pause & retry (no attempt lost)
                                          - writes results back to Postgres
   Client ◄──── GET /jobs/:id (poll) ─────────  Postgres (status converges)
```

The API **never** runs AI work — it only enqueues. All processing happens in the worker.

### Retry & idempotency strategy

- **Retries / backoff:** each item is enqueued as its own BullMQ job with
  `attempts = JOB_ATTEMPTS` and exponential `backoff`. A transient failure (network, 5xx, or
  the simulated failure) is retried automatically. The item is marked `failed` **only after all
  attempts are exhausted** (we guard on `job.attemptsMade >= opts.attempts`).
- **Rate limiting (avoiding provider 429s):** two layers. *Proactive* — a BullMQ worker
  `limiter` caps AI calls to `AI_RATE_MAX` per `AI_RATE_DURATION_MS`, sized under the provider's
  free-tier limit. *Reactive* — a `429` pauses the worker (`worker.rateLimit()`, honoring
  `Retry-After`) and re-runs the job **without consuming a retry attempt**. This is why a large
  batch processes in steady waves instead of failing on rate limits.
- **Failure isolation:** one item = one queue job, so a bad item never blocks or fails the
  rest of the batch.
- **Idempotency:**
  - Results are **columns on the item row**, keyed by item `id` — re-processing *overwrites in
    place*, it can never create duplicate rows.
  - The worker has a **status guard**: if an item is already `done`, processing is a no-op.
  - The queue job id is `item-<id>`, so enqueuing the same pending item twice is de-duplicated
    at the queue level.
- **Job rollup:** after each item reaches a terminal state, the job recomputes counts; once no
  item is `queued`/`processing`, the job flips `processing → completed`. Safe to run repeatedly.
- **Manual retry:** `POST /jobs/:id/retry` resets that job's `failed` items to `queued`, clears
  their error, and re-enqueues them — itself idempotent.

### Multi-tenant safety
Every job/item query is scoped by the authenticated `userId` (items also store a denormalized
`user_id`). A user requesting another user's job gets a `404`.

---

## Data model

`users`, `jobs`, `items` — see [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).
The migration that creates these tables is committed at
[`apps/api/prisma/migrations/`](apps/api/prisma/migrations/).

---

## Running locally (from a fresh clone)

The app has two halves: the **backend** (API + worker + Postgres + Redis, via Docker) and the
**frontend** (Next.js, run separately — it lives on Vercel in production). Run both to use the
full app locally. **No API key is required** — without `GROQ_API_KEY` the worker uses a built-in
stub classifier, so everything works out of the box.

### 1. Backend (Docker — recommended)

Prereqs: Docker Desktop.

```bash
# (optional) copy env defaults; compose also works with no .env at all
cp .env.example .env

# Bring up the whole backend: postgres + redis + migrate + api + worker
docker compose up --build
```

`docker compose up` runs the `migrate` service first (applies committed migrations), then
starts `api` (http://localhost:4000) and the separate `worker`. To use real AI instead of the
stub, put a free Groq key in `.env` (`GROQ_API_KEY=...`) and restart.

### 2. Frontend

```bash
cd apps/web
cp .env.local.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                          # http://localhost:3000
```

Open http://localhost:3000, register, and submit the pre-filled sample batch.

**Run migrations manually** (e.g. after adding one):
```bash
docker compose run --rm api npx prisma migrate deploy
```

### Running without Docker (local Node)
```bash
# Start just the infra in Docker:
docker compose up -d postgres redis
cd apps/api
npm install
npx prisma migrate deploy        # uses DATABASE_URL from your shell/.env
npm run build
npm run start:api                # terminal 1 — API
npm run start:worker             # terminal 2 — worker (separate process)
```

---

## Environment variables

See [`.env.example`](.env.example). Key ones:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis (BullMQ broker) |
| `JWT_SECRET` | Token signing secret |
| `GROQ_API_KEY` | *Optional* — Groq key; blank = stub classifier |
| `WORKER_CONCURRENCY` | Parallel AI calls cap (default 3) |
| `JOB_ATTEMPTS` | Retry attempts per item (default 3) |
| `JOB_BACKOFF_MS` | Base backoff delay (default 1000ms) |
| `AI_RATE_MAX` / `AI_RATE_DURATION_MS` | Rate limiter: max AI calls per window (default 20 / 60000ms) |
| `MAX_BATCH_ITEMS` | Batch size cap (default 50) |
| `MAX_ITEM_CHARS` | Per-item length cap (default 4000) |

---

## API reference

All `/jobs` routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | `{email, password}` → `{user, token}` |
| `POST` | `/auth/login` | `{email, password}` → `{user, token}` |
| `POST` | `/jobs` | `{text}` (newline-separated) or `{items: string[]}` → returns instantly with `{id, status, totalItems}` |
| `GET` | `/jobs` | List my jobs with status counts |
| `GET` | `/jobs/:id` | Job detail: items + AI results + counts |
| `POST` | `/jobs/:id/retry` | Re-enqueue this job's failed items |
| `GET` | `/health` | Health check |

### Simulating a failure (for the demo)
Any item whose text contains **`FAIL`** always throws in the classifier — use it to demonstrate
retries → eventual `failed` → manual retry, while the rest of the batch completes.

### Quick smoke test
```bash
TOKEN=$(curl -s -X POST localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@test.com","password":"password123"}' | jq -r .token)

JOB=$(curl -s -X POST localhost:4000/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"app crashes on login\nrefund my charge\nadd dark mode\nFAIL this one"}')

echo $JOB                                   # instant: {"id":...,"status":"processing",...}
JOB_ID=$(echo $JOB | jq -r .id)
curl -s localhost:4000/jobs/$JOB_ID -H "Authorization: Bearer $TOKEN" | jq   # poll
```

---

## Frontend (apps/web)

Next.js (App Router) + React Query. Screens: register / login, submit a batch, jobs list, and
a job detail table that updates **live**.

- **Live progress:** the job detail view polls `GET /jobs/:id` every 1.5s and **stops polling
  once the job is `completed`** (`refetchInterval` returns `false` on a terminal job) — no
  endless background polling.
- **Cache invalidation:** submitting a batch or retrying failed items invalidates the React
  Query cache (`jobs` list + job detail) so the UI refreshes without a full page reload.
- **Auth:** the JWT is stored in `localStorage`; a guard redirects unauthenticated users to
  `/login`. Each request sends `Authorization: Bearer <token>`.

To run it locally see [Running locally](#running-locally-from-a-fresh-clone). The submit box is
pre-filled with a sample batch that includes a `FAIL` line, so you can watch a retry → failure →
manual retry.

---

## Deployment

**Frontend → Vercel (required)**
1. Import the repo in Vercel; set the **Root Directory** to `apps/web`.
2. Set the env var `NEXT_PUBLIC_API_URL` to your backend's public URL (the tunnel URL below,
   or a cloud backend URL).
3. Deploy. Vercel gives you the live URL — put it at the top of this README.

**Backend → local + tunnel (chosen approach)**
The backend, worker, Postgres and Redis run locally via Docker. To let the live Vercel site
reach the local API, expose it with a tunnel (the worker stays private — only the API is public):

```bash
# 1. Bring up the backend stack
docker compose up --build

# 2. In another terminal, expose the API publicly (no account needed)
cloudflared tunnel --url http://localhost:4000
# -> prints a public https URL, e.g. https://random-words.trycloudflare.com
```

Then in Vercel set `NEXT_PUBLIC_API_URL` to that tunnel URL and redeploy. `CORS_ORIGIN=*`
(default) lets the Vercel origin call the API; tighten it to your Vercel domain if you prefer.

> Why a tunnel: it demonstrates how a deployed frontend reaches a backend across origins
> (CORS, env-based API URLs, base URLs) without hosting the backend in the cloud.

---

## Submission checklist

- [x] Repo link: https://github.com/tugberkgktp/inboxzero
- [x] Live Vercel URL: https://inboxzero-two.vercel.app
- [x] Backend location: **local + cloudflared tunnel** — `cloudflared tunnel --url http://localhost:4000`
- [x] Test account: register any email/password in the UI (e.g. `demo@demo.com` / `password123`)
- [x] AI provider: **Groq** (`llama-3.3-70b-versatile`); falls back to a stub if no key
- [x] Queue/broker: **BullMQ on Redis**; retry = exponential backoff (3 attempts) + rate-limit handling; idempotency = item-id-keyed results + status guard + queue dedup
- [x] `.env.example` committed
- [x] Migration file(s) committed (`apps/api/prisma/migrations/`)
- [x] `docker compose up` brings up API + worker + DB + broker
- [ ] Demo video link — _add after recording_
- [x] No secrets committed
