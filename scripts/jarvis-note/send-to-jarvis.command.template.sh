#!/bin/bash
#
# "Send to JARVIS" — Raycast Script Command TEMPLATE (explicit capture trigger).
#
# Install: copy to a Raycast script-commands directory, fill the two paths + the
# secrets source below, make it executable (chmod +x), then add the folder in
# Raycast → Extensions → Script Commands. Running it does ONE capture (read the
# JARVIS note → diff → upload). It performs NO Raycast writes.
#
# Required Raycast Script Command metadata:
# @raycast.schemaVersion 1
# @raycast.title Send to JARVIS
# @raycast.mode compact
# @raycast.packageName JARVIS
# @raycast.icon 🤖
#
# Optional:
# @raycast.description Read the JARVIS note and send it to the cloud JARVIS app.
# @raycast.author David

set -euo pipefail

# Where this repo lives on the operator's Mac.
REPO="__JARVIS_REPO__"   # e.g. /Users/david/Developer/JARVIS

# Source the operator secret + app url WITHOUT committing them. Keep this file
# gitignored / outside the repo. It must export JARVIS_APP_URL and RAYCAST_INGEST_SECRET.
# shellcheck source=/dev/null
source "__SECRETS_ENV_FILE__"   # e.g. ~/.jarvis/daemon.env

exec python3 "$REPO/scripts/jarvis-note/daemon.py" capture
