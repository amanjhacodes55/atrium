#!/usr/bin/env bash
# Fresh demo data for a take: an empty data folder. Start the server on it (see demo.mjs); the
# demo makes its own guest workspace with the sample files.
set -euo pipefail
cd "$(dirname "$0")/../.."
export ATRIUM_DATA_DIR=${ATRIUM_DATA_DIR:-$PWD/docs/video/build/data}
rm -rf "$ATRIUM_DATA_DIR"
mkdir -p "$ATRIUM_DATA_DIR"
echo "reset $ATRIUM_DATA_DIR"
