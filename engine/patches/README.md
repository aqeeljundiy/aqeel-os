Engine (Hermes Agent) changes made on the reference install on 6 Nov 2026 that `scripts/apply-skill-patches.mjs` (step 16) now applies on install and after engine updates: per-chat SSH ControlMaster sockets (tools/environments/ssh.py), configurable
persona branding (hermes_cli/branding.py, used by default_soul.py and prompt_builder.py), turn_finalizer fallback
notice, and matching tests. Apply to a Hermes Agent checkout with `git apply 2026-11-06-tonight.patch` and copy
`branding.py` to `hermes_cli/`. Verified with the engine's pytest: 180 passed, 0 related failures.
