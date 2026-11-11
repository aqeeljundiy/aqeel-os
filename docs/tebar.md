# Tebar in aqeelOS

[Tebar](https://tebar.app) ([docs](https://docs.tebar.app)) is a social media scheduler: one Tebar login holds your
Threads, Instagram, Facebook Page, TikTok, YouTube, LinkedIn, X, Telegram, Discord and Pinterest accounts, grouped in
profiles (one per brand or client). With Tebar connected, an agent can write and schedule posts, answer comments,
read and send Instagram DMs, run DM automations, read insights and keep the media library and ideas board.

## What you need

- A Tebar account on a paid plan: **Starter (Rp17.900 a month) or higher**, or the 14 day Pro trial every new account
  gets. The Free plan has no API or MCP access. See [tebar.app/harga](https://tebar.app/harga).
- The Instagram inbox and automations are on Starter and up; short links on Starter and up (REST only); headless
  connect links on Agency.
- Your accounts connected inside Tebar first (Tebar's own Akun page). aqeelOS works through Tebar; it does not
  connect Instagram or TikTok itself.

## Connect it (one agent at a time)

Connections › **Add** › **An app from the catalog**, pick the agent at the top, then one of:

- **Tebar**: sign in. A Tebar tab opens; sign in and press Allow. You choose read only or read and write there. Nothing
  to copy.
- **Tebar (API key)**: paste a key instead. Make it in the Tebar dashboard (it starts with `tb_live_`). A read only key
  gives the agent only the read tools; a read and write key also lets it post.

To give Tebar to more agents, open the Tebar row on Connections and use **Add agent**. The level there counts too:
**Read** leaves only Tebar's read tools; **Full** is needed to post, reply to comments or send DMs (a comment reply on
Tebar is public, so Read & draft does not allow it).

## What agents can do

Every agent has the built-in **tebar** skill (skills/social-media/tebar). It tells them:

- **Ask before anything public.** They show you the exact text, media, accounts and time, and wait for your yes,
  unless you told them they may post a kind of post without asking. Drafts go on the Tebar ideas board.
- **Check the rules first**: `get_platform_rules` and `get_publishing_limits`; TikTok's creator settings (you choose
  the privacy level, never the agent); Threads threads of up to 10 parts; AI made content flagged per platform.
- **Times always with a time zone**, Asia/Jakarta (+07:00) unless you say otherwise.
- **No double posts on retries**: the same request within 10 minutes returns the same post; over REST an
  Idempotency-Key header.
- **Rate limits**: 60 requests a minute plus 5 per connected account (at most 600), shared by the API and MCP.
- **Posting limits**: an agent with Run rules (Schedules › Run rules) counts each Tebar post that goes out against its
  limits and records it with record_post.
- Agents with a terminal can use the REST API (https://api.tebar.app/v1) with a key, as the skill's
  references/rest-api.md shows.

The tools by name: read `list_accounts`, `get_platform_rules`, `get_publishing_limits`, `list_posts`, `get_post`,
`list_comments`, `get_tiktok_creator_info`, `list_tiktok_music`, `get_account_insights`, `get_post_insights`,
`get_post_performance`, `get_best_times`, `list_ideas`, `list_media`, `list_conversations`, `get_conversation`,
`list_automations`, `get_contact`; write `create_post`, `update_scheduled_post`, `cancel_scheduled_post`, `retry_post`,
`upload_media_from_url`, `create_upload_link`, `reply_to_comment`, `hide_comment`, `like_comment`, `set_comment_status`,
`create_idea`, `update_idea`, `send_dm`, `set_conversation_status`, `create_automation`, `update_automation`.

## Webhook: hear from Tebar (optional)

Tebar can tell aqeelOS when a post fails, an account needs signing in again, or a comment or DM comes in.

1. On Connections, open the agent's **Tebar** row. Under **Tebar webhook**, copy the address
   (`https://<your aqeelOS>/hooks/tebar/<agent>`). aqeelOS needs a public https address (System › Settings).
2. In Tebar: **Integrasi › Tambah webhook** (turn on Developer mode first). Paste the address and pick the events.
   To keep one brand apart, limit the webhook to its profile.
3. Tebar shows the secret (`whsec_...`) **once**. Paste it in the same aqeelOS section and press Save. It is kept on the
   server (data/tebar-secrets.json, readable only by aqeelOS) and never shown again or written to a log.
4. In Tebar, send a test: the section shows it under Last events, and you get a notice.
5. Pick the same events in aqeelOS. Events you did not pick are answered and ignored.

What each event becomes:

| Event | In aqeelOS |
| --- | --- |
| post.failed | An alert (Health, Bottlenecks, your alert chat) with Tebar's error; gone once that post goes out |
| account.expired, account.disconnected | An alert to reconnect the account in Tebar; gone once it is connected again |
| comment.created | A notice in the bell of the agent's owner (admins for the main agents) |
| message.received | A notice: a new Instagram DM |
| the others (post.published, comment.replied, automation.run, ...) | A notice, if you picked them |

aqeelOS checks every delivery's signature (`Tebar-Signature`, HMAC-SHA256 of `<t>.<body>`, at most 5 minutes old),
answers within Tebar's 5 seconds and skips a delivery it already had (`Tebar-Delivery` and the event id), since Tebar
retries for about a day. A comment or DM's text is someone else's words: shown as text, never acted on.

To stop it: **Remove the webhook here** in the section, and delete the webhook in Tebar too.

## Checked and not checked

Checked on 11 Nov 2026 without an account: the MCP server asks for sign-in and names its sign-in server
(`/.well-known/oauth-protected-resource`, scopes read and write); the REST description (`/v1/openapi.json`); the
webhook format from the docs. Not yet tried with a real paid Tebar account: the sign-in end to end, the key's header
on the MCP server, a real webhook delivery.
