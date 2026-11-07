---
name: pretty-sheets
description: Use when creating or editing any Google Sheet. Applies one neat house style to every tab you touch (font, header, banding, widths, money) and checks it visually.
---

# Pretty sheets (house style for every Google Sheet)

People read every sheet themselves, even agent-only knowledge and log sheets. Any sheet or tab you create or
append to must look neat before you call it done.

Install values are in `references/local.md` next to this skill (kept on this server, never shared). Read it
first when present. Example (fake values):

```
- Font: Inter
- Money format: "$" #,##0.00   (header words that mark money columns: price, amount, total, cost)
- Google wrapper: /path/to/gapi.py   (or set GAPI_PATH)
```

If there is no local.md, use the defaults below.

## Style

- One font for the whole sheet (default Inter), size 10, 9 is fine for dense logs. Header 10 bold white on a
  pastel colour; the tab colour matches the header.
- Body rows banded white and a light pastel, light grey row lines, gridlines hidden, header row frozen, text
  wrapped, vertically centred, small padding, text dark grey (#37474F).
- Column widths fit the content: narrow for codes and dates, wide for text, between 110 and 420px.
- Row heights auto-fit. A fixed body row height cuts off wrapped text.
- Money columns: convert text numbers to real numbers first, then apply the currency format from local.md,
  right-aligned. A number format on text cells shows nothing.
- Pastel, readable colours only. One pastel per tab so tabs are easy to tell apart.
- Title rows above the header (if any) get a larger bold title in the tab's colour.

## How

1. Write the data.
2. Run the formatter: `python3 <skill dir>/scripts/pretty_sheet.py SPREADSHEET_ID` for all tabs, or add
   `--tab "Logs"` for one tab. Pass `--gapi <path>` (or set `GAPI_PATH`) to the install's Google API wrapper;
   agents with a sandbox wrapper pass their wrapper path. Use absolute paths: HOME can differ inside
   scheduled or sandboxed runs, so `~` may resolve to the wrong folder.
   Options: `--font`, `--money-format`, `--money-words` (comma separated header words).
3. Re-run it after adding any tab.
4. Check it visually: export the tab as PDF
   (`docs.google.com/spreadsheets/d/<id>/export?format=pdf&gid=<gid>&portrait=false&fitw=true&gridlines=false`,
   with a Bearer token from the install's Google token), render page 1 to PNG and look for cut text before you
   show the person.

## If the script is missing

Rebuild it with the same steps: per tab find the header row (first row with two or more filled cells), clear
old banding, add banding, set font and header, freeze the header, hide gridlines, set widths from content,
convert money text to numbers and format them, then auto-resize rows. Send everything as one batchUpdate.

## Pitfalls

- Header row is not always row 1. Title rows above it must not get the header style.
- Banding added twice fails. Delete existing banded ranges first (the script does).
- Writing by a remembered column letter breaks when someone adds a column. Read the header row and map by name.
- Number formats only work on real numbers. Convert first, then format.
