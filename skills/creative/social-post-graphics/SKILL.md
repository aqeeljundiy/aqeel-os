---
name: social-post-graphics
description: Use when making social post images or carousels for a brand. Plans one point per slide, builds slides in HTML, renders PNGs and checks them before sending.
---

# Social post graphics (4:5 posts and carousels)

Output: finished PNGs sent in chat, one per slide in order, plus one line per slide on what it shows and what
changed. When the person asks for a redesign, give your critique and plan first, then build after their yes.

Brand details (logo, palette, fonts, claim rules) come from the `brand-kit` skill. Load it too. Install
values for this skill, if any, are in `references/local.md` next to this skill (kept on this server, never
shared), for example:

```
- Default brand: Acme (details in brand-kit local.md).
- Work folder: ~/work/social (one sub-folder per post).
- Image tool: the install's image_generate tool, aspect portrait.
```

## Procedure

1. **Brand and facts from the site.** Fetch the brand site (`curl -sL -A Mozilla/5.0 <site>`) and strip tags
   for copy and claims. Find real assets: the logo in the header `img` src, product photos. Use only numbers a
   source states, and cite them.
2. **Plan the story, slide by slide.** For each slide decide the ONE point and the ONE visual that explains it.
   Treat the person's ideas (athletes, 3D, cut-outs, icons) as direction, not a checklist: use an object only
   when it carries the slide's meaning. A decorative prop reads as random.
3. **Images** with the image tool, aspect portrait. End every prompt with "no text, no labels, no logos" and
   "no people" for object shots. Vary the visual by topic. Pass a real site photo as reference when showing
   the product: generated copies garble logos.
4. **Cut-outs** (transparent PNG): generate on solid magenta `#FF00FF`, not white (white products key out).
   Key with PIL: pixels where `min(r,b) - g > 60` become transparent, soft edge between 25 and 60, despill the
   edge (pull r and b toward g) so no pink fringe stays, then `crop(getbbox())`. Test on the slide background.
   Place with `filter: drop-shadow`, fully inside the canvas.
5. **Layout in HTML** at 1080x1350. Data visuals (timelines, comparisons, charts) as inline SVG with a fixed
   viewBox that matches its CSS size. Never `preserveAspectRatio="none"`: it stretches text.
6. **Render** with headless Chromium:
   `chrome --headless=new --no-sandbox --allow-file-access-from-files --hide-scrollbars --virtual-time-budget=8000 --window-size=1080,1500 --screenshot=raw.png file://post.html`
   then crop with ffmpeg `-vf crop=1080:1350:0:0`. A window exactly 1350 tall leaves a blank band.
7. **Check** a contact sheet (ffmpeg hstack/vstack) with the vision tool, then open each slide at full size:
   nothing covering the photo's subject, no labels on lines, no clipping, no big empty area, cut-outs visible.

## Layout rules

- Same brand kit, a different layout per slide: text top with full-bleed photo; giant stat with side photo;
  photo band with stacked rows; split; chart. Fill the canvas, no large empty band.
- Badges and stat boxes go in genuinely empty parts of the photo, never over the subject.
- No collage of boxes on photos. Prefer one clean visual per slide.
- End a set with a calm outro: a short conclusion and one soft CTA to the website. Do not end on a warning list.
- Plain text on a flat colour reads as dead. Use real imagery.

## Pitfalls

- When building HTML in Python, insert content with `.replace` or f-strings, not `%` formatting: CSS
  percentages break it. Edit build files with Python, not sed: sed treats `&` in `&nbsp;` as the matched text.
- Fire one image call first and batch the rest only after it succeeds. A quota error fails every parallel call
  the same way. On a quota error retry once after a minute, then tell the person and offer: wait, reuse
  existing art, or use photos they send.
- Image calls can time out in a parallel batch. Keep the successes, retry the failed ones alone with a shorter
  prompt and fewer reference images.
- To keep one made-up person across slides, pass the first photo as the reference on every call and
  vision-check each face against it.
- The image tool sometimes returns landscape for portrait. Check the size and place with fixed pixel widths.
- Safety filters can refuse body-action scenes (first aid, injections). Do not retry the same prompt: draw
  those steps as simple SVG line icons.
- Social profiles usually need a login to view. To copy an account's style, ask for a screenshot.
- Render one post folder at a time. Two renders sharing one temp screenshot swap slides.

## Print cards

Welcome cards, thank-you cards and inserts use the same HTML pipeline with a print PDF as output:
`references/print-cards.md`.

## After delivery

Offer captions or scheduling. Post or schedule only with the person's approval, by hand in the platform's
business tools or through its API with a business account.
