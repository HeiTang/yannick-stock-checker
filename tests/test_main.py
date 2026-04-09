"""Tests for main application module."""

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.main


def test_lifespan_success():
    with patch("app.main.get_cache") as mock_get_cache:
        mock_cache = AsyncMock()
        mock_get_cache.return_value = mock_cache

        with TestClient(app.main.app):
            pass

        mock_cache.force_refresh.assert_called_once()


def test_lifespan_exception():
    with patch("app.main.get_cache") as mock_get_cache:
        mock_cache = AsyncMock()
        mock_cache.force_refresh.side_effect = Exception("Test Init Error")
        mock_get_cache.return_value = mock_cache

        # Should not raise
        with TestClient(app.main.app):
            pass

        mock_cache.force_refresh.assert_called_once()


def test_mount_static_files_when_dist_exists():
    """When dist/ exists, mount() should be called."""
    test_app = FastAPI()
    with patch("os.path.exists", return_value=True), patch("os.path.isdir", return_value=True):
        with patch.object(test_app, "mount") as mock_mount:
            app.main.mount_static_files(test_app)
            mock_mount.assert_called_once()


def test_mount_static_files_when_dist_missing():
    """When dist/ doesn't exist, mount() should NOT be called."""
    test_app = FastAPI()
    with patch("os.path.exists", return_value=False):
        with patch.object(test_app, "mount") as mock_mount:
            app.main.mount_static_files(test_app)
            mock_mount.assert_not_called()
