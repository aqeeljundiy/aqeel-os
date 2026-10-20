# aqeelOS desktop app

The aqeelOS app for Windows and Mac. It opens your aqeelOS in its own window and runs Code's engine on the computer.
In Code's browser area it places a real browser (one native Chromium view per tab): sharp, with real cookies, history
and sign-ins kept per project in the project's `.aqeelos/browser` folder. Code's engine drives those tabs over the
DevTools protocol, the same way it drives a Chrome, so the AI's own tab, its cursor and the questions in Code's bar
(new sites, microphone, camera, location) all work the same.

- `main.cjs` – the window, Code's engine (run with Electron's own Node, so nothing else to install), the browser tabs
  and the control channel Code's engine uses (127.0.0.1, with a random key).
- `preload.cjs` – aqeelOS says where Code's frame is; Code says where its browser area is.
- `build.mjs` – builds the installer and stamps the bundled Code with the aqeelOS address and Code's version, so the
  installed copy keeps updating itself from aqeelOS (every 30 minutes, when no AI run is going).

## Try it while developing

```
npm install
node node_modules/electron/install.js   # npm may skip Electron's download step
set AQEELOS_URL=http://localhost:4402 && npx electron .
```

## Build the installers

- Windows (on Windows): `npm run dist:win` → `dist/aqeelOS Setup 1.0.0.exe`. Copy it to the server as
  `~/apps/hermes-ui-data/desktop/aqeelOS-Setup.exe`; aqeelOS's "Download for Windows" then gives it out.
- Mac (on a Mac): `npm install && npm run dist:mac` → `dist/aqeelOS-1.0.0.dmg`. Copy it to the server as
  `~/apps/hermes-ui-data/desktop/aqeelOS.dmg`; "Download for Mac" then gives it out.

Neither installer is signed yet (CODE-22), so Windows shows "Windows protected your PC" the first time (More info ›
Run anyway) and the Mac asks to open it from System Settings › Privacy & Security.
