#!/usr/bin/env bash
# dev.sh — run and inspect the Order Tracker backend (ASP.NET Core) and frontend (Angular).
#
#   ./dev.sh                      interactive: start both, stream logs, Ctrl+C stops everything
#   ./dev.sh start   [svc...]     start in the background (default: both)
#   ./dev.sh stop    [svc...]     stop background services
#   ./dev.sh restart [svc...]
#   ./dev.sh status               what is running, on which port, with health checks
#   ./dev.sh logs    [svc] [-f]   show (or follow) logs; no svc = both, interleaved
#   ./dev.sh errors  [svc] [-n N] only error / warning / exception lines from the logs
#   ./dev.sh test    [backend|frontend|e2e|all]
#   ./dev.sh seed    [N]          add N realistic demo orders to the dev database (default 200)
#   ./dev.sh clean                remove logs, pid files and the dev SQLite database
#
# svc is "backend" or "frontend". Logs and pid files live in .dev/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="$ROOT/.dev"
BACKEND_DIR="$ROOT/backend"
API_PROJECT="$BACKEND_DIR/src/OrderTracker.Api"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_PORT="${BACKEND_PORT:-5080}"
FRONTEND_PORT="${FRONTEND_PORT:-4200}"
SERVICES=(backend frontend)

mkdir -p "$DEV_DIR"

