# Contributing

## Where install-specific things go
This repository is public and holds the product: code, tests, general documentation, Built in skills. Everything that belongs to **one install** stays in that install's own data folder, never in git:

- notes about a specific server, agent or customer: `<data>/notes/` (and `docs/installs/`, `*.local.md` if you keep them next to your working copy: both are git-ignored);
- agent prompts, prices, promo codes, schedule conversions and their reports;
- check scripts and the settings they need: `<data>/box-checks/` (for example `wakeup-nudge.json`, `close-stage-due.json`). The deploy never writes or deletes that folder. Generic templates live in `scripts/check-templates/` and read their settings from there;
- server addresses and host names, real phone numbers, chat ids, e-mail addresses, Google sheet or file ids, people's names, keys, tokens.

`<data>` is `$AQEELOS_DATA` / `$UI_DATA_DIR`, by default `~/apps/hermes-ui-data`.

## Test data
Use plainly made-up values: phone `62800000000x`, e-mail `@example.com`, IP `192.0.2.x`, `198.51.100.x`, `203.0.113.x`, Telegram user id `1000000001`, chat id `-1001234567890`. `scripts/repo-privacy.test.mjs` fails on anything that looks real, in every tracked file.

## Before you push
`git config core.hooksPath scripts/hooks` (once per clone) runs the privacy test and a gitleaks scan before each push. Never `git add -A` in a scripted commit: name the paths.
A fixture that has to look like a key (a test of the secret filter) must look fake (`sk-ant-EXAMPLE...`); if gitleaks still flags it, add it to `.gitleaks.toml` by path **and** value. A real credential is never allowed: it is rotated.
