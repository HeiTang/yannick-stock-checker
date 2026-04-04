"""Application configuration via environment variables."""

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

    # ── Cache / Scheduler ────────────────────────────────────
    cache_ttl_seconds: int = 600  # 10 minutes

    # ── Database ─────────────────────────────────────────────
    db_path: str = "data/yannick_stock.db"

    # ── Server ───────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8080

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    # ── Computed ─────────────────────────────────────────────
    @property
    def service_page_url(self) -> str:
        return f"{self.yannick_base_url}{self.service_page_path}"

    @property
    def stock_api_url(self) -> str:
        return f"{self.yannick_base_url}{self.stock_api_path}"


settings = Settings()
