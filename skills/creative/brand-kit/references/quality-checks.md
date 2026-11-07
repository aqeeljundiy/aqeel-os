# Quality checks for social slides (any brand)

Lessons from many rounds of team review. Run these before any preview.

## Formats

- Design every slide in 4:5 (1080x1350). All text, logo and layout live inside that frame.
- If a 9:16 (1080x1920) is needed, it is the SAME 4:5 frame placed at y 285, with only the background
  extended above and below. Verify in code: the 9:16 cropped at (0, 285, 1080, 1635) equals the 4:5, diff 0.
- Prefer a photo generated or outpainted to full 9:16 height over fades to flat colour. Fades leave seams.
- HD export: render at device scale 2 (2160x2700 for 4:5).

## Platform safe zones (short-video apps that show 4:5 photos inside 9:16)

- In 9:16 coordinates keep text, pills and CTAs out of the top 115px and below y 1545, and out of the right
  button column (about x 886 to 1032, y 960 to 1520).
- In 4:5 terms: source lines, pills and CTAs at least 130px above the bottom; from y about 675 down keep text
  within 880px from the left.
- To clear the button column, narrow or wrap the element. Never shift a centred element off-centre.
- Check these in code after the final copy change, not only before it.

## Type and spacing

- Minimum sizes on a 1080x1350 frame: headline 86px, body 34px, small labels and source lines 22px. When copy
  does not fit, cut words or split the slide. Do not shrink type.
- One spacing system per slide: equal side margins for text and visuals (about 112px reads safely on phones).
- Equal gaps between stacked blocks. Centre a visual in the space left under the text.
- No dead band at the bottom: the last block sits at the bottom safe edge and the visual grows to fill.
- Measure block positions (getBoundingClientRect in a headless render) instead of guessing.
- Keep numbers with their units and hyphenated names on one line (non-breaking spaces, `white-space:nowrap`).
  Put an italic or underlined key phrase on its own line so it does not split.

## Contrast and photos

- Assume a phone in daylight. Measure contrast under every text box: 4.5:1 for body, 3:1 for large text.
  Flag busy backgrounds (high luminance spread) and move the text or regenerate the photo with a plain area.
- Do not paste a solid panel over a photo to make room for text: the straight edge reads as a pasted box.
  A soft gradient veil is fine; keep it under the top bar and watermark.
- Photos must not look generated: prompt like real photography (35mm film, diffused light, muted colours,
  natural texture) and give photos and cut-outs the same light grade so they merge.
- Plan the layout first, then prompt the photo for it: say where the subject sits as a % of the frame and
  which area stays plain for text.
- Every image must illustrate that slide's point. Ask: would the slide make sense with only the image?
- Subjects stay whole: no cut hands, plates or heads at the frame edge.
- Generated digits and on-screen text come out garbled. Prompt "no text, no numbers" and add real text in HTML.
- Screens in photos: generate the phone held straight-on and place the screenshot axis-aligned, or map it onto
  the screen's true corners. Never a flat paste or CSS rotate.

## Variety

- No two slides in a row with the same layout or background. Rotate light, dark, accent and photo.
- Plan covers as part of the profile grid: a new cover differs from its row neighbours and the one above in
  background and layout.
- Log the formats used per post in the tracker so the next post can avoid them.

## Final check

- Open every HD slide at full size, one at a time, plus a zoom on any part that changed. A contact sheet hides
  crop errors and missing edges.
- Check each slide brightened 3 to 4 times for seams, strips and banding.
- Re-read the rendered text after any copy edit.
- Send previews as compressed JPGs under about 2 MB; keep HD PNGs for the shared folder. If someone says an
  attachment did not arrive, treat delivery as unverified.
