import pytest
from pydantic import ValidationError

from app.config import Settings


def test_cors_origins_are_trimmed_and_split():
    config = Settings(
        cors_origins="https://example.com, https://admin.example.com",
        cors_allow_credentials=True,
        _env_file=None,
    )

    assert config.cors_origin_list == [
        "https://example.com",
        "https://admin.example.com",
    ]


def test_cors_credentials_reject_wildcard():
    with pytest.raises(ValidationError, match="explicit CORS_ORIGINS"):
        Settings(cors_origins="*", cors_allow_credentials=True, _env_file=None)
