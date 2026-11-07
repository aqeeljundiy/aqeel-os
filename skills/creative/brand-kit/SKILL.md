---
name: brand-kit
description: Use when making posts, carousels or ads for a brand. Load that brand's kit first (logo, palette, fonts, photo and claim rules) and check every slide against it before sharing.
---

# Brand kit (on-brand posts, carousels and ads for any brand)

This skill is the brand layer. The render method lives in `social-post-graphics`; load both.
Nothing about a specific brand is written here. Every brand detail is read at run time.

## Where the brand details come from

Read these, in this order, before any design work:

1. `references/local.md` next to this skill (kept on this server, never shared). One section per brand.
2. A brand file or brand guide the person gives (PDF, link, folder). It wins over local.md for that job.
3. The brand's own website: logo file from the header `img` src, real product photos, the copy and the claims
   the brand already makes in public.

If a field below is missing, ask once, in one message, listing only the missing fields. Never guess a logo,
a colour or a claim.

Example of what `references/local.md` should hold (fake values):

```
## Acme
- Site: acme.com. Copy language: English, casual, short lines.
- Logo: acme.com/assets/logo.png (transparent PNG), top-left, about 46px tall on a 1080 frame. Never typed text.
- Palette: background #FFFFFF, accent #123456 (one word or number per slide), dark #0B0B0B.
- Fonts: "Example Sans" 400 headlines, "Example Serif" italic for one key word. From Google Fonts.
- Photo rules: soft daylight, pale surfaces, one accent-colour object per photo. Real product photos only for the product.
- Claim rules: only the claims in "Approved claims" below. No prices on organic posts.
- Approved claims: "Every batch is tested before shipping." "Free first consultation."
- Approved style: "editorial v1" (see style notes). Anything else is exploration only.
- CTA: website on the last slide; caption says "link in bio".
- Tracker: sheet named "Acme content", tab "Contents"; map columns by header name.
```

## What a brand kit must cover

- **Logo:** the real file, its placement and size, a light and a dark version. Never retype the logo as text.
- **Palette:** background, one accent, one dark. Accent use is rationed: one word, one number, or a whole background.
- **Fonts:** headline, body, accent. Download them locally so renders do not depend on system fonts.
- **Photo rules:** light, surfaces, colour mood, what may be generated and what must be a real photo.
- **Approved style:** the one look that is final. Test looks are exploration only until the owner approves them.
- **Claim rules:** which claims are approved, which are banned, which need a source on the slide.
- **CTA and channel rules:** where the CTA points, what may appear on which platform.
- **Workflow:** tracker sheet, statuses, where approved files go, who approves.

## Procedure

1. Load the brand details (above). State in one line which brand and which approved style you use.
2. Write the brief before any design: per slide the one point, the headline, body lines, the visual and the
   source line. Then a caption. Ask "go to design?" and wait.
3. Build with `social-post-graphics`. Use only the brand's fonts, palette and logo file.
4. Run the checks below on every slide at full size, then send previews.
5. Nothing goes to shared storage or the tracker before the person approves the exact files.

## Claims: general care (all brands)

- Use only numbers and claims a source states. Cite the source on the slide (author or body, year).
- Do not strengthen evidence. Keep the population, the model (cell, animal, human) and the route of a study
  in the claim. "Linked to" for observational studies, never "causes".
- Personal stories are labelled as personal experiences, with the source and "results vary". Translated
  quotes are marked as translated or paraphrased.
- Generated before/after images are labelled as illustrations, never shown as a real person's result.
- Charts only from verified data. Never invent a placebo value, a midpoint or a smooth curve. If you only have
  end points, show end points.
- Remove an unconfirmed number before approval instead of asking the person to accept the risk.

## Health and other regulated topics

Treat health, supplements, medicines, finance, alcohol and similar topics as regulated by default:

- Education framing, not sales. No prices, "buy" or dose on organic posts unless local.md says otherwise.
- Never name a prescription product in an ad unless the brand's claim rules allow it. Name the brand's own
  program instead.
- No dramatic result claims ("lose 15 kg in 3 weeks"). No diagnosis: describe symptoms, not diseases, and
  say when to see a professional.
- Early research (cell or animal only) is described as promising and still being studied, never as proven
  safe or effective in people.
- Platforms review the whole post, image plus claim plus context, not keywords. Swapping a word for a code
  word does not help and counts as a violation. Change the content.
- When a post would be risky on one platform, make two versions from one build file: a full version for the
  platform that allows it and a safe version without the risky part. Slides that do not touch the risky part
  stay identical.
- If the brand gives a watermark or disclaimer line, put it on every slide where the brand says, and check it
  reads in full on every slide.
- Flag ad-review risk once, briefly. Do not re-argue the brand's legal position.

## Checks before sharing (every slide, at full size)

- Logo is the real file, sharp, the right version for the background.
- Only brand fonts and colours. Accent used once per slide at most.
- Every claim is on the approved list or sourced on the slide.
- Contrast: every text block reads against what is behind it. No accent text on dark photos, no text on busy
  areas, no thin text on colour.
- Copy reads as a native speaker of the post's language would write it. No translated idioms.
- Every subject is whole, nothing cropped at the edge, no large empty band.
- Watermark or disclaimer present where required.
- Platform version matches the platform's rules.

More layout and quality checks: `references/quality-checks.md`.

## Pitfalls

- A test look slips back in when you copy CSS from an old exploration build. Start from the approved style.
- Generated copies of a product garble the logo. Use the real product photo, or composite the real logo last
  and say so.
- Real celebrity faces or names on hooks read as endorsement. Use made-up people.
- References from other brands are mood only. Never copy their layout, pose, crop or wording.
- When a team decision changes a rule, update local.md and any planned rows in the tracker in the same turn,
  so old rules do not come back.
