# Backups and restoring

Everything here is done in the app, under **System › Health › Backups**. Code: `app/backup.mjs` (server) and
`app/backups.js` (the card). Tests: `node --test scripts/backup-restore.test.mjs`.

## What a backup holds
Every night (03:00 in the box's time zone by default) aqeelOS packs the box's own data, encrypts it with the backup key
and uploads it to Google Drive (folder "aqeelOS backups" by default). Inside: the agents (settings, memories, skills,
chats, sign-ins), aqeelOS's data and settings, people's files, the agents' workspaces and the coding tools' sign-ins.
Left out: programs, caches and browser caches, which are installed again. The newest 14 are kept; older ones go to the
Drive bin (Google keeps them 30 more days).

### Media packs (13 Nov 2026)
Elkiya's nightly archive had grown from 9 to 28.6 GB (41 GB of files, mostly reels, frames and browser downloads) and took
112 minutes a night, though only about 3 GB a day is new. Now:
- **Large files that did not change are kept once.** A file of 128 KB or more that is not a database and was not written in the
  last 3 hours goes into a *media pack* (gzip, encrypted with the same key) in its own Drive folder, "aqeelOS backups media",
  and is recorded in `apps/hermes-ui-data/backup-media.json` (path, size, mtime, sha-256). Next night a file with the same path,
  size and mtime is not packed again. Each night's archive holds a manifest, `backup-manifest.json`, that names for every such
  file the pack that holds it. The agents' files and everything else are in different packs, and a pack is at most about 4 GB.
- **A night restores completely.** One night = its archive + the packs its manifest names. A pack stays in Drive while any kept
  night names it; one that no kept night names goes to the Drive bin after a day (never deleted; if the index is lost, nothing
  is binned until every kept night is known again, and the files are packed once more).
- **A damaged or missing pack is found at backup time, not at restore time** (checked on Elkiya with a real round trip, 13 Nov
  2026). After every upload the size and Google Drive's own checksum (md5) are compared with the file that was sent; a file
  that arrived damaged goes to the Drive bin and the night fails. Every night the packs in Drive are listed, and one that is
  gone, has another size or another checksum is packed again and said on the result (an earlier night that named it cannot
  bring those files back). Only files tar itself lists as written into a pack are recorded as being there. A file is taken as
  unchanged when its path, size, time and inode are the same. A SQLite database is never packed, whatever its name (a browser's
  `Cookies`, `History`): it stays in the nightly archive next to its `-wal` and `-journal`. A folder with a `pyvenv.cfg` is
  only left out when it holds nothing but a virtual environment (`bin`, `lib`, `include`, `share` ...): a project somebody ran
  `python -m venv .` in is backed up whole.
- **Left out because it can be made again:** AdsPower's downloaded browser kernels (`.config/adspower_global/cwd_global/chrome_*`,
  about 1 GB in each of 9 workspaces), aqeelOS's own AdsPower install (`workspaces/.aqeelos-adspower`), Chromium's component,
  certificate and safe-browsing lists and GPU caches, and Python virtual environments (a folder with a `pyvenv.cfg`). A virtual
  environment's configuration and package list (name-version) are written to the manifest, so it can be made again exactly.
  Nothing that a person or an agent made is left out by a name rule: reels and frames are backed up (they go to packs).
- **Files that cannot be read** (the Linux user of a deleted agent owned them, or they are private to another user) are listed
  once in `apps/hermes-ui-data/backup-skipped.json` with a reason, shown on the card, and not said again each night. A file in
  the agent trash is backed up when it can be read, skipped with that reason when not.
- Without a Google account nothing changes: one archive on the box, big files included (no packs); only the virtual
  environments are left out, with their package lists in the manifest.

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
   backup's size, plus the agents' big files from the media packs (it downloads only the packs that hold the agents' files, one
   at a time, and takes those files out of them).
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
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in aqeelos-<date>.tar.gz.enc | tar -xzf - -C ~ apps/hermes-ui-data people workspaces backup-manifest.json
```

(openssl asks for the key as the password.) Do this before signing in for the first time, then restart aqeelOS.

The big files that were in media packs come next. Download the packs the manifest names (the file names are the keys of `packs` in
`~/backup-manifest.json`) from the Drive folder "aqeelOS backups media" into one folder, put the key in a file and run:

```bash
node scripts/restore-media.mjs ~/backup-manifest.json ~/packs ~ --key-file ~/key.txt            # everything
node scripts/restore-media.mjs ~/backup-manifest.json ~/packs ~ --key-file ~/key.txt --only workspaces/   # one part
```

Each file is checked against its size and sha-256 and the script says what is missing or does not match. The virtual
environments the manifest lists (`venvs`: path, configuration, packages) are not in the backup: make them again with
`python3 -m venv <path>` and `pip install` of the listed packages.
