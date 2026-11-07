#!/bin/bash
# Runs as root inside the AI box, started by the box's startup (the ai-box compose in Dokploy). It sends everything the
# box starts itself (agents' browsing, AI model calls, channels, downloads) out through the owner's Nord dedicated IP,
# while anything that comes in (aqeelOS's address, SSH on 2222, Dokploy) keeps answering on the box's normal connection.
#  - on/off and settings: ~/.aqeelos-vpn (server=<host> and user=<Nord service username>); no file = off.
#    The service password is the secret Dora saved: <home>/workspaces/<main agent>/.secrets/NORD_PASSWORD.
#  - if Nord drops, OpenVPN's routes go away and the box keeps working on its normal IP (no kill switch, by choice).
#  - safety net: after a first connect the VPN switches itself off again unless ~/.aqeelos-vpn-ok appears
#    within 10 minutes (made once someone checked the box is still reachable), so a bad setup can't lock anyone out.
# Status for aqeelOS: ~/.aqeelos-vpn-status (one line: state, then the public IP when known).
set -u
HOMEC=${AQEELOS_HOME:-$HOME}
CONF=${NORD_VPN_CONF:-$HOMEC/.aqeelos-vpn}
OK=$HOMEC/.aqeelos-vpn-ok
STATUS=$HOMEC/.aqeelos-vpn-status
PW=${NORD_PASSWORD_FILE:-$HOMEC/workspaces/default/.secrets/NORD_PASSWORD}
DIR=/etc/aq-vpn
mkdir -p "$DIR"; chmod 700 "$DIR"

say(){ echo "$1" > "$STATUS"; chown claude:claude "$STATUS" 2>/dev/null; chmod 644 "$STATUS"; echo "nord-vpn: $1" >&2; }
val(){ grep -m1 "^$1=" "$CONF" 2>/dev/null | cut -d= -f2- | tr -d '\r '; }

# replies to connections that came in on a normal interface leave the same way (marked, looked up in table 100)
inbound_stays(){
  local gw dev; gw=$(ip -4 route show default | awk '/default/{print $3; exit}'); dev=$(ip -4 route show default | awk '/default/{print $5; exit}')
  [ -n "$gw" ] && [ -n "$dev" ] || return 1
  # table 100: the normal default route plus every directly connected network (Dokploy's proxy answers on its own one)
  ip route flush table 100 2>/dev/null; ip -4 route show table main | grep -v "^default" | while read -r r; do ip route replace $r table 100 2>/dev/null; done
  ip route replace default via "$gw" dev "$dev" table 100
  ip rule del fwmark 0x1 lookup 100 2>/dev/null; ip rule add fwmark 0x1 lookup 100 priority 100
  iptables -t mangle -C PREROUTING ! -i tun+ -m conntrack --ctstate NEW -j CONNMARK --set-mark 0x1 2>/dev/null || iptables -t mangle -A PREROUTING ! -i tun+ -m conntrack --ctstate NEW -j CONNMARK --set-mark 0x1
  iptables -t mangle -C OUTPUT -j CONNMARK --restore-mark 2>/dev/null || iptables -t mangle -A OUTPUT -j CONNMARK --restore-mark
}

prepare(){
  local server user; server=$(val server); user=$(val user)
  [[ "$server" =~ ^[a-z]{2}[0-9]+\.nordvpn\.com$ ]] || { say "off: no valid server in $CONF"; return 1; }
  [ -n "$user" ] || { say "off: no user in $CONF"; return 1; }
  [ -s "$PW" ] || { say "off: the Nord password is not saved yet"; return 1; }
  if [ ! -s "$DIR/$server.ovpn" ]; then curl -fsS --max-time 30 -o "$DIR/$server.ovpn.tmp" "https://downloads.nordcdn.com/configs/files/ovpn_udp/servers/$server.udp.ovpn" && mv "$DIR/$server.ovpn.tmp" "$DIR/$server.ovpn" || { say "off: could not download the settings for $server"; return 1; }; fi
  # the password goes from Dora's saved secret into a root-only file OpenVPN reads; it is never printed
  umask 077; { printf '%s\n' "$user"; head -c 4096 "$PW" | tr -d '\r\n'; printf '\n'; } > "$DIR/auth"
  echo "$server"
}

check_ip(){ curl -fsS --max-time 15 https://api.ipify.org 2>/dev/null || true; }

run_once(){
  local server; server=$(prepare) || return 1
  inbound_stays || { say "off: could not keep incoming connections on the normal route"; return 1; }
  say "connecting to $server"
  openvpn --config "$DIR/$server.ovpn" --auth-user-pass "$DIR/auth" --auth-nocache --dev tun0 --persist-key \
    --ping 10 --ping-restart 60 --connect-retry 5 30 --verb 2 --writepid /run/aq-openvpn.pid >> /var/log/aq-openvpn.log 2>&1 &
  local pid=$! ip=""
  for i in $(seq 1 30); do sleep 2; kill -0 "$pid" 2>/dev/null || break; ip link show tun0 >/dev/null 2>&1 && { ip=$(check_ip); [ -n "$ip" ] && break; }; done
  if ! kill -0 "$pid" 2>/dev/null; then say "off: Nord did not connect (see /var/log/aq-openvpn.log)"; return 1; fi
  say "on $server ${ip:-checking}"
  # removing the settings file switches it off while connected
  ( while kill -0 "$pid" 2>/dev/null; do [ -f "$CONF" ] || kill "$pid" 2>/dev/null; sleep 10; done ) &
  # safety net on the very first connect: switch off again unless someone confirms the box is still reachable
  if [ ! -f "$OK" ]; then
    for i in $(seq 1 60); do sleep 10; [ -f "$OK" ] && break; done
    if [ ! -f "$OK" ]; then kill "$pid" 2>/dev/null; mv -f "$CONF" "$CONF.paused" 2>/dev/null; say "off: not confirmed within 10 minutes, switched off again (settings kept in $CONF.paused)"; return 1; fi
  fi
  wait "$pid"; say "dropped: back on the normal connection, reconnecting"; return 0
}

# stay on while the settings file exists; checked every 20 s so it can be switched on or off without a restart
while true; do
  if [ -f "$CONF" ]; then run_once || sleep 30; else say "off"; sleep 20; fi
  sleep 5
done
