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

    model_config = SettingsConfigDict(
        env_file=".env",           # Looks for '.env' in the current working directory
        env_file_encoding="utf-8",
        extra="ignore"             # Ignores extra variables in .env not defined here
    )



settings = Settings()
