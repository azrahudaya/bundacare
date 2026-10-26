#!/usr/bin/env bash
# =============================================================================
# scripts/pull-backup.sh
# Tarik backup database dan sesi WhatsApp dari VPS Bundacare ke mesin lokal.
#
# Pemakaian:
#   bash scripts/pull-backup.sh        # tarik semua database + sesi terbaru
#   bash scripts/pull-backup.sh --all  # tarik seluruh arsip sesi lama
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/data/backups"
HOST="43.157.241.188"
USER="ubuntu"
KEY="$HOME/.ssh/bundacare_vps.pem"

mkdir -p "$DEST"

echo "Menarik backup database dari $USER@$HOST:/opt/bundacare/data/backups/ ..."
rsync -avz -e "ssh -i $KEY -o IdentitiesOnly=yes" \
  --include="bundacare-*.db" \
  --exclude="bundacare-session-*" \
  "$USER@$HOST:/opt/bundacare/data/backups/" \
  "$DEST/"

if [[ "${1:-}" == "--all" ]]; then
  echo "Menarik seluruh arsip sesi WhatsApp..."
  rsync -avz -e "ssh -i $KEY -o IdentitiesOnly=yes" \
    "$USER@$HOST:/opt/bundacare/data/backups/bundacare-session-*" \
    "$DEST/"
else
  echo "Menarik arsip sesi WhatsApp terbaru..."
  LATEST_SESSION=$(ssh -i "$KEY" -o IdentitiesOnly=yes "$USER@$HOST" 'ls -t /opt/bundacare/data/backups/bundacare-session-*.tar.gz.gpg 2>/dev/null | head -n 1' || true)
  if [[ -n "$LATEST_SESSION" ]]; then
    rsync -avz -e "ssh -i $KEY -o IdentitiesOnly=yes" \
      "$USER@$HOST:$LATEST_SESSION" \
      "$DEST/"
  fi
fi

echo "Sinkronisasi selesai. Arsip lokal di: $DEST"
ls -lh "$DEST" | tail -n 10
