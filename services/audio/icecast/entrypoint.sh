#!/bin/sh
set -eu

: "${ICECAST_SOURCE_PASSWORD:?ICECAST_SOURCE_PASSWORD is required}"
: "${ICECAST_ADMIN_PASSWORD:?ICECAST_ADMIN_PASSWORD is required}"
: "${ICECAST_RELAY_PASSWORD:=${ICECAST_SOURCE_PASSWORD}}"
: "${ICECAST_HOSTNAME:=localhost}"
: "${ICECAST_MAX_CLIENTS:=400}"
: "${ICECAST_MAX_SOURCES:=120}"

case "$ICECAST_HOSTNAME" in
  *://*|*/*|*:*)
    echo "ICECAST_HOSTNAME must be a hostname without scheme, path, or port" >&2
    exit 1
    ;;
esac

xml_escape() {
  sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

ICECAST_SOURCE_PASSWORD_XML=$(printf '%s' "$ICECAST_SOURCE_PASSWORD" | xml_escape)
ICECAST_ADMIN_PASSWORD_XML=$(printf '%s' "$ICECAST_ADMIN_PASSWORD" | xml_escape)
ICECAST_RELAY_PASSWORD_XML=$(printf '%s' "$ICECAST_RELAY_PASSWORD" | xml_escape)
ICECAST_HOSTNAME_XML=$(printf '%s' "$ICECAST_HOSTNAME" | xml_escape)

export ICECAST_SOURCE_PASSWORD_XML ICECAST_ADMIN_PASSWORD_XML \
    ICECAST_RELAY_PASSWORD_XML ICECAST_HOSTNAME_XML \
    ICECAST_MAX_CLIENTS ICECAST_MAX_SOURCES

envsubst '$ICECAST_SOURCE_PASSWORD_XML $ICECAST_ADMIN_PASSWORD_XML $ICECAST_RELAY_PASSWORD_XML $ICECAST_HOSTNAME_XML $ICECAST_MAX_CLIENTS $ICECAST_MAX_SOURCES' \
    < /etc/icecast.xml.tpl > /tmp/icecast.xml

exec su-exec icecast icecast -c /tmp/icecast.xml
