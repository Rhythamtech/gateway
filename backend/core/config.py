from typing import Literal

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderProtocol = Literal["openai", "anthropic"]
BalancePolicy = Literal["estimate", "unbillable"]


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

    # Billing / accounting. integer-based credits and rates only.
    # One normalized token unit == one base user credit; the model-group
    # multiplier scales it (credit_multiplier_ppm; 1x = 1_000_000).
    # Reservations cover an estimated maximum charge: request-derived token
    # estimate inflated by RESERVATION_MARGIN_PPM, and the requested
    # output-token limit (DEFAULT_OUTPUT_TOKENS when the request omits it).
    BILLING_RESERVATION_MARGIN_PPM: int = 100_000  # +10% estimation margin
    BILLING_DEFAULT_OUTPUT_TOKENS: int = 1000
    # Policy when an upstream attempt consumed tokens but the provider never
    # reported usage: "estimate" bills the reservation estimate,
    # "unbillable" charges nothing. The decision is recorded on the trace.
    BILLING_MISSING_USAGE_POLICY: BalancePolicy = "estimate"
    # Active reservations older than this (created before dispatch and never
    # settled, e.g. after a crash) are released without billing when the next
    # attempt for the same user arrives. Defaults past ROUTER_TIMEOUT.
    BILLING_RESERVATION_TTL_SECONDS: int = 330
    # Default pricing version for calls resolved without a model group
    # (multiplier 1x). Versioned snapshots never change historical charges.
    BILLING_PRICING_VERSION: str = "1"

    model_config = SettingsConfigDict(
        env_file=".env",           # Looks for '.env' in the current working directory
        env_file_encoding="utf-8",
        extra="ignore"             # Ignores extra variables in .env not defined here
    )



settings = Settings()
