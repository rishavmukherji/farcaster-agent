#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 SKILL_BASE_DIR" >&2
  exit 1
fi

BASE_DIR="$1"
RUNTIME_ROOT="$BASE_DIR/runtime"
RUNTIME_DIR="$RUNTIME_ROOT/farcaster-agent"
REPO_URL="${FARCASTER_AGENT_REPO_URL:-https://github.com/pierce403/farcaster-agent.git}"

mkdir -p "$RUNTIME_ROOT"

if [ -d "$RUNTIME_DIR/.git" ]; then
  echo "Updating runtime in $RUNTIME_DIR"
  git -C "$RUNTIME_DIR" pull --ff-only
else
  echo "Cloning runtime from $REPO_URL"
  git clone --depth 1 "$REPO_URL" "$RUNTIME_DIR"
fi

echo "Installing dependencies in $RUNTIME_DIR"
npm ci --prefix "$RUNTIME_DIR"

echo "Runtime ready at $RUNTIME_DIR"
