# AGENTS.md

FastAPI LLM gateway (Python 3.11, uv) with an Astro/React dashboard in `frontend/`.

## Commands

Backend — run from repo root (settings load `.env` relative to CWD):

- Run API: `uv run uvicorn backend.main:app --reload` → docs at `/docs`, OpenAPI at `/openapi.json`
- Tests: `uv run pytest` — runs the test suite (`test_routing_strategies.py`, `test_credit_removal.py`).
- Bootstrap: the first user registered via `POST /auth/register` is automatically a Superuser.

Frontend — run in `frontend/`, Node >= 22.12:

- Use **npm**: `package-lock.json` is the working lockfile (all verification in `TODOs.md` used npm); both it and `bun.lock` are committed — don't switch managers.
- `npm run typecheck` (`astro check`) must stay at 0 errors / ≤4 pre-existing hints in `playground.tsx`.
- `npm run lint` **currently fails**: 10 errors + 1 warning, all pre-existing in `src/components/playground.tsx` (Phase 9 baseline). Don't "fix" them and don't reformat unrelated files; lint only files you touch. `npx prettier --check src` has 5 pre-existing unformatted files.

## Backend structure

- Composition root is `backend/main.py`: router mounting, middleware order (last-added runs first, so CORS is outermost → `APIKeyAuthMiddleware` → telemetry), and per-path error shaping. Feature modules follow a `controller/dtos/models/service` layout.
- Error envelopes are shaped per request path in `backend/main.py`: `/v1/*` uses the OpenAI envelope (`/v1/messages` the Anthropic one), `/model-groups*` and `/traces` use versioned `{error: {code, message, details, request_id}}`, everything else FastAPI's `{"detail": ...}`. Controllers raise `HTTPException` or `GatewayError` (data plane, from `backend/core/errors.py`) and the composition root rebuilds bodies — don't return JSONResponse yourself.
- Data plane (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`) is authenticated by API-key middleware only — API keys are never JWT identities. Rate limit: 60 req/min per key.
- DB (`backend/core/database.py`): two SQLAlchemy engines over one SQLite file — `engine` for reads (deferred transactions) and `write_engine` for writes (BEGIN IMMEDIATE). `get_db` yields a read session; use `SessionLocal` for writes.
- New SQLAlchemy model modules must be imported in `backend/main.py` (pattern: `models as ...  # noqa: F401`) or their tables are never mapped/created.
- Schema migrations live in `backend/core/migrations.py`: `create_all()` won't alter existing tables, so schema changes get a new append-only idempotent entry in `MIGRATIONS` — never edit applied migrations. `create_all` + migrations run at import time.
- Billing/wallet: fully removed (migration 0012 dropped all wallet, credit, capacity, and billing-daily tables, leaving operational token/latency tracing intact). No cap, no balance restrictions.

## Frontend structure

- All backend calls go through typed helpers in `src/lib/auth.ts` (`authenticatedRequest`); JWT access/refresh live in sessionStorage (no cookies), and there is no logout endpoint. Its `parseResponse` understands both error envelopes.
- Auth base URL: `PUBLIC_API_BASE_URL` (default `http://localhost:8000`).
- Dashboard pages are Astro files in `src/pages/dashboard/` mounting `<Dashboard client:only="react" currentPath=.../>`; detail pages use the static `detail?id=` query-param convention (static output can't prerender `:id` routes).
- Superuser gating is tri-layer and must agree: sidebar `superuserOnly` entries, `AuthGate requiresSuperuser` (prefix-matched), backend `require_superuser`. The backend stays authoritative.
- Reuse primitives in `src/components/ui/`; don't add new UI primitives or shadcn components without approval. Don't invent endpoints, fields, or metrics beyond what the live OpenAPI returns (known gaps are catalogued at the end of `TODOs.md`).

## Working conventions

- `TODOs.md` is the phased work log: work one phase at a time, and record findings + verification results there before starting the next phase.
- Backend contract docs: `docs/tracing.md`, `docs/diagrams.md` (incl. backend behavior notes).
- Provider CRUD lives under `/provider/...` (singular).
