# Connect Slack

Your agents can use Slack as you: search messages, read channels and threads, send and schedule messages, react, and work with canvases and lists. They do this through Slack's own official MCP server (`https://mcp.slack.com/mcp`), so there is nothing extra to install.

Slack doesn't let apps register themselves, so each aqeelOS needs one Slack app of its own. An admin makes it once (about 3 minutes, free). After that, everyone connects their own Slack with one click.

Before you start, set your aqeelOS web address under **System › Install**. Slack only accepts addresses that start with `https://`.

## 1. Make the Slack app (admin, once)

1. In aqeelOS, open **Connections**, press **Add** and pick **Slack**.
2. Press **Create the Slack app**. Slack opens with the app already filled in: its name, the user permissions the Slack MCP needs, and the return address of your aqeelOS.
3. Pick your workspace, press **Next**, look over the settings, then press **Create**.

If the button doesn't open Slack's page, press **Copy the app settings instead**. In Slack, go to [api.slack.com/apps](https://api.slack.com/apps), press **Create New App › From a manifest**, pick your workspace and paste the settings.

## 2. Install it (admin, once)

1. On the app's page in Slack, open **Install App**.
2. Press **Install to Workspace**, then **Allow**.

If your workspace only allows approved apps, a Slack workspace admin approves it once under **Manage apps**. Slack only lets internal apps (or apps in the Slack Marketplace) use its MCP server, and the app you just made is internal to your workspace.

## 3. Paste its keys into aqeelOS (admin, once)

1. In Slack, open **Basic Information** and scroll to **App Credentials**.
2. Copy the **Client ID** and paste it into aqeelOS.
3. Press **Show** next to **Client Secret**, copy it and paste it into aqeelOS. Don't copy the Signing Secret or the Verification Token.
4. Press **Save**. aqeelOS checks the pair with Slack before it saves it.

The secret is kept in a private file on the AI box (`slack_client.json`). It isn't shown again or written to any log.

## 4. Connect your Slack (everyone)

1. Open **Connections › Add › Slack**.
2. Next to your agent, press **Connect**. Slack opens in a new tab.
3. Check that the workspace in the top right is the right one, then press **Allow**.
4. The aqeelOS window updates by itself and shows **Connected**.

The agent now signs in to Slack as you. It can only see what you can see. To stop it, open Slack in your browser, go to **Settings & administration › Manage apps** and remove the app's access, or remove the Slack MCP from the agent under **Connections**.

An agent can also start this itself: when it needs Slack it uses `connect_mcp_tool` and sends you the Allow link.

## If something goes wrong

- **"redirect_uri did not match"**: the agent uses Slack under another name than `slack`. In aqeelOS, open the Slack setup, press **Change** and use **Made the app by hand?** to copy the return addresses. In Slack, add them under **OAuth & Permissions › Redirect URLs** and press **Save URLs**.
- **"The app needs approval"**: ask a Slack workspace admin to approve the app under **Manage apps**.
- **You changed your aqeelOS address**: make the Slack app again (step 1), or add the new return address under **OAuth & Permissions › Redirect URLs**.
- **An agent already had Slack with an app someone made earlier**: aqeelOS leaves it as it is. It shows **Its own Slack app** and keeps working.

## What aqeelOS changes

- `slack_client.json` in the engine home holds the app's Client ID and Secret (file mode 600).
- Pressing **Connect** adds `mcp_servers.slack` to the agent's settings if it has no Slack yet (`url: https://mcp.slack.com/mcp`, sign-in with this app), then starts the engine's sign-in. The sign-in itself is kept by the engine in the agent's `mcp-tokens` folder.
- Any Slack MCP without an app of its own uses this app when it signs in, including sign-ins an agent starts with `connect_mcp_tool`.
