#!/usr/bin/env bash
# serve-dsh-web.sh — run `dsh web` in a detached, SSH-drop-proof session.
#
# Usage:  ./scripts/serve-dsh-web.sh [dsh web flags...]
#   e.g.   ./scripts/serve-dsh-web.sh --host 192.168.1.102 --trusted-host 192.168.1.102 --allow-privileged-remote
#
# Detects the OS and the best available keep-alive mechanism (tmux, then
# screen, then nohup) and launches the web server detached, so it survives
# SSH drops. Reattach later with the printed command; the browser GUI
# reconnects automatically once the server is back, and sessions resume
# from their durable logs.
set -euo pipefail

# --- 1. OS detection ------------------------------------------------------
case "$(uname -s)" in
  Linux*) OS_NAME="Linux" ;;
  Darwin*) OS_NAME="macOS" ;;
  *) OS_NAME="$(uname -s)" ;;
esac

# --- 2. resolve the harness checkout (this script lives in <repo>/scripts) --
HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- 3. build the launch command with fully quoted args --------------------
ARGS=""
for arg in "$@"; do
  ARGS+=" $(printf '%q' "$arg")"
done
SESSION="dsh-web"
LAUNCH="cd $(printf '%q' "$HARNESS_ROOT") && exec pnpm dsh --profile web$ARGS"

# --- 4. pick the keep-alive mechanism and launch detached ------------------
if command -v tmux >/dev/null 2>&1; then
  MECH="tmux"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "dsh web is already running in a tmux session — attaching."
    exec tmux attach -t "$SESSION"
  fi
  tmux new-session -d -s "$SESSION" "bash -lc $(printf '%q' "$LAUNCH")"
  REATTACH="tmux attach -t $SESSION"
elif command -v screen >/dev/null 2>&1; then
  MECH="screen"
  screen -dmS "$SESSION" bash -lc "$LAUNCH"
  REATTACH="screen -r $SESSION"
else
  MECH="nohup"
  nohup bash -lc "$LAUNCH" >"$HARNESS_ROOT/dsh-web.log" 2>&1 &
  REATTACH="(logs at $HARNESS_ROOT/dsh-web.log; no interactive reattach)"
fi

echo "OS: $OS_NAME — dsh web launched under $MECH (session: $SESSION)"
echo "Reattach: $REATTACH"
echo "The server survives SSH drops; the browser GUI reconnects automatically,"
echo "and sessions resume from their durable logs when the server is back."
