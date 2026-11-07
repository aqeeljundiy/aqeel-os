---
name: product-pricing
description: Use when setting or reviewing product prices, cost of goods or margins. Works cost per unit from real orders, applies the margin rule and checks competitors.
---

# Product pricing and margins

Where the numbers live, the margin rule, the rounding rule, currency and competitor list are in references/local.md next to this skill (kept on this server, never shared). Read it first. Example of what it holds:

```
Cost source: Google Sheet "Acme Master", tab Supplier Orders (price per unit, shipping, rate)
Fallback cost: tab Supplier Pricelist
Retail prices: sheet "Acme Pricing", tab Live Prices
Currency: USD. Supplier currency: EUR
Margin floor: 70% gross. Exceptions: Product C may go to 60%
Rounding: up to the next .99
Brands: Acme (main), Acme Lite (budget, always below Acme)
Competitors: competitor-a.com/shop, competitor-b.com/products
```

## Rule one: look before you ask
The owner expects you to know the cost sheets. Asking for a cost that is already in a sheet is a mistake. Find the files, read them, and ask only for what is truly missing.

## Cost per unit
1. Use the latest actual order price per unit for the item. If it has never been ordered, use the supplier price list.
2. Add the shipping share: the shipping line divided by the goods total of the last order, applied to the unit cost.
3. Convert currency at the order's own rate, or the rate on the payment date. Never a flat guess.
4. Say clearly that this is gross margin only. It leaves out labels, delivery, ads, payroll and payment fees unless local.md says to include them.
5. Flag anomalies instead of using them silently: a bigger size cheaper than a smaller one, a cost far from the last order, a missing rate.

## Price from the margin rule
- Price = the higher of the reference price and cost / (1 - margin floor). With a 70% floor that is cost / 0.30.
- Apply the rounding rule from local.md after the margin, always rounding up.
- Approved exceptions (for example high-cost items allowed a lower margin to stay competitive) are listed in local.md. Do not invent new ones.
- Compute every number with a tool, never in your head.

## Show the result
Per item: cost, price, margin in money, margin in percent. Group items as "kept" and "raised to the floor". Use bullets in chat, not tables, if the owner reads on a phone.

When asked what one brand makes, report it on its own (price, profit, percent, average per unit, monthly profit at N customers a day) without comparing to other brands unless asked.

## Cross-brand and size checks
Always flag:
- A budget brand priced at or near the main brand.
- A bigger size cheaper than a smaller one.
- An item below the margin floor.

Offer options for each: drop the item, accept it, or reprice.

## Competitor prices
- Static shops: fetch the shop page or product pages with curl. Some stores expose a JSON product feed (for example a Shopify `/products.json` or a WooCommerce store API).
- Script-rendered shops: read the page text in the browser.
- Age-gated shops: try the age cookie with curl first, it is faster than the form.
- Get product URLs from sitemap.xml or llms.txt and fetch them in parallel.
- Per-size prices often sit in the page's data payload, not the visible text, which shows only the default size.
- Record sitewide discount codes and bulk tiers apart from the list price.
- Save the raw scrape with the date, and say how old the numbers are when you report.

## Sheet hygiene
- The live price list lives in one sheet tab with formula columns for profit and margin. Edit there; do not recompute from memory.
- Before deleting a tab, search every related sheet for formulas that point at it, repoint or hard-code them, and back the file up first.
- "Fix all tabs" means: scan each tab for error values, fix each cause, and scan again until there are none.
- Old or test copies of a sheet are not sources. Ignore them.
