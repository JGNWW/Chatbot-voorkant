"""Applicatie-instellingen, geladen uit omgevingsvariabelen / .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    selection_model: str = "claude-haiku-4-5-20251001"
    answer_model: str = "claude-sonnet-4-6"

    site_base_url: str = "https://www.nederlandwereldwijd.nl"
    sitemap_url: str = "https://www.nederlandwereldwijd.nl/paginas/sitemap.xml"
    sitemap_ttl_seconds: int = 86400

    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
