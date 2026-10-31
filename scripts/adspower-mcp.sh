#!/bin/bash
# Starts AdsPower's official Local API MCP server for an agent.
# Each agent has its own AdsPower on its own screen (app/agent-adspower.mjs, 1 Nov 2026): its tool's env names the agent
# (ADSPOWER_AGENT) and its copy's port (ADSPOWER_PORT), and the API key comes only from that agent's own .env
# (ADSPOWER_API_KEY, set by the owner), never another agent's. Without ADSPOWER_AGENT (an older setup) the key comes from
# the MCP env, the agent's .env, then ~/.hermes/.env. It never sits in a config file in plain sight.
# A guard in front answers plainly while that AdsPower is not signed in yet.
export PORT="${ADSPOWER_PORT:-50325}"
key_from(){ [ -f "$1" ] && grep '^ADSPOWER_API_KEY=' "$1" | cut -d= -f2- | sed "s/^[\"']//; s/[\"']$//"; }
KEY="${ADSPOWER_API_KEY:-}"
if [ -n "${ADSPOWER_AGENT:-}" ]; then
  H="$(getent passwd "$(id -u)" | cut -d: -f6)"; H="${H:-$HOME}"   # the box user's own home, whatever HOME the engine gives the tool
  case "$ADSPOWER_AGENT" in default) ENVF="$H/.hermes/.env" ;; *[!a-z0-9_-]*) ENVF="" ;; *) ENVF="$H/.hermes/profiles/$ADSPOWER_AGENT/.env" ;; esac
  [ -z "$KEY" ] && [ -n "$ENVF" ] && KEY="$(key_from "$ENVF")"
else
  [ -z "$KEY" ] && [ -n "$HERMES_HOME" ] && KEY="$(key_from "$HERMES_HOME/.env")"
  [ -z "$KEY" ] && KEY="$(key_from "$HOME/.hermes/profiles/facebook-manager/.env")"
  [ -z "$KEY" ] && KEY="$(key_from "$HOME/.hermes/.env")"
fi
export API_KEY="$KEY"
exec node "$(dirname "$0")/adspower-mcp-guard.mjs" npx -y local-api-mcp-typescript
