FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential autoconf automake libtool pkg-config \
    libmicrohttpd-dev libjansson-dev libssl-dev libglib2.0-dev libopus-dev \
    libogg-dev libconfig-dev libnice-dev libsrtp2-dev gengetopt && \
    rm -rf /var/lib/apt/lists/*
# Janus v1.4.2, pinned to its upstream commit.
RUN git init /src && cd /src && git remote add origin https://github.com/meetecho/janus-gateway.git && \
    git fetch --depth 1 origin 0a24110ae55a172c4293749b763dbb66a138f9ec && git checkout FETCH_HEAD
WORKDIR /src
RUN sh autogen.sh && ./configure --prefix=/opt/janus \
    --disable-all-plugins --enable-plugin-streaming \
    --disable-all-transports --enable-rest --disable-all-handlers --disable-all-loggers \
    --disable-data-channels --disable-turn-rest-api && make -j2 && make install

FROM debian:bookworm-slim AS janus
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 libmicrohttpd12 libjansson4 libssl3 libglib2.0-0 libopus0 libogg0 \
    libconfig9 libnice10 libsrtp2-1 && rm -rf /var/lib/apt/lists/* && \
    useradd --system --uid 10001 janus && mkdir -p /run/janus && chown janus /run/janus
COPY --from=build /opt/janus /opt/janus
COPY configure.py /app/configure.py
USER janus
ENTRYPOINT ["python3", "/app/configure.py"]

FROM nginx:1.28-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/

FROM debian:bookworm-slim AS tone
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
# One short pulse per second. This is a connectivity source, not a latency measurement.
ENTRYPOINT ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-re", "-f", "lavfi", "-i", "aevalsrc=0.1*sin(2*PI*880*t)*lt(mod(t\\,1)\\,0.1):s=48000", "-ac", "2", "-c:a", "libopus", "-b:a", "64k", "-frame_duration", "20", "-payload_type", "111", "-f", "rtp", "rtp://janus:5002?pkt_size=1200"]
