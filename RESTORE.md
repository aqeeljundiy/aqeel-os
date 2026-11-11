# Backups and restoring

Everything here is done in the app, under **System › Health › Backups**. Code: `app/backup.mjs` (server) and
`app/backups.js` (the card). Tests: `node --test scripts/backup-restore.test.mjs`.

## What a backup holds
Every night (03:00 in the box's time zone by default) aqeelOS packs the box's own data, encrypts it with the backup key
and uploads it to Google Drive (folder "aqeelOS backups" by default). Inside: the agents (settings, memories, skills,
chats, sign-ins), aqeelOS's data and settings, people's files, the agents' workspaces and the coding tools' sign-ins.
Left out: programs, caches and browser caches, which are installed again. The newest 14 are kept; older ones go to the
Drive bin (Google keeps them 30 more days).

**Settings** on the card: which Google account (a main-agent account with Drive), the time, how many to keep, and the
Drive folder. A new folder name starts a new folder; backups in the old one stay there.

## Without a Google account (12 Nov 2026)
No Google account connected: the same nightly backup stays on the box in `~/aqeelos-local-backups/` (encrypted with the same key;
the newest 3, none older than 14 days, all under 60 GB; the newest is never removed). Connect Google and the next one goes to
Drive too. Health shows one item when the newest good backup, Drive or local, is more than 48 hours old. A local one is
opened by hand (the app's Restore lists Drive backups and safety copies):
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:<key> -in <file> | tar -xzf - -C <empty folder>`.

## Before the first backup
1. **Connect Google.** The card says "Connect Google first" until a Google account with Drive is connected for the main
   agent. Its button opens Connect Google (the same dialog as Connections › Add › A Google account). The first time, it
   shows the plain steps to make the Google client file (about 5 minutes) and takes the file.
2. **Keep the backup key.** It is made with the first backup. Press **Show key** and keep a copy outside the box (a
   password manager). Without it no backup can be opened.

## Restoring the agents
1. **Restore…** lists the backups in Google Drive and, under "On this box", the copies of the agents saved before
   earlier restores.
2. **Prepare** downloads the backup, decrypts and unpacks it into a scratch folder and compares it with the box.
   Nothing on the box changes and the agents keep running. It needs free space in `/tmp` of about 3.5 times the
   backup's size.
3. When it is ready, **See what changes** shows: agents that go back to how they were, agents that come back (deleted
   since), agents made since (they stay), and how many files are replaced, come back, or stay as they are.
4. **Restore now** (within 3 hours of Prepare):
   - the agents, the engine dashboard and the WhatsApp bridges stop;
   - today's agents are packed into `~/aqeelos-before-restore-<date>.tar.gz` (the newest two are kept, and they show
     under "On this box", so going back is the same restore);
   - the backup is copied over the agents' folder, file by file. Every file it replaces is first moved aside and every
     file it adds is written to a journal (`<data>/restore-journal.jsonl`) before it is made;
   - when the copy is complete, the moved-aside files are deleted; the agents start again.

What a restore does and does not do:
- It restores the agents' part (`~/.hermes`): settings, keys, skills, memories, chats and sign-ins.
- Nothing is deleted: an agent or a file made after the backup stays; a file deleted since the backup comes back.
- Running programs' pid, lock and socket files stay the box's own. A database the backup holds has the box's own
  `-wal` and `-shm` files moved aside, so SQLite does not replay today's changes into the old file.
- aqeelOS's own data (people, sign-ins to aqeelOS, its settings) and people's files are not touched, so nobody is
  signed out halfway.

### When something goes wrong
- **The agents do not stop**, or **today's agents cannot be saved first**: nothing is changed, the agents start again,
  and the card says why.
- **The copy fails**: every file is put back as it was, from the journal. The card says "nothing changed".
- **aqeelOS stops during the copy** (a restart or a crash): when it starts again it stops the agents, undoes the copy
  from the journal and starts them. The card says the restore was interrupted and everything was put back.
- While the copy runs, aqeelOS's own changes to the agents' settings and keys wait, and agent restarts are left for
  the restore's own start at the end. Deploys wait too (`/healthz` busy).

## A new box from a backup
1. Install aqeelOS as in README.md and sign in.
2. **Connect Google** with the Google account that holds the backups (System › Health › Backups, or Connections ›
   Add › A Google account), with Drive on.
3. **Backup key › Enter an existing key**: paste the key you kept. aqeelOS checks it opens the newest backup.
4. If the backups are in another folder than "aqeelOS backups", set it under **Settings**.
5. **Restore… › Prepare**, then **See what changes › Restore now**. The agents come back with their settings, skills,
   memories, chats and sign-ins.

aqeelOS's own data (`apps/hermes-ui-data`: people and their sign-ins to aqeelOS), people's files (`people/`) and the
agents' workspaces (`workspaces/`) are in the same backup but are not restored from the app yet. To bring them back
on a new box, the backup can be unpacked by hand with the key:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in aqeelos-<date>.tar.gz.enc | tar -xzf - -C ~ apps/hermes-ui-data people workspaces
```

(openssl asks for the key as the password.) Do this before signing in for the first time, then restart aqeelOS.
