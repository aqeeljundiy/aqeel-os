# aqeelOS desktop app

The aqeelOS app for Windows and Mac. It opens your aqeelOS in its own window and runs Code's engine on the computer.
In Code's browser area it places a real browser (one native Chromium view per tab): sharp, with real cookies, history
and sign-ins kept per project in the project's `.aqeelos/browser` folder. Code's engine drives those tabs over the
DevTools protocol, the same way it drives a Chrome, so the AI's own tab, its cursor and the questions in Code's bar
(new sites, microphone, camera, location) all work the same.

- `main.cjs`: the window, Code's engine (run with Electron's own Node, so nothing else to install), the browser tabs
  and the control channel Code's engine uses (127.0.0.1, with a random key).
- `preload.cjs`: aqeelOS says where Code's frame is; Code says where its browser area is.
- `address.cjs` and `setup.html`: "Your aqeelOS address": asked on first launch, checked (its /install-ping), kept in the
  app's settings.json; an app already paired with an aqeelOS keeps that address. Change it in the app menu.
- `build.mjs`: builds the installer with your own settings from `build.config.json` (never in git) and stamps the
  bundled Code with its version, so the installed copy keeps updating itself from the aqeelOS it is paired with.

## Try it while developing

```
npm install
node node_modules/electron/install.js   # npm may skip Electron's download step
npx electron .     # asks for the address; AQEELOS_URL=http://localhost:4400 skips that
```

## Build the installers

See [BUILDING.md](../BUILDING.md): your build settings, signing, and where the installers and version.json go on
your aqeelOS (`DATA/desktop/`).
