import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Telegram Bot API token
    BOT_TOKEN: str = ""

    # Superadmin IDs (optional, for global bot control)
    ADMIN_IDS: List[int] = []

    # Filter toggles
    ENABLE_LINK_FILTER: bool = True
    ENABLE_PROFANITY_FILTER: bool = True
    ENABLE_SPAM_FILTER: bool = True
    ENABLE_FLOOD_FILTER: bool = True

    # Allow administrators to post links and bypass filters
    ALLOW_ADMINS_BYPASS: bool = True

    # Warning settings
    MAX_WARNINGS: int = 3
    MUTE_DURATION_HOURS: int = 24  # Default mute after max warnings
    WARN_EXPIRY_DAYS: int = 7

    # Anti-flood settings
    FLOOD_MESSAGE_LIMIT: int = 4   # Max messages
    FLOOD_TIME_SECONDS: int = 4    # In X seconds

    # Anti-spam settings
    MAX_CAPS_PERCENT: float = 70.0 # Trigger if caps > 70% and length >= 12
    MIN_CAPS_LEN: int = 12
    MAX_MENTIONS: int = 4          # Max @ mentions per message
    BLOCK_FORWARD_FROM_CHANNELS: bool = True

    # UI Settings
    AUTO_DELETE_ALERT_SECONDS: int = 8  # Delete warning notifications after N sec

    # Database
    DATABASE_PATH: str = "moderator_bot.db"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
