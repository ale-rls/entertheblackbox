FROM savonet/liquidsoap:v2.2.5

# Bake immutable configuration and beds into the image. Only generated/show
# narration lives on the shared persistent volume.
COPY liquidsoap/main.liq /etc/liquidsoap/main.liq
COPY beds /beds

CMD ["liquidsoap", "/etc/liquidsoap/main.liq"]
