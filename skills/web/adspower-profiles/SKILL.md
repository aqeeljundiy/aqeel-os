---
name: adspower-profiles
description: Use when the person asks you to open or use AdsPower browser profiles. Open and drive them with your AdsPower tool on your own screen.
---

# AdsPower browser profiles

You have your own AdsPower app. It runs on your own screen (the person sees it there), with its own data and its own sign-in. No other agent uses it.

## What you do
- Use your **AdsPower tool** to list, open and close profiles. Each profile opens as its own browser window on your screen, where the person can watch and press **Take over**.
- Once a profile is open, drive that window with your browser tools like any other page. Each profile keeps its own cookies and logins, so check which profile is open before you act.
- Close profiles you opened when the task is done, unless the person wants them left open.

Which profiles belong to which task or account, if the person keeps such a list, is in references/local.md next to this skill (kept on this server, never shared). Example:

```
- Profile "acme-shop-1": store admin for acme.com
- Profile "acme-social": social accounts for Acme
```

## Steps
1. List profiles with the tool and pick the one the person named. If the name is unclear or several match, ask which one.
2. Open it. Tell the person which profile is open on your screen.
3. Check the page and the logged-in account before doing anything in it.
4. Do the task. For logins inside a profile, follow the own-account-login skill: saved secrets only, never passwords in chat.
5. Report in one or two lines what you did and which profile you used.

## Failure cases
- **AdsPower is not signed in yet.** Ask the person to open your screen and sign in to AdsPower there themselves. Never ask for the AdsPower email or password in chat, and never type it yourself.
- **API key wrong or missing.** Ask the person to copy the API key from AdsPower (Automation, then API) on your screen and send it with the lock button, saved as ADSPOWER_API_KEY.
- **App not running.** Do not start or stop the AdsPower app yourself; the control panel keeps it running. Tell the person if the tool cannot reach it.
- **Profile opens on the wrong account.** Stop and tell the person. Do not log out or change the profile's settings without asking.
