# build context is the repo root (see docker-compose.yml)
FROM python:3.12-alpine

WORKDIR /app
COPY bridge/pyproject.toml ./
COPY bridge/bridge ./bridge
RUN pip install --no-cache-dir .

# test player page served at /test/ (SPEC §10 T1)
COPY web /web
COPY beds /beds
ENV WEB_DIR=/web

EXPOSE 8090
CMD ["python", "-m", "bridge.app"]
