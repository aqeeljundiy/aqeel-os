# Tebar REST API (for agents with a terminal)

Base address https://api.tebar.app/v1. The full description is https://api.tebar.app/v1/openapi.json.

## The key

- A Tebar API key starts with `tb_live_` and is either read only or read and write. It goes in the header
  `Authorization: Bearer <key>`, never in the address. Use the key saved for you (for example `$TEBAR_API_KEY`); never
  print it, write it into a file others read, or paste it in a chat.
- The person makes keys in the Tebar dashboard (with the developer settings, next to webhooks). It needs a paid plan.
- JSON in and out, snake_case fields, times in ISO 8601 with an offset going in, UTC coming back.
- Lists: `limit` (up to 100) and `cursor`; the answer has `data` and `next_cursor` (null on the last page).
- Errors: `{"error":{"code":"...","message":"..."}}`. 429 `rate_limited` comes with `Retry-After` (seconds).
- With several brands: the header `Tebar-Profile: <profile id or external_id>` keeps a call to one profile.

```bash
T=https://api.tebar.app/v1
H="Authorization: Bearer $TEBAR_API_KEY"
```

## Read

```bash
curl -s "$T/me" -H "$H"                                     # who, and whether the key can write
curl -s "$T/accounts" -H "$H"                               # connected accounts and their ids
curl -s "$T/accounts/ACCOUNT_ID/publishing-limit" -H "$H"   # quota left on one account
curl -s "$T/accounts/ACCOUNT_ID/tiktok/creator-info" -H "$H"  # before any TikTok post
curl -s "$T/accounts/ACCOUNT_ID/pinterest/boards" -H "$H"
curl -s "$T/posts?status=scheduled&sort=scheduled&limit=50" -H "$H"
curl -s "$T/posts/POST_ID" -H "$H"                          # status and permalink per account
curl -s "$T/comments?limit=50" -H "$H"
curl -s "$T/accounts/ACCOUNT_ID/insights" -H "$H"
curl -s "$T/accounts/ACCOUNT_ID/post-insights" -H "$H"
curl -s "$T/accounts/ACCOUNT_ID/best-times" -H "$H"
curl -s "$T/ideas/board" -H "$H"
curl -s "$T/inbox/conversations" -H "$H"                    # Instagram DMs (paid plans)
```

## Write (only after the person said yes, see SKILL.md)

Media first, then the post:

```bash
# a public address
curl -s -X POST "$T/media/from-url" -H "$H" -H "content-type: application/json" \
  -d '{"url":"https://example.com/photo.jpg"}'
# a file on disk: the raw bytes as the body (up to 8 MB photos, 300 MB videos)
curl -s -X POST "$T/media/upload?name=photo.jpg" -H "$H" -H "content-type: application/octet-stream" \
  --data-binary @photo.jpg
```

Schedule a post to two accounts (the same Idempotency-Key on a retry, a new one for each new post):

```bash
KEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
curl -s -X POST "$T/posts" -H "$H" -H "content-type: application/json" -H "Idempotency-Key: $KEY" -d '{
  "content": "The text of the post",
  "media_ids": ["MEDIA_ID"],
  "scheduled_at": "2026-10-15T09:00:00+07:00",
  "targets": [
    {"account_id": "THREADS_ACCOUNT_ID", "options": {"thread": ["Second part", {"text": "Third part", "media_ids": ["MEDIA_ID_2"]}]}},
    {"account_id": "INSTAGRAM_ACCOUNT_ID", "content": "A different caption for Instagram"}
  ]}'
```

Leave out `scheduled_at` to publish at once. Each target may have its own `content`, media and `options` for its
platform; unknown option names are refused (400 invalid_options). Options by platform:
- Threads: `topic_tag`, `reply_control`, `link_attachment`, `poll`, `text_attachment`, `thread`, `is_made_with_ai`
- Instagram: `format`, `share_to_feed`, `cover_media_id`, `thumb_offset_ms`, `trial`, `collaborators`, `first_comment`, `is_ai_generated`
- TikTok: `post_mode`, `privacy_level` (the person picks: PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR,
  SELF_ONLY), `allow_comment`, `allow_duet`, `allow_stitch`, `commercial`, `is_aigc`, `photo_title`, `music`, `first_comment`
- YouTube: `title` and `made_for_kids` (both required), `privacy` (public, unlisted, private), `tags`, `category_id`,
  `contains_synthetic_media`, `notify_subscribers`
- Pinterest: `board_id`, `title`, `link`; X: `made_with_ai`

Change, cancel, retry:

```bash
curl -s -X PATCH "$T/posts/POST_ID" -H "$H" -H "content-type: application/json" -d '{"scheduled_at":"2026-10-15T10:00:00+07:00"}'
curl -s -X DELETE "$T/posts/POST_ID" -H "$H"               # cancel a scheduled post
curl -s -X POST "$T/posts/POST_ID/retry" -H "$H"           # the accounts where it failed
```

Comments and DMs:

```bash
curl -s -X POST "$T/comments/COMMENT_ID/reply" -H "$H" -H "content-type: application/json" -d '{"text":"Thank you!"}'
curl -s -X POST "$T/comments/COMMENT_ID/hide" -H "$H" -H "content-type: application/json" -d '{"hidden":true}'
curl -s -X POST "$T/inbox/conversations/CONVERSATION_ID/messages" -H "$H" -H "content-type: application/json" -d '{"text":"Hi!"}'
```

Short links (REST only, Starter and up):

```bash
curl -s -X POST "$T/links" -H "$H" -H "content-type: application/json" -d '{"url":"https://example.com/page","title":"Launch"}'
curl -s "$T/links/LINK_ID/stats" -H "$H"
```

Profiles and connect links (a client connects their own accounts without your Tebar login):

```bash
curl -s "$T/profiles" -H "$H"
curl -s -X POST "$T/profiles/PROFILE_ID/connect-links" -H "$H" -H "content-type: application/json" \
  -d '{"platforms":["instagram","tiktok"],"redirect_url":"https://example.com/done"}'
```

Webhooks are set up by the person (Connections, the Tebar row, then in Tebar); do not make or delete them unless
they ask.
