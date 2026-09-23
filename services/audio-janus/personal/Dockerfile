FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.115.12 uvicorn==0.34.3 httpx==0.28.1
# Reuse stable command/registry helpers without modifying the Icecast service.
COPY audio/bridge/bridge/liq.py audio/bridge/bridge/state.py /app/bridge/
COPY audio-janus/personal/ /app/personal/
CMD ["uvicorn", "personal.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
