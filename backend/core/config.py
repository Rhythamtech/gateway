from typing import Literal

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderProtocol = Literal["openai", "anthropic"]


class ProviderSettings(BaseModel):
    name: str
    protocol: ProviderProtocol
    base_url: str
    api_key: str = ""
    headers: dict[str, str] = Field(default_factory=dict)


class Settings(BaseSettings):
    DATABASE_URL: str

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    PROVIDERS: list[ProviderSettings] = []
    ROUTER_DEFAULT_PROVIDER: str = ""
    ROUTER_TIMEOUT: float = 300.0
    ROUTER_MODEL_ROUTES: dict[str, str] = {}
    ROUTER_MODEL_CACHE_TTL: int = 300

    CREDITS_RECONCILE_INTERVAL_SECONDS: int = Field(default=30, ge=1)
    CREDITS_REVIEW_AFTER_SECONDS: int = Field(default=900, ge=60)

    # Provider management
    # Fernet key used to encrypt provider credentials at rest. If unset, a key
    # is derived from JWT_SECRET_KEY so development setups keep working. Set an
    # explicit key (and keep it stable) in production.
    PROVIDER_ENCRYPTION_KEY: str = ""
    # Timeout for provider management requests (model synchronization).
    PROVIDER_REQUEST_TIMEOUT: float = 15.0
    # SSRF protection. Keep disabled in production. Enable only for local
    # development against a provider running on a private network.
    PROVIDER_ALLOW_PRIVATE_NETWORKS: bool = False
    # Maximum number of redirects followed while fetching provider models.
    PROVIDER_MAX_REDIRECTS: int = 3
    # Maximum accepted upstream response size for model synchronization.
    PROVIDER_MAX_RESPONSE_BYTES: int = 5 * 1024 * 1024

    # OpenTelemetry (operational observability). Disabled by default so local
    # development runs with zero overhead. When enabled, request and LLM-call
    # spans are emitted; with ``OTLP_EXPORTER_ENDPOINT`` left empty spans are
    # created locally only — point it at a collector (e.g. Jaeger/Tempo) to
    # export them. This is separate from the persisted user /traces data.
    TELEMETRY_ENABLED: bool = False
    OTLP_EXPORTER_ENDPOINT: str = ""
    OTEL_SERVICE_NAME: str = "llm-gateway"
    # "always_on" or "always_off" sampler name from opentelemetry.sdk.trace.sampling.
    OTEL_SAMPLER: str = "always_on"

    model_config = SettingsConfigDict(
        env_file=".env",           # Looks for '.env' in the current working directory
        env_file_encoding="utf-8",
        extra="ignore"             # Ignores extra variables in .env not defined here
    )



settings = Settings()
