# Install the aqeelOS app on a Mac

The app works on Apple Silicon and Intel Macs. It isn't verified by Apple yet, so macOS stops it the first time you open it. You only need to allow it once.

## 1. Install

1. Download **aqeelOS.dmg**: in aqeelOS, open **Code** and press **Download for Mac**, or get it from the [latest release](https://github.com/aqeeljundiy/aqeel-os/releases/latest).
2. Open **aqeelOS.dmg**.
3. Drag **aqeelOS** into **Applications**.
4. Close the window, then eject the aqeelOS disk in Finder.

## 2. Open it the first time

1. Open **Applications** and double-click **aqeelOS**.
2. macOS says it can't verify the app. Press **Done**. Don't move it to the Trash.
3. Open **System Settings › Privacy & Security**.
4. Scroll down to **Security**. Next to the message about aqeelOS, press **Open Anyway**.
5. Enter your Mac password or use Touch ID, then press **Open Anyway** again.

From now on, aqeelOS opens normally.

The **Open Anyway** button only shows for about an hour after you tried to open the app. If it isn't there, double-click aqeelOS again, then go back to Privacy & Security.

## 3. Connect it

1. The app asks for **Your aqeelOS address**. Type the address you use in your browser, for example `https://ai.example.com`.
2. Sign in as usual.

To connect to a different aqeelOS later, use the **aqeelOS** menu at the top of the screen and choose **Change aqeelOS address…**

## If it says the app is damaged

If macOS says **"aqeelOS is damaged and can't be opened"**, the app isn't broken. macOS is blocking a downloaded file it can't verify.

1. Make sure aqeelOS is in **Applications**.
2. Open **Terminal** (press Command + Space and type Terminal).
3. Paste this and press Return:

   ```bash
   xattr -dr com.apple.quarantine /Applications/aqeelOS.app
   ```

4. Open aqeelOS again.

This removes the "downloaded from the internet" mark from aqeelOS only. It doesn't change any other security setting.

## Updating

When a new version is ready, the app offers **Restart and update**. You may need to allow it once more in Privacy & Security after an update.
