#!/bin/bash
# Daily refresh: rebuild the wiki from the glossary Sheet and push if anything changed.
# Run by the launchd agent com.chaivision.glossary-wiki, or manually: ./update.sh
set -euo pipefail

# Binaries needed by cron/launchd (which start with a bare PATH).
export PATH="/opt/homebrew/opt/node@24/bin:/usr/local/bin:/opt/homebrew/bin:/Users/apple/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")"
LOG="update.log"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') refresh start ===" >> "$LOG"

if node build.mjs >> "$LOG" 2>&1; then
  git add -A docs
  if git diff --cached --quiet; then
    echo "no changes" >> "$LOG"
  else
    git -c user.name="Tehsin" -c user.email="tehsin@lifeprofitness.com" \
      commit -q -m "chore: daily glossary refresh $(date '+%Y-%m-%d')" >> "$LOG" 2>&1
    git push origin main >> "$LOG" 2>&1
    echo "pushed update" >> "$LOG"
  fi
else
  echo "BUILD FAILED — see above (Sheet/keychain access?)" >> "$LOG"
  exit 1
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') refresh done ===" >> "$LOG"
