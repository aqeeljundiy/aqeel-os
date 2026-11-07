#!/usr/bin/env python3
"""Make every tab of a Google Sheet neat and readable.

Usage:
  pretty_sheet.py SPREADSHEET_ID [--tab "Name"] [--gapi /path/to/gapi.py or wrapper]
                  [--font Inter] [--money-format '"$" #,##0'] [--money-words price,amount,total]

Style: one font at size 10 (header 10 bold), a pastel header per tab, white/pastel banding, light borders,
frozen header, hidden gridlines, wrapped text, padding, column widths from content, money columns as numbers.

The Google API wrapper must accept:
  <wrapper> call sheets v4 <method> --params '<json>' [--body @file.json]
and print the JSON response. Pass it with --gapi or the GAPI_PATH environment variable.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

ap = argparse.ArgumentParser()
ap.add_argument('sid')
ap.add_argument('--tab')
ap.add_argument('--gapi', default=os.environ.get('GAPI_PATH'))
ap.add_argument('--font', default=os.environ.get('PRETTY_SHEET_FONT', 'Inter'))
ap.add_argument('--money-format', default=os.environ.get('PRETTY_SHEET_MONEY', '#,##0'))
ap.add_argument('--money-words', default=os.environ.get('PRETTY_SHEET_MONEY_WORDS', 'price,amount,total,cost,fee'))
a = ap.parse_args()
if not a.gapi or not os.path.exists(a.gapi):
    sys.exit('Google API wrapper not found: pass --gapi /absolute/path or set GAPI_PATH.')
MONEY_WORDS = [w.strip().lower() for w in a.money_words.split(',') if w.strip()]


def call(*args):
    runner = [a.gapi] if os.access(a.gapi, os.X_OK) and not a.gapi.endswith('.py') else ['python3', a.gapi]
    out = subprocess.run(runner + list(args), capture_output=True, text=True).stdout
    return json.loads(out[out.find('{'):]) if '{' in out else {}


def rgb(h):
    return {"red": int(h[0:2], 16) / 255, "green": int(h[2:4], 16) / 255, "blue": int(h[4:6], 16) / 255}


# (header colour, band colour) pairs: soft pastels that keep white header text readable.
PALETTE = [('7E9CD8', 'EEF2FB'), ('7FB77E', 'EEF6EE'), ('E8A87C', 'FDF1E8'), ('B39DDB', 'F3EEFB'),
           ('E58F9E', 'FCEEF0'), ('6CB8B4', 'EAF5F4'), ('D4B86A', 'FAF5E6'), ('90A4AE', 'EEF2F4')]
FONT = a.font
TEXT = '37474F'
LINE = 'E3E6EA'
NUM = re.compile(r'\d+(\.\d+)?')

meta = call('call', 'sheets', 'v4', 'spreadsheets.get', '--params', json.dumps(
    {'spreadsheetId': a.sid, 'fields': 'sheets(properties(sheetId,title,gridProperties),bandedRanges(bandedRangeId))'}))
R = []
for i, s in enumerate(meta.get('sheets', [])):
    p = s['properties']
    sid, title = p['sheetId'], p['title']
    if a.tab and title != a.tab:
        continue
    vals = call('call', 'sheets', 'v4', 'spreadsheets.values.get', '--params', json.dumps(
        {'spreadsheetId': a.sid, 'range': f"'{title}'!A1:Z500"})).get('values', [])
    if not vals:
        continue
    # Header row = first row with at least two filled cells.
    h = next((k for k, r in enumerate(vals) if sum(1 for c in r if str(c).strip()) >= 2), 0)
    nc = max(len(r) for r in vals)
    nr = len(vals)
    end = max(nr, h + 2) + 50
    hd, bd = PALETTE[i % len(PALETTE)]
    for b in s.get('bandedRanges', []):
        R.append({"deleteBanding": {"bandedRangeId": b['bandedRangeId']}})
    R.append({"updateSheetProperties": {"properties": {"sheetId": sid, "tabColorStyle": {"rgbColor": rgb(hd)},
              "gridProperties": {"frozenRowCount": h + 1, "hideGridlines": True}},
              "fields": "tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines"}})
    base = {"wrapStrategy": "WRAP", "verticalAlignment": "MIDDLE",
            "padding": {"top": 5, "bottom": 5, "left": 8, "right": 8},
            "textFormat": {"fontFamily": FONT, "fontSize": 10, "foregroundColor": rgb(TEXT), "bold": False}}
    R.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": end,
              "startColumnIndex": 0, "endColumnIndex": nc}, "cell": {"userEnteredFormat": base},
              "fields": "userEnteredFormat(wrapStrategy,verticalAlignment,padding,textFormat)"}})
    if h > 0:  # title rows above the header
        R.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1,
                  "startColumnIndex": 0, "endColumnIndex": 1}, "cell": {"userEnteredFormat": {
                  "wrapStrategy": "OVERFLOW_CELL", "textFormat": {"fontFamily": FONT, "fontSize": 14, "bold": True,
                  "foregroundColor": rgb(hd)}}}, "fields": "userEnteredFormat(wrapStrategy,textFormat)"}})
    R.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": h, "endRowIndex": h + 1,
              "startColumnIndex": 0, "endColumnIndex": nc}, "cell": {"userEnteredFormat": {
              "backgroundColor": rgb(hd), "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE",
              "wrapStrategy": "WRAP", "padding": {"top": 7, "bottom": 7, "left": 8, "right": 8},
              "textFormat": {"fontFamily": FONT, "fontSize": 10, "bold": True, "foregroundColor": rgb('FFFFFF')}}},
              "fields": "userEnteredFormat"}})
    R.append({"addBanding": {"bandedRange": {"range": {"sheetId": sid, "startRowIndex": h + 1, "endRowIndex": end,
              "startColumnIndex": 0, "endColumnIndex": nc}, "rowProperties": {
              "firstBandColorStyle": {"rgbColor": rgb('FFFFFF')}, "secondBandColorStyle": {"rgbColor": rgb(bd)}}}}})
    R.append({"updateBorders": {"range": {"sheetId": sid, "startRowIndex": h, "endRowIndex": max(nr, h + 1),
              "startColumnIndex": 0, "endColumnIndex": nc},
              "innerHorizontal": {"style": "SOLID", "colorStyle": {"rgbColor": rgb(LINE)}},
              "bottom": {"style": "SOLID", "colorStyle": {"rgbColor": rgb(LINE)}}}})
    # First column a little stronger, so each row has a clear label.
    R.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": h + 1, "endRowIndex": end,
              "startColumnIndex": 0, "endColumnIndex": 1}, "cell": {"userEnteredFormat": {"textFormat": {
              "fontFamily": FONT, "fontSize": 10, "bold": True, "foregroundColor": rgb('263238')}}},
              "fields": "userEnteredFormat.textFormat"}})
    for c in range(nc):
        col = [str(r[c]) for r in vals[h:] if len(r) > c and str(r[c]).strip()]
        lens = sorted(len(x) for x in col) or [8]
        head = str(vals[h][c]) if len(vals[h]) > c else ''
        typical = max(lens[int(len(lens) * 0.9)] if len(lens) > 1 else lens[0], len(head) // 2 + 4)
        width = max(110, min(420, int(typical * 7.4) + 28))
        R.append({"updateDimensionProperties": {"range": {"sheetId": sid, "dimension": "COLUMNS",
                  "startIndex": c, "endIndex": c + 1}, "properties": {"pixelSize": width}, "fields": "pixelSize"}})
        body = col[1:]
        nums = [x for x in body if NUM.fullmatch(x)]
        if body and len(nums) >= 0.7 * len(body) and any(w in head.lower() for w in MONEY_WORDS):
            for ri in range(h + 1, nr):
                v = vals[ri][c] if len(vals[ri]) > c else ''
                if NUM.fullmatch(str(v)):
                    R.append({"updateCells": {"range": {"sheetId": sid, "startRowIndex": ri, "endRowIndex": ri + 1,
                              "startColumnIndex": c, "endColumnIndex": c + 1},
                              "rows": [{"values": [{"userEnteredValue": {"numberValue": float(v)}}]}],
                              "fields": "userEnteredValue"}})
            R.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": h + 1, "endRowIndex": end,
                      "startColumnIndex": c, "endColumnIndex": c + 1}, "cell": {"userEnteredFormat": {
                      "numberFormat": {"type": "NUMBER", "pattern": a.money_format}, "horizontalAlignment": "RIGHT"}},
                      "fields": "userEnteredFormat(numberFormat,horizontalAlignment)"}})
    R.append({"autoResizeDimensions": {"dimensions": {"sheetId": sid, "dimension": "ROWS",
              "startIndex": h, "endIndex": max(nr, h + 2)}}})
    print('styled', title, 'header row', h + 1, 'cols', nc, 'rows', nr)

if R:
    f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
    json.dump({"requests": R}, f)
    f.close()
    out = call('call', 'sheets', 'v4', 'spreadsheets.batchUpdate', '--params', json.dumps({'spreadsheetId': a.sid}),
               '--body', '@' + f.name)
    os.unlink(f.name)
    print('OK' if 'replies' in out else 'ERROR ' + json.dumps(out)[:400])
else:
    print('Nothing to style.')
