#!/bin/sh

# Increase file descriptor limits for high connection count
ulimit -n 65536

echo "Starting WebSocket server with ulimit -n: $(ulimit -n)"

exec node websocket-server.js
