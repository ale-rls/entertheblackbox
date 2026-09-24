FROM savonet/liquidsoap:v2.2.5
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY main.liq /etc/liquidsoap/main.liq
RUN mkdir -p /beds/default && ffmpeg -v error -f lavfi -i anullsrc=r=48000:cl=stereo -t 120 /beds/default/silence.wav
CMD ["/etc/liquidsoap/main.liq"]
