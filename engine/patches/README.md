Engine (Hermes Agent) changes made on the reference install on 6 Nov 2026 that `scripts/apply-skill-patches.mjs` (step 16) now applies on install and after engine updates: per-chat SSH ControlMaster sockets (tools/environments/ssh.py), configurable
persona branding (hermes_cli/branding.py, used by default_soul.py and prompt_builder.py), turn_finalizer fallback
notice, and matching tests. Apply to a Hermes Agent checkout with `git apply 2026-11-06-tonight.patch` and copy
`branding.py` to `hermes_cli/`. Verified with the engine's pytest: 180 passed, 0 related failures.

## 2026-11-06-shared-skills.patch (applied by step 17)

Skills for everyone. Every agent also reads the main profile's `skills/` folder (installed once) as its
lowest-precedence tier. Which shared skills an agent may see is data: `<HERMES_HOME>/skills-scope.json`

```json
{"skills": {"productivity/my-private-skill": ["default"], "creative/brand-kit": ["default", "shop-agent"]}}
```

Listed skills are visible only to the listed agents; unlisted skills are universal. No scope file = no shared
tier (fails closed, nothing private leaks). An agent's own copy always wins over the shared one, and
`skill_manage` on a shared skill first copies it into the agent's own `skills/` (copy-on-write), so the shared
skill is never changed by another agent. `skills.shared: false` in an agent's config turns the tier off.
Tests: `tests/agent/test_shared_skills.py`.
