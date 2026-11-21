#!/usr/bin/env bash
# Regression check: starting the app a second time must NOT open a second set of windows.
#
# Bug: nothing stopped a second copy of the app, so any second launch (e.g. two start-at-login
# entries, or Windows restarting apps) produced duplicate widgets and tray icons.
#
# Runs the real built app twice on a virtual display (Linux) and counts processes and windows.
# Needs: Xvfb, xdotool, dbus-run-session, pgrep, and a debug build:
#   (cd src-tauri && cargo build --features tauri/custom-protocol)
# Usage: tests/double-launch.sh [path/to/binary]      exit 0 = pass, 1 = fail, 2 = cannot run
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$ROOT/src-tauri/target/debug/windows-widgets}"

for tool in Xvfb xdotool dbus-run-session pgrep; do
  command -v "$tool" >/dev/null || { echo "cannot run: '$tool' is not installed"; exit 2; }
done
[ -x "$BIN" ] || { echo "cannot run: build the app first ($BIN not found)"; exit 2; }

# Both copies must share one D-Bus session bus, the way two launches in one login session do.
if [ -z "${DOUBLE_LAUNCH_INNER:-}" ]; then
  exec env DOUBLE_LAUNCH_INNER=1 dbus-run-session -- "$0" "$BIN" 2>/dev/null
fi

export DISPLAY=:99 GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1
export HOME="$(mktemp -d)"   # fresh profile, like a first run
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; pkill -f "^$BIN" 2>/dev/null; rm -rf "$HOME"; }
trap cleanup EXIT

Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & PIDS+=($!)
for _ in $(seq 20); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.25; done

visible_windows() { xdotool search --onlyvisible --name '^World Clock$' 2>/dev/null | wc -l; }

"$BIN" >/tmp/double-launch-1.log 2>&1 & FIRST=$!; PIDS+=($FIRST)
for _ in $(seq 80); do [ "$(visible_windows)" -ge 1 ] && break; sleep 0.25; done
[ "$(visible_windows)" -ge 1 ] || { echo "cannot run: the first copy never opened a window (see /tmp/double-launch-1.log)"; exit 2; }
echo "after launch #1: processes=$(pgrep -fc "^$BIN")  visible windows=$(visible_windows)"

"$BIN" >/tmp/double-launch-2.log 2>&1 & SECOND=$!; PIDS+=($SECOND)
for _ in $(seq 40); do kill -0 "$SECOND" 2>/dev/null || break; sleep 0.25; done   # a guarded 2nd copy exits by itself
sleep 1.5
PROCS=$(pgrep -fc "^$BIN"); WINS=$(visible_windows)
echo "after launch #2: processes=$PROCS  visible windows=$WINS"

if [ "$PROCS" -eq 1 ] && [ "$WINS" -eq 1 ]; then echo "PASS: a second launch did not create a second copy"; exit 0; fi
echo "FAIL: a second launch created a duplicate (expected 1 process and 1 window)"; exit 1