# ---------- colours ----------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[34m'; C_MAGENTA=$'\e[35m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_MAGENTA=''
fi
color_for() { [[ "$1" == backend ]] && printf '%s' "$C_BLUE" || printf '%s' "$C_MAGENTA"; }
info() { printf '%s▸%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%s✘%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ---------- node selection ----------
# Angular 22 needs Node ^22.22 || ^24.15 || >=26. nvm defaults on this machine may point at an
# unsupported version, so prefer a supported one automatically.
node_ok() {
  local v; v="$("$1" --version 2>/dev/null | sed 's/^v//')" || return 1
  local major="${v%%.*}" rest="${v#*.}" minor; minor="${rest%%.*}"
  (( major >= 26 )) || (( major == 24 && minor >= 15 )) || (( major == 22 && minor >= 22 ))
}
pick_node_path() {
  if command -v node >/dev/null && node_ok "$(command -v node)"; then
    printf '%s' "$PATH"; return
  fi
  for candidate in /usr/bin /usr/local/bin "$HOME"/.nvm/versions/node/*/bin; do
    if [[ -x "$candidate/node" ]] && node_ok "$candidate/node"; then
      printf '%s:%s' "$candidate" "$PATH"; return
    fi
  done
  warn "no supported Node version found (need 22.22+, 24.15+ or 26+); using default $(node --version 2>/dev/null || echo none)"
  printf '%s' "$PATH"
}
NODE_PATH_PREFIX="$(pick_node_path)"

# ---------- helpers ----------
pid_file() { printf '%s/%s.pid' "$DEV_DIR" "$1"; }
log_file() { printf '%s/%s.log' "$DEV_DIR" "$1"; }
port_of()  { [[ "$1" == backend ]] && printf '%s' "$BACKEND_PORT" || printf '%s' "$FRONTEND_PORT"; }
url_of()   { printf 'http://localhost:%s' "$(port_of "$1")"; }

# Send a signal to a process and all of its descendants (dotnet run → app, npx → ng → esbuild).
kill_tree() { # pid signal
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child" "$2"; done
  kill "-$2" "$1" 2>/dev/null || true
}
tree_alive() { # pid → success if the pid or any descendant is still alive
  kill -0 "$1" 2>/dev/null && return 0
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do tree_alive "$child" && return 0; done
  return 1
}

# PID of the service if it is running (process group leader), else nothing.
running_pid() {
  local f; f="$(pid_file "$1")"
  [[ -f "$f" ]] || return 1
  local pid; pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then printf '%s' "$pid"; else rm -f "$f"; return 1; fi
}

port_listener_pid() {
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true
}

validate_services() {
  local s
  for s in "$@"; do
    case "$s" in backend|frontend) ;; *) die "unknown service '$s' (expected backend or frontend)";; esac
  done
}

wait_for_url() { # url, seconds
  local i
  for ((i = 0; i < $2 * 2; i++)); do
    curl -sf -o /dev/null -m 2 "$1" && return 0
    sleep 0.5
  done
  return 1
}

start_one() {
  local svc="$1" pid
  if pid="$(running_pid "$svc")"; then
    ok "$svc already running (pid $pid) → $(url_of "$svc")"; return 0
  fi
  local busy; busy="$(port_listener_pid "$(port_of "$svc")")"
  if [[ -n "$busy" ]]; then
    die "$svc port $(port_of "$svc") is already in use by pid $busy (not started by dev.sh). Stop it or set ${svc^^}_PORT."
  fi

  local log; log="$(log_file "$svc")"
  : > "$log"
  info "starting $svc → $(url_of "$svc")  (log: ${log#"$ROOT"/})"
  local pidf; pidf="$(pid_file "$svc")"; rm -f "$pidf"
  # setsid puts the child in its own session/process group so stopping it can never touch this
  # shell. The child writes its OWN pid (== its pgid) — `$!` would be wrong if setsid forks.
  # The whole background subshell is detached from our stdio (so `./dev.sh start | grep` gets EOF)
  # and execs straight into setsid, leaving no middleman process behind.
  case "$svc" in
    backend)
      ( cd "$API_PROJECT" && exec env ASPNETCORE_URLS="http://localhost:$BACKEND_PORT" ASPNETCORE_ENVIRONMENT=Development \
          setsid bash -c 'echo $$ > "$1"; exec dotnet run --no-launch-profile' _ "$pidf" ) >"$log" 2>&1 < /dev/null &
      ;;
    frontend)
      ( cd "$FRONTEND_DIR" && exec env PATH="$NODE_PATH_PREFIX" \
          setsid bash -c 'echo $$ > "$1"; exec npx ng serve --port "$2" --no-open' _ "$pidf" "$FRONTEND_PORT" ) >"$log" 2>&1 < /dev/null &
      ;;
  esac
  local i
  for ((i = 0; i < 50; i++)); do [[ -s "$pidf" ]] && break; sleep 0.1; done
  [[ -s "$pidf" ]] || { warn "$svc did not start (no pid recorded)"; return 1; }

  local health; [[ "$svc" == backend ]] && health="$(url_of backend)/health" || health="$(url_of frontend)"
  if wait_for_url "$health" 120; then
    ok "$svc is up (pid $(cat "$(pid_file "$svc")"))"
  else
    warn "$svc did not answer on $health within 120s — last log lines:"
    tail -n 15 "$log" | sed "s/^/    /"
    return 1
  fi
}

stop_one() {
  local svc="$1" pid
  if ! pid="$(running_pid "$svc")"; then
    # Maybe something else holds the port from a previous crashed run.
    local busy; busy="$(port_listener_pid "$(port_of "$svc")")"
    if [[ -n "$busy" ]]; then warn "$svc not tracked by dev.sh but port $(port_of "$svc") is held by pid $busy"; fi
    info "$svc is not running"; return 0
  fi
  info "stopping $svc (pid $pid)"
  local pgid; pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  local own_pgid; own_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
  if [[ -n "$pgid" && "$pgid" != "$own_pgid" && "$pgid" != "1" ]]; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  else
    kill_tree "$pid" TERM
  fi
  local i
  for ((i = 0; i < 20; i++)); do tree_alive "$pid" || break; sleep 0.25; done
  if tree_alive "$pid"; then
    if [[ -n "$pgid" && "$pgid" != "$own_pgid" && "$pgid" != "1" ]]; then kill -KILL -- "-$pgid" 2>/dev/null || true; fi
    kill_tree "$pid" KILL
  fi
  # Anything still holding the port that belongs to the same process group.
  local listener; listener="$(port_listener_pid "$(port_of "$svc")")"
  if [[ -n "$listener" && -n "$pgid" && "$(ps -o pgid= -p "$listener" 2>/dev/null | tr -d ' ')" == "$pgid" ]]; then
    kill -KILL "$listener" 2>/dev/null || true
  fi
  rm -f "$(pid_file "$svc")"
  ok "$svc stopped"
}

status_line() {
  local svc="$1" pid state health col; col="$(color_for "$svc")"
  if pid="$(running_pid "$svc")"; then
    state="${C_GREEN}running${C_RESET}  pid $pid"
  else
    state="${C_DIM}stopped${C_RESET}"
    local busy; busy="$(port_listener_pid "$(port_of "$svc")")"
    [[ -n "$busy" ]] && state="${C_YELLOW}port busy${C_RESET} (pid $busy, not ours)"
  fi
  local target; [[ "$svc" == backend ]] && target="$(url_of backend)/health" || target="$(url_of frontend)"
  if curl -sf -o /dev/null -m 2 "$target"; then health="${C_GREEN}healthy${C_RESET}"; else health="${C_RED}no response${C_RESET}"; fi
  printf '  %s%-9s%s %-28b %s  %s%s%s\n' "$col" "$svc" "$C_RESET" "$state" "$health" "$C_DIM" "$(url_of "$svc")" "$C_RESET"
}

cmd_status() {
  printf '%sOrder Tracker — dev status%s\n' "$C_BOLD" "$C_RESET"
  local s
  for s in "${SERVICES[@]}"; do status_line "$s"; done
  local db="$API_PROJECT/orders.db"
  if [[ -f "$db" ]]; then
    local n; n="$(sqlite3 "$db" 'select count(*) from Orders' 2>/dev/null || echo '?')"
    printf '  %-9s %s (%s orders)\n' "database" "${db#"$ROOT"/}" "$n"
  fi
  local s2
  for s2 in "${SERVICES[@]}"; do
    local f; f="$(log_file "$s2")"
    if [[ -s "$f" ]]; then
      local errs; errs="$(count_errors "$f")"
      if (( errs > 0 )); then
        printf '  %s%-9s%s %s%d error line(s)%s in %s — run: ./dev.sh errors %s\n' "$(color_for "$s2")" "$s2" "$C_RESET" "$C_RED" "$errs" "$C_RESET" "${f#"$ROOT"/}" "$s2"
      fi
    fi
  done
}

ERROR_PATTERN='(^|[^a-zA-Z])(fail|error|exception|unhandled|warn|✘|ERR!|EADDRINUSE|NG[0-9]{4}|TS[0-9]{4}|CS[0-9]{4})'
count_errors() { grep -Eic "$ERROR_PATTERN" "$1" 2>/dev/null || true; }

TAIL_PIDS=()
stop_tails() { (( ${#TAIL_PIDS[@]} )) && kill "${TAIL_PIDS[@]}" 2>/dev/null; TAIL_PIDS=(); return 0; }

# Prefix each line with a coloured service tag and highlight error lines.
decorate() { # svc
  local col; col="$(color_for "$1")"
  awk -v tag="$1" -v col="$col" -v red="$C_RED" -v yel="$C_YELLOW" -v rst="$C_RESET" -v pat="$ERROR_PATTERN" '
    {
      line = $0
      if (tolower(line) ~ /(^|[^a-z])(fail|error|exception|unhandled|✘|err!|eaddrinuse|ng[0-9]{4}|ts[0-9]{4}|cs[0-9]{4})/) line = red line rst
      else if (tolower(line) ~ /(^|[^a-z])warn/) line = yel line rst
      printf "%s%-8s%s %s\n", col, tag, rst, line
      fflush()
    }'
}

cmd_logs() {
  local follow=0 svcs=()
  while (( $# )); do
    case "$1" in -f|--follow) follow=1;; *) svcs+=("$1");; esac; shift
  done
  (( ${#svcs[@]} )) || svcs=("${SERVICES[@]}")
  validate_services "${svcs[@]}"
  local s
  if (( follow )); then
    TAIL_PIDS=()
    for s in "${svcs[@]}"; do
      touch "$(log_file "$s")"
      tail -n 40 -F "$(log_file "$s")" 2>/dev/null | decorate "$s" & TAIL_PIDS+=($!)
    done
    # In `up` mode the caller owns the trap (it also has to stop the services).
    (( ${UP_MODE:-0} )) || trap 'stop_tails; exit 0' INT TERM
    wait "${TAIL_PIDS[@]}" 2>/dev/null || true
  else
    for s in "${svcs[@]}"; do
      [[ -s "$(log_file "$s")" ]] || { info "no log for $s yet"; continue; }
      tail -n 60 "$(log_file "$s")" | decorate "$s"
    done
  fi
}

cmd_errors() {
  local n=200 svcs=()
  while (( $# )); do
    case "$1" in -n) n="$2"; shift;; *) svcs+=("$1");; esac; shift
  done
  (( ${#svcs[@]} )) || svcs=("${SERVICES[@]}")
  validate_services "${svcs[@]}"
  local s total=0
  for s in "${svcs[@]}"; do
    local f; f="$(log_file "$s")"
    [[ -s "$f" ]] || continue
    local c; c="$(count_errors "$f")"; total=$((total + c))
    printf '%s── %s: %s error/warning line(s) in %s ──%s\n' "$C_BOLD" "$s" "$c" "${f#"$ROOT"/}" "$C_RESET"
    (( c > 0 )) || continue
    # Show matching lines plus the following stack-trace lines (indented "at ..." for .NET, "    at" for node).
    grep -En -A6 -i "$ERROR_PATTERN" "$f" | tail -n "$n" | decorate "$s"
  done
  (( total == 0 )) && ok "no errors or warnings found in the logs"
  return 0
}

cmd_test() {
  local what="${1:-all}"
  case "$what" in
    backend)  (cd "$BACKEND_DIR" && dotnet test);;
    frontend) (cd "$FRONTEND_DIR" && PATH="$NODE_PATH_PREFIX" npm run test:ci);;
    e2e)
      if running_pid backend >/dev/null || running_pid frontend >/dev/null; then
        die "stop the dev servers first (./dev.sh stop) — Playwright starts its own on the same ports with a fresh database"
      fi
      (cd "$FRONTEND_DIR" && PATH="$NODE_PATH_PREFIX" npm run e2e);;
    all) cmd_test backend && cmd_test frontend && cmd_test e2e;;
    *) die "unknown test target '$what' (backend|frontend|e2e|all)";;
  esac
}

cmd_seed() {
  local n="${1:-200}"
  [[ "$n" =~ ^[0-9]+$ ]] || die "seed count must be a number"
  info "seeding $n demo orders into ${API_PROJECT#"$ROOT"/}/orders.db"
  (cd "$API_PROJECT" && ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile -- --seed "$n" 2>&1 | grep -v "^info:\|^\s*Now listening\|^\s*Application\|^\s*Hosting\|^\s*Content root") || true
  if running_pid backend >/dev/null; then ok "backend is running; refresh the UI to see the new orders"; fi
}

cmd_clean() {
  cmd_stop
  rm -f "$DEV_DIR"/*.log "$DEV_DIR"/*.pid
  rm -f "$API_PROJECT"/orders.db "$API_PROJECT"/orders.db-wal "$API_PROJECT"/orders.db-shm
  ok "removed logs, pid files and the dev database"
}

cmd_start()   { local svcs=("$@"); (( ${#svcs[@]} )) || svcs=("${SERVICES[@]}"); validate_services "${svcs[@]}"; local s rc=0; for s in "${svcs[@]}"; do start_one "$s" || rc=1; done; echo; cmd_status; return $rc; }
cmd_stop()    { local svcs=("$@"); (( ${#svcs[@]} )) || svcs=(frontend backend); validate_services "${svcs[@]}"; local s; for s in "${svcs[@]}"; do stop_one "$s"; done; }
cmd_restart() { cmd_stop "$@"; cmd_start "$@"; }

# Interactive mode: start both, stream logs, tear down on Ctrl+C.
cmd_up() {
  cmd_start || true
  echo
  info "streaming logs — press Ctrl+C to stop both services"
  echo
  UP_MODE=1
  trap 'echo; stop_tails; cmd_stop; exit 0' INT TERM
  cmd_logs -f
  # tails ended without a signal (should not happen) — still shut everything down cleanly.
  cmd_stop
}

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-up}" in
  up)        cmd_up;;
  start)     shift; cmd_start "$@";;
  stop)      shift; cmd_stop "$@";;
  restart)   shift; cmd_restart "$@";;
  status|st) cmd_status;;
  logs|log)  shift; cmd_logs "$@";;
  errors|err) shift; cmd_errors "$@";;
  test)      shift; cmd_test "$@";;
  seed)      shift; cmd_seed "$@";;
  clean)     cmd_clean;;
  -h|--help|help) usage;;
  *) usage; die "unknown command '$1'";;
esac
