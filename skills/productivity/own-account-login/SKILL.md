---
name: own-account-login
description: Use when the person asks you to log in to one of their own websites. Sign in on your own screen with saved secrets you never see, never through chat.
---

# Log in to my own accounts

The person asks you to sign in to one of their own accounts (a shop, a social app, a travel site) in the browser on your own screen. Passwords and codes never go through chat, and you never see their values.

Only log in to accounts that belong to the person who asked. If an account belongs to someone else or to a business they did not mention, ask first.

## What you use
- **type_secret**: types a saved secret into the focused field by its name. You pass the name, never the value.
- **ask_secret**: asks the person to enter a value (a password, a one-time code) through the lock button. It goes straight to the field or to the secret store, not into chat.
- Your browser tools to open pages, fill the username and check where you are.

Which secret names exist for which site, and any hosts that worked before, are in references/local.md next to this skill (kept on this server, never shared). Example of what it can hold:

```
- acme.com: secret ACME_PASSWORD, username from the person, login at https://acme.com/login
- shop.example: mobile host m.shop.example works when the main host redirects
```

## Procedure
1. Tell the person once which screen to watch (your screen), so they can follow and press Take over if needed.
2. Check first whether they are already logged in on your screen. Open the site and look for a profile picture or account menu. If logged in, say so and stop.
3. Open the site's direct login page. Check the real address and the page text: the browser may exit from another country, so a site can redirect to a country block or a "not available" page.
4. If it redirects, try other hosts of the same site before giving up: the mobile host (`m.<site>`), a direct login path, a language parameter. Note any host that works in references/local.md.
5. Fill the username yourself, then focus the password field.
6. Password: use type_secret with the saved name. If no secret is saved, use ask_secret so the person enters it through the lock button. Never print, log or repeat a secret.
7. Two-step code sent to their phone or email: use ask_secret so they enter it through the lock button. Never ask for the code in chat.
8. Check that you are logged in (profile visible, address left the login page) before saying it is done. Report in one or two short lines.

## Rules
- Never ask for a password or code in chat.
- If the person types a password in chat anyway, do not use it and do not repeat it. Say briefly that chat can be read by others, suggest they change that password (more so if they reuse it), and offer the lock button instead.
- Never store a password in a note, file, memory or message.
- Do not create new accounts, accept terms, or change account settings unless the person asks for that exact step.
- Do not guess how a session got logged in. Say only what you checked: the session is logged in.

## Failure cases
- **Secret looks missing.** Secret files can live under a path where `~` resolves differently in the browser tool and the terminal. Use the tool (type_secret) instead of reading files, and if you must reference a path, use the absolute one from references/local.md.
- **Lock button does nothing.** The lock box can only fill a real login form. Open the login page first, focus the password field, then call it.
- **Country block after one URL.** Do not tell the person a site is blocked after one failed address. Try the other hosts in step 4 first.
- **Login button returns a server error.** The login API itself may be blocked from your location. After two or three tries, stop and suggest they log in on their phone instead.
- **Anti-bot or CAPTCHA page.** Do not try to get past it. Tell the person plainly and offer another route (another site, or they log in themselves on your screen).
- **Stuck halfway.** Say exactly how far you got (for example: username filled, password not yet) and give one next step for them.
