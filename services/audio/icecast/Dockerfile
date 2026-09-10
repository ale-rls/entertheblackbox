FROM alpine:3.24

RUN apk add --no-cache icecast gettext su-exec

COPY icecast.xml.tpl /etc/icecast.xml.tpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
