# For an AI assistant working in this repo

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: what runs where, the modules by area, how a request flows, where state lives,
how deploy and undo work, the test and CI gates, and a table "to change X, touch these files, run these tests". Then
[OPERATIONS.md](OPERATIONS.md) (rules for the servers) and [CONTRIBUTING.md](CONTRIBUTING.md) (what never goes in git).

## Working rules of this repo
- **No bare `git stash`.** Several assistants share one machine and many worktrees; a stash is shared state nobody sees. Commit on your own branch, or copy the file.
- **Code only in your own git worktree and branch** (never in someone else's, never on `main`). Small commits; name the paths, never `git add -A`. Never merge to `main` and never deploy yourself: only commits on GitHub `main` go live, and a person decides.
- **Verify UI work in a real browser** before saying it is done: open the page, click it, look at it (flicker, rounded corners, no native `<select>`, same page widths, smooth animation). A passing test is not proof a screen works.
- **Run the tests on Linux** (the box, CI, or a container). On Windows about 78 fail for platform reasons, which hides real failures. Before pushing: `node scripts/premerge-check.mjs` and `node --test scripts/<the tests that name your area>.test.mjs`; CI runs everything.
- **Never commit install-specific data**: names, phone numbers, chat ids, addresses, keys, prices, prompts. Test data is plainly made up (`CONTRIBUTING.md`). Real values live in the install's data folder.
- **The dense style is deliberate**: long lines, few blank lines, why-comments with the date and the incident. Do not reformat, rename files into folders, or "tidy" code you are not changing.
- **Start from the job a screen does** (who uses it, what they want to finish), not from the data shape. Check how the nearest existing page does it and keep to it.
- **Save state through `app/store.mjs`**, resolve an agent's home with `homeOf()`, add every environment variable to `.env.example`. `scripts/debt.test.mjs` fails when these counts go up; it never lets you raise the recorded numbers (`scripts/debt-baseline.json`), only lower them in the commit that removes the debt.
- **Add a test with a change**, one that would fail if the change were undone. A route needs an explicit rights check and an entry in the rights matrix test.
- **Do not edit a test just to make it pass.** Existing tests are judged from `main`'s copy in the fixer gate, and changing the rules a test guards (rights, fixers, sign-in, updates) needs the owner (`.github/CODEOWNERS`, `.github/fixer-gate.json`).
- Keep `docs/ARCHITECTURE.md` true: when you move or rename what it names, change it in the same commit.
