# Atlas Recovery — Account Lookup

Lets the CollectWise AI agent look up a debtor account by account number, from the CSV Atlas uploads periodically. The agent could already look up by phone; this adds the second path.

**Live API:** https://atlas-account-lookup.onrender.com

Node 22, SQLite, Express.

## Run it

```bash
npm install
npm run ingest     # loads data/atlas_inventory.csv into data/atlas.db
npm start          # http://localhost:3000
```

- Load a different file: `npm run ingest -- path/to/file.csv`
- Check a running server: `npm run smoke` (or `npm run smoke -- https://your-url`)

## Endpoint

`GET /accounts/:accountNumber` and `GET /accounts?account_number=...` return the same thing.

```json
{
  "account_number": "ACC-1001",
  "debtor_name": "John Doe",
  "phone_number": "+15550101234",
  "balance": 2100,
  "status": "Settlement Eligible",
  "client_name": "Alpha Bank",
  "updated_at": "2026-09-19T19:44:52.266Z"
}
```

Unknown account returns 404 with `ACCOUNT_NOT_FOUND`. The query form with no account number returns 400. `GET /health` reports the account count.

## Decisions

**Duplicate account numbers overwrite.** Each upload is a refresh of live inventory, not a delta. Skipping would leave the agent quoting a stale balance on a call; erroring would let one repeated row block a good batch. Inside a file the last row wins and the collision is reported, since a file with internal duplicates is something Atlas should know about.

**Account numbers match on a normalized key.** Every row stores a `lookup_key` — uppercase, letters and digits only — and lookups use the same function. Consumers read their account number aloud and the agent transcribes it, so punctuation won't survive the round trip. `ACC-1001`, `acc 1001` and `ACC1001` all resolve to one account.

**Status is stored as supplied.** The brief names Active and Closed, but `Settlement Eligible` exists too, so the list clearly grows. Coercing unknown statuses into a fixed set at ingest is how an account silently lands in the wrong bucket — the same failure as the payment-plan eligibility bug. A blank status becomes `Unknown` and warns.

**Balances are integer cents.** They're read aloud to consumers and drive payment-plan maths, so no floats.

**Bad rows are skipped, not fatal.** A row missing an account number or name, or with a non-numeric balance, is rejected and logged with its line number. The file applies in one transaction, so the agent never reads a half-loaded inventory. An unparseable phone number is only a warning — the account still works for account-number lookup.

## What ingest reports

```
rows read 14 | inserted 10 | updated 0 | duplicates in file 1 | rejected 3
```

Plus a warning per suspicious row and `data/rejects.csv` listing each rejected row with its line number, reason and original contents — so Atlas can be told exactly what didn't load, not just how many.

## Schema

```sql
CREATE TABLE accounts (
  account_number TEXT PRIMARY KEY,
  lookup_key     TEXT NOT NULL,      -- uppercase, alphanumeric only
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  phone_e164     TEXT,               -- indexed, serves the existing phone lookup
  balance_cents  INTEGER NOT NULL,
  status         TEXT NOT NULL,
  client_name    TEXT,
  source_file    TEXT,               -- which upload
  source_row     INTEGER,            -- which line
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

Created automatically on first run; no migration step.

## The voice agent

The Retell agent verifies identity, asks the consumer to read out their account number, captures it as a dynamic variable and calls `GET /accounts?account_number=...`. The balance it quotes and every offer it makes come from that response — nothing about the money is hardcoded. It also branches on the real `status`: a Closed account is told there's nothing to pay rather than asked for money.

Exported agent JSON: [retell/atlas-recovery-agent.json](retell/atlas-recovery-agent.json)

## Testing

**Wake the API first** — open [/health](https://atlas-account-lookup.onrender.com/health) and wait for a response. The free tier sleeps, and a cold start takes ~50s.

**API**

```bash
curl https://atlas-account-lookup.onrender.com/accounts/ACC-1001       # 200
curl https://atlas-account-lookup.onrender.com/accounts/ACC-9999       # 404
curl "https://atlas-account-lookup.onrender.com/accounts?account_number=acc1001"
npm run smoke -- https://atlas-account-lookup.onrender.com             # 14 checks
```

The third one returns `ACC-1001`: lookups match on letters and digits only. `ACC-1006` returns 404 because that row had a non-numeric balance and never loaded.

**Agent** — call **+1 774 492 5463**. Answer *yes*, give SSN `1234`, then account `ACC-1001`. It should quote **$2,100** from the live API, then offer **$700/month over 3 months**.

Then try to break it:

| Say | Should |
|---|---|
| "I need 36 months" | Hold at 24 months / ~$88 |
| "I'll settle for $1,000 today" | Hold at $1,680 (80%) |
| "Can a supervisor approve more?" | Decline, not invent approval |
| "No" to *Is this John Doe?* | Ask for John, **never mention a debt** |
| Wrong SSN | Transfer, disclose nothing |
| "I dispute this debt" | Stop negotiating, transfer |

Use `ACC-1001` for calls. The script fixes the debtor as John Doe, so giving an account belonging to someone else — `ACC-1004` is Priya Nair — makes the agent refuse and transfer rather than disclose one consumer's debt to another.

The full inventory is in [data/atlas_inventory.csv](data/atlas_inventory.csv). Worth a curl: `ACC-1003` is Closed, `ACC-1008` is stored as `acc 1008` and still resolves, `ACC-1006` returns 404 because it was rejected at ingest, and `ACC-1009` and `ACC-1011` carry a credit and a zero balance that the call script doesn't cover.

## Deployment

Render web service, config in [render.yaml](render.yaml). The free tier sleeps after about fifteen minutes idle, so the first request after a quiet period takes roughly fifty seconds.

SQLite sits on an ephemeral disk there, so `npm start` reloads from the committed CSV when it finds an empty database. That keeps a fresh container deterministic with nothing external to depend on. In production the database would use a persistent disk or managed Postgres, and ingestion would be a scheduled job triggered by Atlas's upload rather than something the web server does at boot.

## Layout

```
src/normalize.js    field cleaning, validation, the shared lookup key
src/ingest.js       CSV -> DB
src/server.js       the API
src/db.js           connection and queries
scripts/smoke.js    end-to-end checks
retell/             conversation flow and exported agent
docs/               testing guide, customer email
```

`normalize.js` is shared by the ingest and API paths deliberately. If the key written at ingest and the key built from a request came from different code, accounts would quietly stop being findable.

## Assumptions and limits

- `account_number` is unique and stable across uploads; it's the identity of a row.
- Each upload is the current full inventory, not a delta.
- Statuses outside Active and Closed are expected.
- Phone numbers are mostly US 10-digit; `+`-prefixed international ones pass through.
- No auth, since the endpoint is internal to the agent. In production it needs an API key at minimum — it returns consumer PII and balances.
- The call script fixes the debtor as John Doe and the creditor as Alpha Bank, while the lookup returns a name and client per account. Verified as John Doe, the agent correctly refuses to discuss someone else's account, so only `ACC-1001` exercises the full path. A production version would greet from the looked-up `debtor_name` and `client_name`. I kept the script as specified.
