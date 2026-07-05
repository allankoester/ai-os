#!/usr/bin/env bash
# Steadymade AI OS — local backup and restore (Stage 1 quality gate)
#
# Backs up the data that git does NOT protect: personal knowledge, inbox,
# run logs and the interface sidecar metadata. Company knowledge is covered
# by git, but is included as well so one archive restores a full working state.
#
# Usage:
#   scripts/backup.sh backup                    create backups/ai-os-backup-<timestamp>.tar.gz
#   scripts/backup.sh restore <archive.tar.gz>  restore an archive over the current state
#   scripts/backup.sh list                      list existing backups
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$APP_ROOT/backups"
TARGETS=(knowledge runs interface/meta.json)

cmd="${1:-backup}"

case "$cmd" in
  backup)
    mkdir -p "$BACKUP_DIR"
    stamp="$(date +%Y%m%d-%H%M%S)"
    archive="$BACKUP_DIR/ai-os-backup-$stamp.tar.gz"
    existing=()
    for t in "${TARGETS[@]}"; do
      [ -e "$APP_ROOT/$t" ] && existing+=("$t")
    done
    tar -czf "$archive" -C "$APP_ROOT" "${existing[@]}"
    echo "Backup written: $archive"
    tar -tzf "$archive" | wc -l | xargs echo "Files in archive:"
    ;;
  restore)
    archive="${2:-}"
    if [ -z "$archive" ] || [ ! -f "$archive" ]; then
      echo "Usage: scripts/backup.sh restore <archive.tar.gz>" >&2
      exit 1
    fi
    echo "Restoring $archive into $APP_ROOT ..."
    echo "Existing files with the same paths will be overwritten."
    read -r -p "Continue? [y/N] " answer
    case "$answer" in
      y|Y) tar -xzf "$archive" -C "$APP_ROOT"; echo "Restore complete." ;;
      *)   echo "Aborted."; exit 1 ;;
    esac
    ;;
  list)
    ls -lh "$BACKUP_DIR"/ai-os-backup-*.tar.gz 2>/dev/null || echo "No backups yet."
    ;;
  *)
    echo "Unknown command: $cmd (use backup | restore | list)" >&2
    exit 1
    ;;
esac
