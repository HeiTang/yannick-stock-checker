"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import get_cache, router as api_router
from app.config import settings

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Suppress noisy httpx debug logs (keep at INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    logger.info("Application starting up …")

    # Warm up cache on startup
    cache = get_cache()
    try:
        await cache.force_refresh()
        logger.info("Initial cache warm-up complete")
    except Exception:
        logger.exception("Initial cache warm-up failed — will retry on first request")

    yield

    logger.info("Application shutting down …")


app = FastAPI(
    title="亞尼克 YTM 庫存反向查詢 API",
    description="將亞尼克 YTM 販賣機的「據點→商品」查詢反轉為「商品→據點」",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router)

# Static files for web frontend (Phase 3)
import os


def mount_static_files(target_app: FastAPI) -> None:
    """Mount the web frontend static files if dist/ exists."""
    dist_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web", "dist")
    if os.path.exists(dist_path):
        target_app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")
    else:
        logger.warning(f"Static directory not found: {dist_path}. Run 'npm run build' in web/.")


mount_static_files(app)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
