#!/bin/bash
# Starts AdsPower's official Local API MCP server for an agent.
# The API key comes from the copy's own settings (ADSPOWER_API_KEY in its MCP env) when given, so several
# copies can use different AdsPower accounts; otherwise from the agent's .env, then ~/.hermes/.env.
# It never sits in a config file in plain sight.
export PORT="${ADSPOWER_PORT:-50325}"
key_from(){ [ -f "$1" ] && grep '^ADSPOWER_API_KEY=' "$1" | cut -d= -f2- | sed "s/^[\"']//; s/[\"']$//"; }
KEY="${ADSPOWER_API_KEY:-}"
[ -z "$KEY" ] && [ -n "$HERMES_HOME" ] && KEY="$(key_from "$HERMES_HOME/.env")"
[ -z "$KEY" ] && KEY="$(key_from "$HOME/.hermes/profiles/facebook-manager/.env")"
[ -z "$KEY" ] && KEY="$(key_from "$HOME/.hermes/.env")"
export API_KEY="$KEY"
exec npx -y local-api-mcp-typescript
