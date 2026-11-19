# FastAPI LLM Gateway

A small LLM gateway with JWT authentication and a database-backed provider
registry.

## Running

Configure `DATABASE_URL` and the secrets in `.env`, then apply the PostgreSQL
schema before starting the API:

```bash
uv run alembic upgrade head
uv run uvicorn backend.main:app --reload
```

## Provider management

Provider management endpoints require an authenticated **Superuser**. The first
user registered through `POST /auth/register` is automatically a Superuser.

| Method   | Endpoint                          | Description                                        |
| -------- | --------------------------------- | -------------------------------------------------- |
| `GET`    | `/provider`                       | List configured providers                          |
| `GET`    | `/provider/{provider_id}`         | Fetch a single provider                            |
| `POST`   | `/provider/create`                | Create a provider                                  |
| `PATCH`  | `/provider/update/{provider_id}`  | Update provider configuration                      |
| `DELETE` | `/provider/delete/{provider_id}`  | Delete a provider and its models                   |
| `POST`   | `/provider/disable/{provider_id}` | Disable a provider without deleting it             |
| `GET`    | `/provider/models/{provider_id}`  | List stored models for a provider                  |
| `POST`   | `/provider/models/{provider_id}`  | Fetch and persist models from `{base_url}/v1/models` |

API keys and custom headers are encrypted at rest and are never returned by any
endpoint. Public model IDs are generated as `{aliases}/{upstream_model_name}`
and keep the upstream identifier unchanged. Changing a provider alias
regenerates every affected model ID in the same transaction.

## Configuration

See `.env.example`. Providers can be created through the API. Legacy
`PROVIDERS` configuration is imported on startup when the registry is empty.

Set `PROVIDER_ENCRYPTION_KEY` in production. If it is omitted, a key is derived
from `JWT_SECRET_KEY`, which is intended for local development only and makes
stored credentials depend on the JWT secret.

## Usage credits

Inference requires funded user/provider credits and a superuser-configured
provider-model rate. One rate determines both deductions. Existing deployments
must configure rates and add credits before inference can resume after upgrade.
See [the credit API and operating guide](docs/credits.md) for setup, endpoint
bodies, reservations, and recovery.

## Tests

```bash
uv run pytest
```

The PostgreSQL integration tests require a disposable PostgreSQL database and
permission to create and drop test schemas:

```bash
TEST_POSTGRES_URL='postgresql://user:password@localhost:5432/gateway_test' uv run pytest tests/test_postgresql_integration.py
```

## Docker deployment

Docker Engine with Compose v2 is required. The API runs as an unprivileged user,
with a managed PostgreSQL database. The static dashboard and API
share one origin through nginx. The image uses the committed uv and npm locks.

1. Create a configuration file and set stable, independent secrets:

   ```bash
   cp .env.example .env
   # Generate a JWT secret:
   openssl rand -hex 32
   # Generate a Fernet key for PROVIDER_ENCRYPTION_KEY:
   openssl rand -base64 32 | tr '+/' '-_'
   ```

   Put the generated values in `JWT_SECRET_KEY` and
   `PROVIDER_ENCRYPTION_KEY` in `.env`. Keep both safe and retain the same
   encryption key across restarts and restores. Set `DATABASE_URL` to the
   provider's PostgreSQL connection URL including required SSL options. Keep the
   database and API in the same region to reduce network latency.

2. Start the services:

   ```bash
   docker compose build
   docker compose run --rm --no-deps api alembic upgrade head
   docker compose up -d
   docker compose ps
   ```

   Visit <http://localhost:8080>. SDK clients can use `http://localhost:8080/v1` as their base URL. Set
   `GATEWAY_PORT` or `GATEWAY_BIND_ADDRESS` in `.env` to change the published
   port or bind address. The default binds only to localhost; for production,
   put a TLS-terminating reverse proxy in front of it. Run one API instance;
   reconciliation and retention jobs run inside the API process.

3. Register the first user before exposing the service publicly: that user is
   automatically a superuser. Disable further signups in Settings if they are
   not needed.

Configure and verify managed PostgreSQL backups and retain the encryption keys
separately. Migrations are an explicit deployment step and must complete before
starting updated application instances. Pool limits apply per API process; keep
the total below the provider's connection limit. `/health` is liveness and
`/ready` checks database connectivity. If PostgreSQL is unavailable, authenticated
requests and inference cannot proceed safely. Update images deliberately and
review application configuration and access controls before public deployment.

### Temporary Cloudflare quick tunnel

To share the same stack temporarily without a domain or Cloudflare account:

```bash
docker compose -f docker-compose.yml -f docker-compose-cf.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose-cf.yml logs cloudflared
```

Open the `https://...trycloudflare.com` URL in the logs. It changes when the
quick tunnel is recreated and is publicly accessible to anyone who has it. The
SDK base URL is `https://...trycloudflare.com/v1`. Stop the whole stack with
`docker compose -f docker-compose.yml -f docker-compose-cf.yml down`.

[Cloudflare quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
are for testing, have no uptime guarantee, are limited to 200 concurrent
requests, and do not support server-sent events, so streaming inference and the
streaming playground cannot be used through them. For production, use a named
Cloudflare Tunnel with a stable hostname or a TLS reverse proxy instead.
