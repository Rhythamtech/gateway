# FastAPI LLM Gateway

A small LLM gateway with JWT authentication and a database-backed provider
registry.

## Running

```bash
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
