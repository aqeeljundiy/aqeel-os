#!/bin/bash
# Runs ON THE BOX: an engine update, simulated (ENG-3, 11 Nov 2026). Two throwaway copies under /tmp, each with HOME
# pointed at its own folder, get every step of scripts/apply-skill-patches.mjs (the version being deployed):
#   update  a clean copy of the live engine's commit (git archive): what an engine update would give
#   live    the same plus the live engine's changed, added and removed files: the live engine right after this deploy
# Then every engine file either copy has changed is compared. A file that differs is an engine edit no patch carries:
# the next engine update would drop it. (Comparing with the live engine as it is now would also flag every new patch
# this deploy brings.) Writes only under /tmp; never touches the live engine. About 30-60 s.
#   bash scripts/engine-sim.sh [<aqeelOS folder>]     (default: the folder this script is in)
# Env: ENGINE_LIVE (default ~/.hermes/hermes-agent), ENGINE_SIM_KEEP=1 keeps the throwaway folder for a look.
# Known differences: engine/patches/known-differences.txt (one engine path per line, # for notes).
# Exit 0 = same, 1 = differences (listed), 2 = the simulation could not run.
set -o pipefail
REPO=$(cd "${1:-$(dirname "$0")/..}" && pwd) || exit 2
LIVE=${ENGINE_LIVE:-$HOME/.hermes/hermes-agent}
[ -d "$LIVE/.git" ] || { echo "· engine update check: no engine git copy at $LIVE; skipped"; exit 0; }
S=$(mktemp -d /tmp/aq-engsim.XXXXXX) || exit 2
if [ "${ENGINE_SIM_KEEP:-0}" = 1 ]; then echo "· kept: $S"; else trap 'rm -rf "$S"' EXIT; fi
U=$S/update/.hermes/hermes-agent L=$S/live/.hermes/hermes-agent
SHA=$(git -C "$LIVE" rev-parse HEAD) || exit 2
# ENGINE_SIM_TARGET=<tag or commit> (21 Nov 2026): before an engine update, does every aqeelOS patch step fit THAT version?
# Only the clean copy of the target is made and patched; any MISFIT fails (exit 1) and the update must not run. On 20 Nov an
# "Update tonight" moved P&P to v0.23.3, where 10 of our engine patches no longer applied, and every deploy failed after it.
TARGET=${ENGINE_SIM_TARGET:-}
if [ -n "$TARGET" ]; then SHA=$(git -C "$LIVE" rev-parse --verify -q "$TARGET^{commit}") || { echo "✗ engine patch check: $TARGET is not in the engine's git copy (fetch its tags first)"; exit 2; }; fi
mkdir -p "$U" && git -C "$LIVE" archive "$SHA" | tar -x -C "$U" || { echo "✗ engine update check: could not copy the engine's commit"; exit 2; }
git -C "$U" init -q || exit 2   # the patch steps apply with git, and only where there is a .git
if [ -z "$TARGET" ]; then
# the live engine's own changes, as git sees them (ignored files aside)
git -C "$LIVE" --no-optional-locks status --porcelain=v1 -z --untracked-files=all --no-renames | tr '\0' '\n' | grep -E '^.. ' > "$S/status"
mkdir -p "$S/live/.hermes" && cp -a "$U" "$L" || exit 2
(cd "$LIVE" && { grep -vE '^( D|D )' "$S/status" || true; } | cut -c4- | tar -c --no-recursion -T - 2>/dev/null) | tar -x -C "$L" || { echo "✗ engine update check: could not copy the live engine's changes"; exit 2; }
grep -E '^( D|D )' "$S/status" | cut -c4- | while IFS= read -r f; do rm -f "$L/$f"; done
else mkdir -p "$S/live/.hermes"; : > "$S/status"; fi
for h in "$S/update/.hermes" "$S/live/.hermes"; do mkdir -p "$h/skills" "$h/installs" "$h/profiles"
 # the engine's own Python (rename-engine.py tokenizes with it, and tokenizers differ between versions): only its
 # interpreter is linked, so the steps that update packages in an engine environment find none and change nothing real
 for py in "$HOME"/.hermes/installs/*/environments/*/venv/bin/python; do [ -e "$py" ] || continue
  r=${py#$HOME/.hermes/}; mkdir -p "$h/$(dirname "$r")"; ln -s "$(readlink -f "$py")" "$h/$r"; done; done
touch "$S/start"; sleep 1
# the address the steps write into skills: the real install's, read before HOME changes
PUB=${PUBLIC_URL:-$(cd "$REPO" && node -e "import('./app/install.mjs').then(m=>console.log(m.publicUrl()))" 2>/dev/null)}
steps(){ HOME=$S/$1 PUBLIC_URL=$PUB timeout 600 node "$REPO/scripts/apply-skill-patches.mjs" > "$S/$1.log" 2>&1; }
if [ -n "$TARGET" ]; then steps update; ru=$?
 m=$(grep -h '^MISFIT ' "$S/update.log" 2>/dev/null | sort -u | sed 's/^MISFIT //')
 if [ -n "$m" ]; then echo "✗ engine patch check: $(printf '%s\n' "$m" | wc -l | tr -d ' ') aqeelOS engine change(s) do not fit $TARGET (${SHA:0:8}) yet:"; printf '%s\n' "$m" | sed 's/^/  /'; exit 1; fi
 { [ $ru = 0 ] || [ $ru = 3 ]; } || { echo "✗ engine patch check: the patch steps failed on $TARGET:"; tail -5 "$S/update.log"; exit 2; }
 echo "✓ engine patch check: every aqeelOS engine change fits $TARGET (${SHA:0:8})"; exit 0; fi
steps update & a=$!; steps live; rl=$?; wait $a; ru=$?
grep -h '^MISFIT ' "$S/update.log" "$S/live.log" 2>/dev/null | sort -u | sed 's/^/  ! /'
{ [ $ru = 0 ] || [ $ru = 3 ]; } && { [ $rl = 0 ] || [ $rl = 3 ]; } || { echo "✗ engine update check: the patch steps failed:"; tail -5 "$S/update.log" "$S/live.log"; exit 2; }
# the files to compare: every file the live engine changed, added or removed, and every file the steps wrote in either copy
skip='(^|/)(__pycache__|node_modules|\.git)/|\.(pyc|orig|rej|bak[^/]*|aq\.tmp)$|\.aq-[0-9]+-'
{ cut -c4- "$S/status"; for d in "$U" "$L"; do (cd "$d" && find . -type f -newer "$S/start" ! -path './.git/*' | sed 's#^\./##'); done; } | grep -vE "$skip" | sort -u > "$S/files"
known=$(grep -vE '^\s*(#|$)' "$REPO/engine/patches/known-differences.txt" 2>/dev/null | sed 's/\s*#.*//;s/\s*$//')
bad=(); okn=0; kn=()
while IFS= read -r f; do [ -n "$f" ] || continue
 if { [ ! -e "$U/$f" ] && [ ! -e "$L/$f" ]; } || cmp -s "$U/$f" "$L/$f" 2>/dev/null; then okn=$((okn+1)); continue; fi
 if printf '%s\n' "$known" | grep -qxF "$f"; then kn+=("$f"); else bad+=("$f"); fi
done < "$S/files"
if [ ${#bad[@]} -gt 0 ]; then
 echo "✗ engine update check: after a clean engine update and every patch step, ${#bad[@]} engine file(s) would differ from the live engine after this deploy (${SHA:0:8}). The next engine update would drop these edits; put them in engine/patches (see its README):"
 printf '  %s\n' "${bad[@]}" | head -40; [ ${#bad[@]} -gt 40 ] && echo "  … and $(( ${#bad[@]} - 40 )) more"
 exit 1; fi
echo "✓ engine update check: a clean update of ${SHA:0:8} plus the patch steps gives the live engine ($okn changed file(s) match$([ ${#kn[@]} -gt 0 ] && echo ", known: ${kn[*]}"))"
exit 0
