# Print cards (welcome cards, thank-you cards, inserts)

Same HTML pipeline, but the output is a print PDF plus a PNG preview.

1. Read the raw file the person gives. For a PDF: `pip install pymupdf` in a scratch venv, `page.get_text()`
   for the copy, `page.rect` / 72 * 25.4 for the size in mm, `get_pixmap(dpi=70)` to see the layout. Keep the
   person's copy word for word; change only the design.
2. Ask for size and single or double sided only if no raw file gives them.
3. HTML with `@page{size:<w>mm <h>mm;margin:0}` and a body of the same size. Load fonts with local
   `@font-face` woff2 files so rendering does not depend on system fonts. Use a flex column so the footer sits
   at the bottom; absolute positions drift because the headless viewport is shorter than the window size.
4. Render: `chrome --headless --no-sandbox --no-pdf-header-footer --print-to-pdf=out.pdf file://card.html`.
   Check the page count is 1 (overflow spills to page 2), then rasterise at 200 to 300 dpi with pymupdf and
   look at it.
5. A JPG logo on white: `mix-blend-mode:multiply` on the img removes the white box on light backgrounds.
   Flag logos under 1500px wide as a print risk and ask for PNG or SVG.
6. Two languages on one page: first language block, a small divider, second language block. Tell the person
   the printed body size and offer a two-sided version if it is too small.
7. Send the PNG preview and the PDF. Keep the sources in the work folder from local.md.
