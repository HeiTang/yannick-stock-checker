"""Application configuration via environment variables."""

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Yannick API ──────────────────────────────────────────
    yannick_base_url: str = "https://www.yannick.com.tw"
    service_page_path: str = "/ytm/service2"
    stock_api_path: str = "/_zh-cht/ajaxTYTMStock.ashx"

    # ── Scraper ──────────────────────────────────────────────
    max_concurrent_requests: int = 5
    request_delay_seconds: float = 0.2
    request_timeout_seconds: float = 20.0

    # ── Retry (exponential backoff + jitter) ─────────────────
    retry_max_attempts: int = 3
    retry_initial_backoff: float = 1.0  # seconds
    retry_max_backoff: float = 8.0  # seconds cap

    # ── Cache ────────────────────────────────────────────────
    cache_ttl_seconds: int = 600  # 10 minutes

    # ── Server ───────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    # ── CORS ─────────────────────────────────────────────────
    cors_origins: str = "*"
    cors_allow_credentials: bool = False

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # ── Computed ─────────────────────────────────────────────
    @property
    def service_page_url(self) -> str:
        return f"{self.yannick_base_url}{self.service_page_path}"

    @property
    def stock_api_url(self) -> str:
        return f"{self.yannick_base_url}{self.stock_api_path}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @model_validator(mode="after")
    def validate_cors(self) -> "Settings":
        if self.cors_allow_credentials and "*" in self.cors_origin_list:
            raise ValueError("CORS_ALLOW_CREDENTIALS requires explicit CORS_ORIGINS")
        return self


settings = Settings()
