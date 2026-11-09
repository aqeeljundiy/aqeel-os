# Building your own aqeelOS desktop app

The desktop app (`desktop/`) opens your aqeelOS in its own window and runs Code on the computer. Nothing about one
install is built in. On first launch it asks for **Your aqeelOS address**, checks that an aqeelOS answers there, and
then shows that aqeelOS. Its name and logo come from that install (System › Branding there). People change the
address later in the app menu (Mac) or the File menu (Windows): **Change aqeelOS address…**

## What you need

- Node.js 22 or newer and git.
- A Mac to build the Mac app, Windows to build the Windows app.
- For signed builds: an Apple Developer account (Mac) and a code signing certificate (Windows). Unsigned builds work,
  but macOS and Windows warn people the first time they open them.

## 1. Your build settings (kept out of git)

Copy the example and fill it in:

```bash
cp desktop/build.config.example.json desktop/build.config.json
```

| Setting | What it does |
|---|---|
| `appId` | Your own reverse-domain id, like `org.example.aqeelos`. Keep it the same for every release: the Mac and Windows use it to update the installed app in place. |
| `address` | Optional. Your aqeelOS address, like `https://ai.example.com`. When set, the first launch opens it straight away. Leave it empty to ask. |
| `publisherName` | Windows only. The name on your signing certificate. |
| `copyright` | Optional. Shown in the app's About box. |
| `macIdentity` | Optional. The Mac signing identity to use. Empty: your Developer ID when there is one, otherwise ad-hoc (`-`). |

`desktop/build.config.json` is in `.gitignore`. So are your certificates and the `dist/` folder.

## 2. Build

```bash
cd code && npm install && cd desktop && npm install
```

```bash
npm run dist:mac
```

On Windows:

```bash
npm run dist:win
```

`ARCH=arm64`, `ARCH=x64` or `ARCH=universal` picks the Mac chip (universal runs on both). The installer lands in
`desktop/dist/`.

## 3. Sign and notarise (optional)

electron-builder reads these from the environment. Set them in your shell or your CI's secret store, never in a file
in the repo.

| Variable | For |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Your signing certificate (.p12 / .pfx) and its password. On a Mac with the certificate in the keychain you can leave them out. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Mac notarisation: your Apple ID, an app-specific password and your team id. |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | A separate Windows certificate, when you build both on one machine. |

Without them the Windows build is unsigned and the Mac build is signed ad-hoc, which an Apple Silicon Mac needs to open it at all. People then allow it once in System Settings › Privacy & Security. That is fine for trying it yourself.

## 4. Give it to your people

The public app is built by GitHub (`.github/workflows/desktop-app.yml`) whenever the version in `desktop/package.json` changes, and every aqeelOS hands out that release. The rest of this section is only for your own private build: files in `DATA/desktop` are used when they are newer than the release.

Your aqeelOS hands out the installers and tells installed apps when a new one is ready. Put the files in your
aqeelOS data folder (`DATA` is the folder your aqeelOS keeps its data in):

| File | What |
|---|---|
| `DATA/desktop/aqeelOS.dmg` | The Mac installer. "Download for Mac" gives it out. |
| `DATA/desktop/aqeelOS-Setup.exe` | The Windows installer. "Download for Windows" gives it out. |
| `DATA/desktop/version.json` | `{"mac":"1.0.9","windows":"1.0.9"}`: the version in `desktop/package.json` of the installers above. |

Installed apps ask their own aqeelOS for `version.json` every few hours. When it names a newer version they offer
**Restart and update** and download the installer from that same aqeelOS. Raise `version` in `desktop/package.json`
before each build, then update `version.json` last, after both installers are in place.

## Try it while developing

```bash
cd code/desktop && npm install && npx electron .
```

It asks for the address like an installed app. To skip that, set `AQEELOS_URL=http://localhost:4400` first. A local
aqeelOS works fine for testing.

## New icons

`node scripts/make-icons.mjs` draws `assets/icon-180.png`, `assets/icon-512.png` and `assets/icon.ico` from the plain
aqeelOS mark. Swap them for your own files if you like; keep the names.
