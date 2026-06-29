# InboxZero — AI Batch Triage Service

Submit a batch of text messages (support emails, feedback, etc.); a **background worker**
processes each one with AI — classify, score priority + sentiment, summarize, and draft a
reply — while the job and per-item status converge from `queued → processing → done/failed`.

This challenge is about **asynchronous, queue-based processing done right**: a real job
queue, a separate worker process, status tracking, retries with backoff, idempotency, and
multi-tenant safety. The AI itself is intentionally trivial.

> **Build status:** This is **Part 1 of 2** — the complete backend (API + worker + queue +
> DB + Docker). The Next.js + React Query frontend and Vercel deployment land in Part 2.

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
                                          - concurrency cap (rate-limits AI)
                                          - classify() each item with AI
                                          - retries w/ exponential backoff
                                          - writes results back to Postgres
   Client ◄──── GET /jobs/:id (poll) ─────────  Postgres (status converges)
```

The API **never** runs AI work — it only enqueues. All processing happens in the worker.

### Retry & idempotency strategy

- **Retries / backoff:** each item is enqueued as its own BullMQ job with
  `attempts = JOB_ATTEMPTS` and exponential `backoff`. A transient failure (AI timeout, 429,
  5xx, or the simulated failure) is retried automatically. The item is marked `failed` **only
  after all attempts are exhausted** (we guard on `job.attemptsMade >= opts.attempts`).
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

## Running locally (Docker — recommended)

Prereqs: Docker Desktop.

```bash
# 1. Configure env (defaults work out of the box; AI key optional)
cp .env.example .env

# 2. Bring up the whole stack: postgres + redis + migrate + api + worker
docker compose up --build
```

`docker compose up` runs the `migrate` service first (applies committed migrations), then
starts `api` (http://localhost:4000) and the separate `worker`.

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
| `MAX_BATCH_ITEMS` | Batch size cap (default 50) |

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

## Coming in Part 2
- Next.js + React Query frontend (login/register, submit batch, live-polling job table that
  stops when complete, retry-failed button, cache invalidation).
- Vercel deployment + tunnel for the local backend.
- Demo video + bonus items (SSE push, AI rate-limiting, dead-letter queue, tests).
