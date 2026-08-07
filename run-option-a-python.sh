#!/bin/bash
# Option A — Python local server
# Run with: ./run-option-a-python.sh

cd "$(dirname "$0")"

if command -v python3 &> /dev/null; then
  PYCMD=python3
elif command -v python &> /dev/null; then
  PYCMD=python
else
  echo "Python was not found on this computer."
  echo "Install it from https://www.python.org/downloads/ and run this script again."
  exit 1
fi

echo "Starting server at http://localhost:8080 ..."

# Open the browser after a short delay (server needs a moment to bind).
( sleep 1
  if command -v open &> /dev/null; then open http://localhost:8080
  elif command -v xdg-open &> /dev/null; then xdg-open http://localhost:8080
  fi
) &

$PYCMD no_cache_server.py 8080
