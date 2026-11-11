# Connect Microsoft 365

Connect an Outlook, Hotmail, Microsoft 365 work or school account so your agents can use its mail, calendar and OneDrive files.

Microsoft needs to know aqeelOS first. An admin registers one app in Microsoft Entra once (about 5 minutes, free). After that, everyone connects their own Microsoft account with one click.

Before you start, set your aqeelOS web address under **System › Install**. Microsoft only accepts return addresses that start with `https://`.

You need access to the Azure portal. A work or school account usually has it. With a personal Microsoft account, sign up for a free Azure account first; that gives you a directory to register the app in.

## 1. Register the app (admin, once)

1. In aqeelOS, open **Connections**, press **Add** and pick **A Microsoft account**. Keep this window open; it shows the address you need below.
2. Open [App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) in the Azure portal and press **New registration**.
3. **Name**: aqeelOS.
4. **Supported account types**: pick **Accounts in any organizational directory and personal Microsoft accounts**.
5. **Redirect URI**: pick **Web** and paste the address aqeelOS shows. It looks like `https://your-aqeelos/microsoft-oauth/callback`.
6. Press **Register**.

## 2. Let it read and send for you (admin, once)

1. In the new app, open **API permissions**.
2. Press **Add a permission › Microsoft Graph › Delegated permissions**.
3. Tick these: `offline_access`, `profile`, `email`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite.All`.
4. Press **Add permissions**.

If you're the admin of a company Microsoft 365, you can also press **Grant admin consent** so nobody in the company is asked to approve it.

## 3. Make a secret (admin, once)

1. Open **Certificates & secrets › Client secrets › New client secret**.
2. Pick **24 months** and press **Add**.
3. Copy the **Value** right away. Microsoft hides it once you leave the page. Don't copy the Secret ID.

Put a reminder in your calendar: the secret stops working after 24 months. Make a new one then and paste it under **Change**.

## 4. Paste both into aqeelOS (admin, once)

1. On the app's **Overview** page, copy the **Application (client) ID**.
2. In aqeelOS, paste the Application (client) ID and the secret's Value.
3. Only people from your own organisation should sign in? Open **Only people from one organisation?** and paste the **Directory (tenant) ID** from the Overview page. Otherwise leave it empty.
4. Press **Save**.

The secret is kept in a private file on the AI box (`microsoft_client.json`). It isn't shown again or written to any log.

## 5. Connect your account (everyone)

1. Open **Connections › Add › A Microsoft account**.
2. Pick the agent under **For**. If the agent already has a Microsoft account, give this one a short name, like `work`.
3. Pick what it may use: **Outlook mail**, **Calendar**, **OneDrive files**.
4. Press **Connect Microsoft**, sign in in the tab that opens and press **Accept**.
5. The aqeelOS window updates by itself and shows the account as **Works**.

To stop it, press the bin next to the account. To end it everywhere, remove aqeelOS under [account.microsoft.com › Privacy › Apps and services](https://account.microsoft.com/privacy) (personal) or [myapps.microsoft.com](https://myapps.microsoft.com) (work or school).

## If something goes wrong

| Microsoft says | What to do |
| --- | --- |
| AADSTS50011, redirect URI doesn't match | Add the address aqeelOS shows under the app's **Authentication › Web › Redirect URIs** and press **Save**. |
| AADSTS7000215, invalid client secret | You pasted the Secret ID, or the secret expired. Make a new secret and paste its **Value** under **Change**. |
| AADSTS700016, app not found | Set **Supported account types** to any organisation and personal accounts. |
| AADSTS50020, account not allowed | Same fix: the app only allows one kind of account. |
| Need admin approval | Your company blocks apps it hasn't approved. Ask your Microsoft 365 admin to grant consent for aqeelOS. |

## What aqeelOS keeps

- `microsoft_client.json` in the engine home: the app's ID, secret and who may sign in (file mode 600).
- `microsoft_token.json` (or `microsoft_token_<name>.json`) in the agent's engine home: that account's sign-in, what it may use, and a refresh token (file mode 600). Each check swaps in the new refresh token Microsoft hands back.

## Not done yet

The sign-in is stored, but the agents don't have Outlook, Calendar and OneDrive tools that read it yet. That's the next step: a small set of Microsoft Graph tools (list, read, send mail; list and create events; list, read, upload files) that read the agent's `microsoft_token*.json`, refresh it, and save the new refresh token.

## Why not Microsoft's own MCP server?

Microsoft's hosted MCP server for Microsoft 365 (Work IQ MCP) needs a work or school organisation, a Microsoft 365 Copilot licence and an admin to turn it on. It doesn't work with personal accounts, so it can't be the default for every aqeelOS.
