#!/bin/bash
# Option B — Node local server
# Run with: ./run-option-b-node.sh

cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo "Node.js was not found on this computer."
  echo "Install it from https://nodejs.org/ (LTS version) and run this script again."
  exit 1
fi

echo "Starting server at http://localhost:3000 ..."

( sleep 1
  if command -v open &> /dev/null; then open http://localhost:3000
  elif command -v xdg-open &> /dev/null; then xdg-open http://localhost:3000
  fi
) &

node no_cache_server.js 3000
