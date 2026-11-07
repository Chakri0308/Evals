# RAG Lab - single container: built UI + API on :8765.
#   docker build -t rag-lab .
#   docker run -p 8765:8765 --env-file .env -v rag-lab-data:/app/data rag-lab
# Ollama is not inside the image: point OLLAMA_BASE_URL at a host/sidecar Ollama, use a cloud LLM key, or run
# with RAG_LAB_ALLOW_LLM=false (BM25 + extractive answers).

FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    RAG_LAB_DATA=/app/data RAG_LAB_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.txt backend/requirements-optional.txt ./
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt
COPY backend/app ./app
COPY samples /app/samples
COPY --from=ui /ui/dist /app/frontend/dist
RUN useradd --create-home raglab && mkdir -p /app/data && chown -R raglab /app/data
USER raglab
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health')"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--proxy-headers", "--timeout-graceful-shutdown", "10"]
