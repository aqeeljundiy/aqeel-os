---
name: statement-processing
description: Use when bank, card or payment statements arrive for the finance workbook. Imports them once, dedupes, categorises, matches transfers and flags what needs a person.
---

# Statement processing

The workbook, its tabs, the accounts and where each statement comes from, the books (for example Personal and Business), vendor rules and file passwords are in references/local.md next to this skill (kept on this server, never shared). Read it first. Example of what it holds:

```
Workbook: Google Sheet "Acme Finance", tabs Journal, Vendor Directory, Index, Business Journal, AI Log
Books: Personal, Main Business, Side Business
Accounts:
  Bank A checking: PDF by email from statements@bank-a.example around the 1st, password in the secret store
  Card B: PDF uploaded by the owner, cut-off on the 26th
  Payment gateway: CSV export from the dashboard
Vendor rules: Vendor X refunds are shared software; Vendor Y above 1,000 is payroll
Time zone: UTC+7
```

This is an on-demand job run when statements arrive. Never claim it runs by itself in the background.

## Before you start
- Read the live workbook every run: tab list, headers, dropdown options, formulas and the Vendor Directory with its notes. Never trust remembered column positions or row numbers.
- Check the mailbox (all folders, including trash and spam) and the latest Journal date per account before asking the owner to upload. Then ask only for what is truly missing and say where each account currently stops.
- Open protected PDFs with the password from the secret store. Chat apps resend the same files: recognise repeats by name and say you already have them.

## Steps
1. List the statements by account, period, currency and coverage. Keep for each row: source file, account, transaction ID, date, exact amount, original description, running balance.
2. Reconcile per account: opening balance + credits - debits = closing balance. If an account is missing, finish the others and say coverage is incomplete.
3. Dedupe by source transaction ID before importing. Reruns must add nothing. Same date and amount alone is not a duplicate: separate IDs, fees, reversals and repeat purchases are real.
4. Categorise. The owner's notes in the Vendor Directory come first, then receipts and transaction notes, then vendor defaults. Match vendor and flow (in or out). Keep the raw description. Never replace the owner's context with a guess.
5. Fill flow, inflow type (income, refund, reimbursement, other), category, book, reporting month and status. Amounts stay positive in the Journal and keep the real cash date. Use only allowed dropdown values.
6. Match transfers between own accounts, cards and the payment gateway by reference, amount and date, allowing for fees and timing. Transfers are money movement, not income or spending. Keep the fees. Gateway settlements must not double count the sales behind them.
7. Refunds and reimbursements reduce the related expense, not revenue. Card repayments and temporary holds are money movement.
8. Payroll paid early in a month belongs to the month before by default, unless there is evidence of the service period. Keep the cash date as it is.
9. Foreign currency: use the bank-settled amount if shown, otherwise the rate on the transaction date with its source. Flag a missing rate instead of using today's rate.
10. Before posting to business reports, compare with earlier monthly summaries and prior imports. Never add detail on top of totals already migrated. Upsert by a stable key such as `account | source transaction ID`, never a plain append.
11. Read everything back: row counts, sums, dropdowns, formulas, no error cells. Classification must not change cash totals: compare before and after.

## Flags and queues
- Potential Overlaps: possible double counting against summaries, payroll or prior imports.
- Needs Categorization: unknown purpose or unknown book.
- Keep the owner's answers column on every rerun. Keep resolved rows as history. Resolve only after checking the Journal and reports, not because a status was changed.
- Unknown small purchases may go to Miscellaneous with "purpose unknown". Never use that for an unknown transfer, customer receipt or payroll amount.
- A transaction-specific or tentative answer from the owner is not a new vendor default. Paying from a personal card is not proof of personal purpose.
- Do not move notes or delete same-amount rows on a hunch. Keep the exception open until the source proves the fix.

## Receipts
When a receipt check is allowed, search the mailbox in all folders, match booking ID, amount and date, and tell a bank charge notice apart from the actual receipt. Read only: never restore, delete or send mail. Leave unmatched charges open rather than guessing by amount.

## Audit log
Append each meaningful step to the AI Log: date and time, step, sheet and range, before, after, reason and evidence, result. Record unresolved items and failed checks honestly. Mark a step verified only after read-back. Do not create duplicate entries on resumed runs.

## Report
End with: rows imported per account, duplicates skipped, transfers matched, report status, missing statements and a short exception list. Ask only questions the workbook, statements, receipts and existing notes cannot answer. Never call a month final while payroll or an account's coverage is missing.
