# Set up Google sign-in

Your agents use Gmail, Drive, Sheets, Docs and Calendar through the Google accounts people connect in aqeelOS. Before anyone can connect one, Google has to know your aqeelOS. An admin does this once for the whole install. It is free and takes about 10 minutes.

The easiest way is inside the app: **Connections › Add › A Google account** (or **Set up Google** on System › Health). It walks you through the same steps as this page, opens each Google Cloud page for you with your project filled in, and gives you your install's own values with Copy buttons. This page explains the same steps and why each one matters.

You need:
- an admin account on your aqeelOS;
- a Google account to own the Google Cloud project (a company account is best, so the project does not depend on one person);
- your aqeelOS address, for example `https://ai.example.com`. It must be **https** with a **domain name**; Google refuses a bare IP address. You set it in System › Settings › This install.

In the steps below, `<project>` is your project ID and `<address>` is your aqeelOS address.

## 1. Make a project

Open [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate). Name it `aqeelOS` (any name works) and press **Create**.

When it is ready, note its **project ID**, for example `aqeelos-482915`. It shows under the name while you type it, and on the project's Dashboard. Every link below needs it.

*Why:* a project holds the sign-in screen, the client and the switched-on services. Keeping aqeelOS in its own project means nothing else you run in Google Cloud is touched.

## 2. Set up the sign-in screen

Open `https://console.cloud.google.com/auth/overview?project=<project>` and press **Get started**:
1. App information: App name `aqeelOS`, User support email: your email. **Next**.
2. Audience: **External**. **Next**.
3. Contact information: your email. **Next**.
4. Tick that you agree to the Google API Services User Data Policy, then **Continue** and **Create**.

*Why:* this is the screen people see when they sign in with Google from aqeelOS.

*External or Internal:* pick **Internal** only if everyone who will connect an account is in your company's Google Workspace. Internal apps need no publishing and show no warning, so you can skip steps 3 and 4. Anyone else (a personal Gmail, a client's account) cannot sign in to an Internal app.

## 3. Add your links

Open `https://console.cloud.google.com/auth/branding?project=<project>`:
- **Application home page**: `<address>`, for example `https://ai.example.com`.
- **Application privacy policy link** and **Terms of service link**: your company's pages if you have them on the same domain; otherwise `<address>` will do for now.
- **Authorised domains**: press **Add domain** and enter the main domain of your address. For `ai.example.com` that is `example.com`.

Press **Save**.

*Why:* Google asks for these before it lets you publish in the next step. The domain of every link must be an authorised domain. Google looks closely at the privacy page only when you apply for verification (see below).

## 4. Publish the app

Open `https://console.cloud.google.com/auth/audience?project=<project>`. Under Publishing status press **Publish app**, then **Confirm**. The status now says **In production**.

*Why, and what to expect:*
- **Never leave it on Testing.** In Testing, Google ends every sign-in after 7 days. The agents then lose Gmail and Drive without warning, and everyone has to connect again every week. Only test users you list can sign in at all.
- **In production**, any Google account can sign in.
- **The unverified warning.** Until Google verifies the app, people see "Google hasn't verified this app" the first time they sign in. They press **Advanced**, then **Go to aqeelOS**. This is normal for your own install: the app is yours, and Google is only saying it has not reviewed it.
- **The 100-user cap.** An unverified app can be used by up to 100 Google accounts in total. That is plenty for most teams.
- **Verification later.** If you ever need more than 100 accounts, or want the warning gone, you apply for verification from the same Google Auth Platform pages. Gmail and full Drive access are "restricted" scopes: Google then also asks for a yearly security assessment by an outside company, which costs money and takes weeks. Most teams never need it.

## 5. Make the client

Open `https://console.cloud.google.com/auth/clients/create?project=<project>`:
1. Application type: **Web application**.
2. Name: `aqeelOS`.
3. Under **Authorised redirect URIs**, press **Add URI** and enter `<address>/google-oauth/callback`, for example `https://ai.example.com/google-oauth/callback`. It must match exactly: https, your address, and no slash at the end.
4. Leave Authorised JavaScript origins empty. Press **Create**.
5. In the window that opens, press **Download JSON**. Do it now: Google shows the client secret only once. If you closed it, make a new client.

*Why:* the client is what lets aqeelOS ask Google for a sign-in, and the redirect URI is where Google sends people back afterwards. aqeelOS finishes the sign-in there by itself. A **Desktop app** client cannot send people back to your install, so aqeelOS asks for a Web application client.

## 6. Turn on the Google services

Each service the agents use is switched on once in the project. Open each link and press **Enable** (if it says **Manage**, it is already on):

| Service | For | Link |
|---|---|---|
| Gmail API | Gmail | `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=<project>` |
| Google Drive API | Drive, backups | `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=<project>` |
| Google Sheets API | Sheets | `https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=<project>` |
| Google Docs API | Docs | `https://console.cloud.google.com/apis/library/docs.googleapis.com?project=<project>` |
| Google Calendar API | Calendar | `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=<project>` |
| People API | Contacts | `https://console.cloud.google.com/apis/library/people.googleapis.com?project=<project>` |

*Why:* these match what aqeelOS asks for when someone connects an account (the `SERVICES` list in `app/google-connect.mjs`). A sign-in works without them, but an agent's first Gmail or Drive call then fails with "API has not been used in project … or it is disabled".

## 7. Add the file to aqeelOS

In aqeelOS, the last step of the setup (or Connections › Add › A Google account) takes the JSON file: drop it, choose it, or paste its text. aqeelOS then:
1. reads it, and says so plainly if it is not the client file (a service account key, for example);
2. checks it was made for this install: a **Web application** client, from the project in step 1, whose redirect URI is exactly `<address>/google-oauth/callback`;
3. saves it (only admins can, and only on the server: `~/.hermes/google_client_secret.json`, readable by aqeelOS alone);
4. asks Google whether it takes the client, with a sign-in address no one opens. A client made a minute ago can still be unknown to Google; wait a moment and press **Test again**.

Then press **Connect a Google account**. From now on, everyone connects their own Google account for their own agents in Connections › Add › A Google account.

## When something goes wrong

| aqeelOS says | What to do |
|---|---|
| This file is a Desktop client | Make a **Web application** client (step 5) and add its file. |
| The return address in this file is X, it must be Y | In the client, fix Authorised redirect URIs to Y exactly, press **Save**, download the file again. |
| This file is from the project X, not Y | You downloaded a client from another project. Use the one from step 1, or correct the project ID in step 1. |
| Google does not know this client yet | Wait a few minutes after creating it and test again. If it stays, the client was deleted: make a new one. |
| Google only accepts an https address / a bare IP address | Give aqeelOS an https address with a domain name in System › Settings, then start again from step 3. |
| Sign-ins stop working after a week | The app is still in **Testing**. Publish it (step 4), then press **Reconnect** on each account. |
| "Access blocked: aqeelOS has not completed the Google verification process" | The app is in Testing and the person is not a test user. Publish it (step 4). |
| An agent says an API is disabled | Turn that service on (step 6). |
