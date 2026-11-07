---
name: strategy-backtesting
description: Use when the person wants a trading strategy tested on past data. Backtest it honestly with costs and out-of-sample checks, and never place real trades.
---

# Strategy backtesting (method only)

How to test a trading strategy honestly. You only research and simulate. You never place real trades, never handle exchange keys, and never look at account balances. Going live is the person's own decision and their own setup.

The person's target and any local paths (where data and scripts live, their monthly goal) are in references/local.md next to this skill (kept on this server, never shared). Example:

```
- Target: steady monthly return, judged month by month over the last 12 months
- Work dir: <workspace>/backtests
- Paper engine: <workspace>/paper (cycle.py)
```

## Procedure
1. **Data.** Use public market data (an exchange's public candle endpoint or its bulk monthly files). Bulk files are much faster than paging a REST API for intraday data. Fetch at least 250 bars of warm-up before the test window. Stick to liquid markets.
2. **Engine rules.** Signal on bar close, fill at next bar open. Stops and targets checked inside the bar. Charge fees plus slippage on every side (start around 0.1 to 0.15% per side for spot). For perpetual futures, also charge funding. A short can reuse a long engine on inverted prices.
3. **Per-strategy report.** Trades per month, long vs short count, win rate, average win vs average loss, total return, max drawdown, and a buy-and-hold baseline.
4. **Monthly view.** Equal-weight portfolio across markets, marked to market at each month end (open trades counted). Show every month's %, green months out of 12, worst month. Build the portfolio from summed equity curves, not an average of per-market monthly %, which overstates.
5. **Out-of-sample.** Never pick a winner on the same data you report it on. Use walk-forward: pick parameters on past data only, score the next quarter, repeat. When you tried many rule sets, correct for it (deflated Sharpe, probability of backtest overfitting).
6. **Leverage.** Only multiplies an edge proven at 1x. Test liquidations on the worst crash days in the window. Charge borrow only on exposure above 1x.
7. **Paper trading first.** Anything that passes runs on paper (or an exchange test network) for 2 to 4 weeks with the same rules before anyone considers real money.
8. **Long jobs.** Run them as tracked background processes, and split big multi-family searches into parallel workers.

## Risk guardrails to propose
If the person decides to go live themselves, recommend: a trade-only key with withdrawals off, a separate sub-account, a small budget, and hard per-trade, daily and total loss stops. Ask their max drawdown and budget before any plan. A per-strategy drawdown pause beats switching strategies after a losing streak (switching often exits right before recovery).

## Lessons that tend to repeat
- Short-timeframe technical rules (minutes to an hour) usually have no edge after fees: the gross edge per trade is smaller than the cost.
- High win rate mean reversion often loses: few big losses outweigh many small wins.
- In-sample winners often fail walk-forward. A big in-sample number with a high overfitting score is a warning, not a result.
- Pairs relationships found on one quarter often do not hold the next.
- Leverage that turns a small in-sample edge into large monthly returns often liquidates out of sample.
- Copy-trading leaderboards are survivorship-biased. Vet only records of a year or more, with copiers in profit.
- A charting tool with no trading API is for charts and alerts only, not for testing.
- Public data gotchas: funding history without a start time can return old data; delisted markets can still return stale bars, so require a recent last bar.

## Reporting
Lead with whether the target is met. Then each method in plain words: what it does, trades per month, win rate, win and loss size, green months, worst month. Say plainly that very high steady monthly returns are rarely achieved and such backtests are usually overfit. Propose a realistic gate, for example: positive average, no month below -5%, at least 8 of 12 green months, in every test period. Say when a result was chosen with knowledge of the test data, because that makes it optimistic. Nothing goes live before it passes out of sample and paper trading.
