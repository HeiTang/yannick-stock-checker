# ==========================================
# Target: Yannick Stock Checker Cloud Run Image
# ==========================================

# ------------------------------------------
# Stage 1: Build Frontend (Astro)
# ------------------------------------------
FROM node:22-slim AS frontend-builder
WORKDIR /build

# Copy web files
COPY web/package.json web/package-lock.json* ./
RUN npm ci

COPY web/ ./
RUN npm run build

# ------------------------------------------
# Stage 2: Build Backend & Serve
# ------------------------------------------
FROM python:3.11-slim AS backend

# Prevents Python from writing pyc files to disk and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app_root

# Install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY app/ ./app/

# Copy built static files from Stage 1 into the target directory that main.py expects
COPY --from=frontend-builder /build/dist ./web/dist

# Ensure the app runs on the assigned Cloud Run PORT ($PORT)
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
