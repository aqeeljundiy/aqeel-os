#!/bin/sh
# posting-guard for shell scripts: the same commands as posting-guard.py (check, sending, record, cancel, act, peek), see its header.
#   T=$(posting-guard.sh check comment) || exit $?      # exit 7 = refused by the limits (reason on stderr), 8 = aqeelOS did not answer
#   posting-guard.sh sending "$T"                       # right before the action
#   posting-guard.sh record comment "$URL" --ticket "$T"
D=$(cd "$(dirname "$0")" && pwd)
P=python3; command -v python3 >/dev/null 2>&1 || P=python
exec "$P" "$D/posting-guard.py" "$@"
