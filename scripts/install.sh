#!/bin/bash
# aqeelOS installer: the one command a new owner runs, once, from the cloned repo on a Linux server:
#   sudo bash scripts/install.sh            everything below
#   sudo bash scripts/install.sh --agent-users   only the per-agent Linux users (the fix the Agents page shows)
# Options: --open  listen on every address over plain http (to try it by the server's IP before a proxy is in front)
#          --port N  the port aqeelOS listens on (default 4400)
# It never asks you to edit a file. The engine keys are read from ~/.hermes/.env, the sign-in key is made on first
# start, and the address, time zone and hosts are set in the app (System › Settings).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash $0 $*"; exit 1; }
APP=$(cd "$(dirname "$0")/.." && pwd)
OWNER=${AQEELOS_USER:-${SUDO_USER:-$(stat -c %U "$APP")}}
[ "$OWNER" != root ] || { echo "Run it with sudo from your own user (not as root), so aqeelOS runs as you."; exit 1; }
OHOME=$(getent passwd "$OWNER" | cut -d: -f6)
PORT=4400; OPEN=0; ONLY=""
while [ $# -gt 0 ]; do case "$1" in --agent-users) ONLY=agent-users;; --open) OPEN=1;; --port) PORT=$2; shift;; *) echo "Unknown option $1"; exit 1;; esac; shift; done
step(){ printf '\n\033[1m%s\033[0m\n' "$*"; }
ok(){ printf '  ok  %s\n' "$*"; }
warn(){ printf '  !   %s\n' "$*"; }
as_owner(){ sudo -u "$OWNER" -H env HOME="$OHOME" PATH="$OHOME/.local/bin:$PATH" "$@"; }
has_systemd(){ [ -d /run/systemd/system ]; }

agent_users(){
  step "Per-agent Linux users"
  command -v sshd >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server >/dev/null && ok "installed the SSH server"; } || warn "could not install openssh-server"
  install -m 755 -o root -g root "$APP/scripts/agent-users.sh" /usr/local/sbin/aqeelos-agent-users
  if has_systemd; then
    cat > /etc/systemd/system/aqeelos-agent-users.service <<EOF
[Unit]
Description=aqeelOS per-agent Linux users
After=network.target ssh.service
[Service]
Environment=AQEELOS_HOME=$OHOME AQEELOS_USER=$OWNER AQEELOS_APP=$APP
ExecStartPre=/usr/local/sbin/aqeelos-agent-users once
ExecStart=/usr/local/sbin/aqeelos-agent-users watch
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload; systemctl enable --now aqeelos-agent-users.service >/dev/null 2>&1 && systemctl restart aqeelos-agent-users.service
    ok "running as a service (aqeelos-agent-users)"
  else
    # a container without systemd: start it now, and add the same line to the container's start
    AQEELOS_HOME=$OHOME AQEELOS_USER=$OWNER AQEELOS_APP=$APP /usr/local/sbin/aqeelos-agent-users once || true
    AQEELOS_HOME=$OHOME AQEELOS_USER=$OWNER AQEELOS_APP=$APP setsid nohup /usr/local/sbin/aqeelos-agent-users watch >/var/log/aqeelos-agent-users.log 2>&1 < /dev/null &
    ok "started. No systemd here: add this to the container's start command:"
    echo "      AQEELOS_HOME=$OHOME AQEELOS_USER=$OWNER AQEELOS_APP=$APP /usr/local/sbin/aqeelos-agent-users watch &"
  fi
}

if [ "$ONLY" = agent-users ]; then agent_users; echo; echo "Done. The Agents page notices within a minute."; exit 0; fi

step "Checking the server"
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] && ok "Node.js $(node -v)" || { warn "Node.js 22 or newer is needed: https://nodejs.org"; exit 1; }
command -v python3 >/dev/null && ok "Python $(python3 -V | cut -d' ' -f2)" || warn "Python 3.11+ is needed by the engine"
if [ -x "$OHOME/.local/bin/hermes" ] || [ -d "$OHOME/.hermes/hermes-agent" ]; then ok "Hermes Agent engine found"; else warn "Hermes Agent is not installed for $OWNER yet: https://github.com/NousResearch/hermes-agent (aqeelOS starts, but agents need it)"; fi
[ -f "$OHOME/.hermes/.env" ] && grep -q '^API_SERVER_KEY=' "$OHOME/.hermes/.env" && ok "engine keys found in ~/.hermes/.env (read by aqeelOS itself)" || warn "the engine has no API_SERVER_KEY yet: start its gateway once, aqeelOS reads the key by itself after that"

step "The Claude sign-in for the engine"
P=claude-subscription-directsdk-experimental
if [ -f "$OHOME/.hermes/plugins/$P/plugin.yaml" ]; then ok "already there"; else as_owner mkdir -p "$OHOME/.hermes/plugins" && as_owner cp -a "$APP/engine/$P" "$OHOME/.hermes/plugins/$P" && ok "added (turn it on from Models › Install Claude sign-in)"; fi

agent_users

step "The aqeelOS service"
CONF=$OHOME/.config/aqeelos; ENVF=$CONF/aqeelos.env
as_owner mkdir -p "$CONF"; [ -f "$ENVF" ] || { as_owner touch "$ENVF"; chmod 600 "$ENVF"; }
# no password here: a new install asks for the owner account on its first open
HOSTV=127.0.0.1; [ "$OPEN" = 1 ] && HOSTV=0.0.0.0
if has_systemd; then
  cat > /etc/systemd/system/aqeelos.service <<EOF
[Unit]
Description=aqeelOS
After=network.target
[Service]
User=$OWNER
WorkingDirectory=$APP
Environment=AQEELOS_LIVE=1 UI_PORT=$PORT UI_HOST=$HOSTV AQEELOS_HOME=$OHOME $( [ "$OPEN" = 1 ] && echo UI_INSECURE_COOKIE=1 )
EnvironmentFile=-$ENVF
ExecStart=$(command -v node) $APP/app/server.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload; systemctl enable --now aqeelos.service >/dev/null 2>&1 && systemctl restart aqeelos.service; ok "running as a service (aqeelos)"
else
  warn "no systemd: start it yourself under tmux or your container's start:"
  echo "      AQEELOS_LIVE=1 UI_PORT=$PORT UI_HOST=$HOSTV node --env-file=$ENVF $APP/app/server.mjs"
fi

for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
step "Next"
if [ "$OPEN" = 1 ]; then echo "  Open http://<this server's IP>:$PORT and sign in."
else echo "  Put your https proxy (Caddy, Traefik, nginx) in front of 127.0.0.1:$PORT, open that address and sign in."; fi
echo "  A new install first asks you to create the owner account, then for Your address, and checks it. Time zone and hosts are on System › Settings."
