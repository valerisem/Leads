# Lead domain validation service

Scores an inbound lead from the `newbusiness@houseofmarketers.com` enquiry forms
so the Discord triage card can show whether it is worth a salesperson's time.

Runs entirely on **free** checks by default: DNS-over-HTTPS lookups, a synced
disposable-domain blocklist, and a deterministic form-quality heuristic. No API
key, no account, no per-lookup cost. A paid verifier can be switched on later
through environment variables alone.

## Why the form-quality check exists

The obvious approach — verify the email address — is not enough. A real
submission from the GAds form looked like this:

| Field | Value |
|---|---|
| Email Address | `alexandra.mus@icloud.com` |
| Company Name | `Alexandra` |
| Company Website | `url` |
| How can we help | `idk` |
| Budget | Below $10k |

`icloud.com` has perfectly valid MX records, so **every deliverability check
passes** and every paid email-verification API would call this address good. The
lead is still junk. So the service scores the *submission* alongside the domain:

```
verdict: invalid | score: 10
  - icloud.com is a personal mailbox provider, not a company domain
  - Company website "url" is not a real web address
  - Company name "Alexandra" is just the contact's own name
  - Enquiry text "idk" says nothing about the need
  - Budget is the lowest band (Below $10k)
```

It **flags rather than rejects**. An `idk` from a real brand is still worth a
human glance, so the lead is still created in Pipedrive — the verdict just
decides how the Discord card is framed.

## API

### `POST /validate`

```jsonc
{
  "email":          "alexandra.mus@icloud.com",
  "fullName":       "Alexandra Musorin",
  "companyName":    "Alexandra",
  "companyWebsite": "url",
  "message":        "idk",        // the "How can we help" answer
  "budget":         "Below $10k",
  "phone":          "01701850156",
  "country":        "Cyprus"
}
```

Every field is optional, so a form variation missing a field still validates.

```jsonc
{
  "verdict": "invalid",           // valid | suspicious | invalid
  "score": 10,                    // 0-100
  "email": {
    "address": "alexandra.mus@icloud.com",
    "domain": "icloud.com",
    "deliverability": "deliverable",   // about the ADDRESS, not the lead
    "hasMx": true,
    "hasAddressRecord": true,
    "isDisposable": false,
    "isFreeProvider": true,
    "isRoleAccount": false
  },
  "website": {
    "raw": "url", "hostname": null, "parsed": false,
    "resolves": false, "matchesEmailDomain": false
  },
  "signals": [
    { "code": "email_free_provider", "label": "…", "severity": "major", "weight": 20,
      "capsVerdictAt": "suspicious" }
  ],
  "reasons": ["…"],               // just the labels, for rendering
  "checkedAt": "2026-08-28T13:00:54.743Z"
}
```

Note `email.deliverability` and `verdict` answer different questions. The
address above is genuinely deliverable; the lead is still invalid.

### `POST /validate/batch`

`{ "leads": [ … ] }`, up to 50. Returns `{ "results": [ … ] }`.

### `GET /health`

Always reachable without a key, so Railway can probe it. Reports how many
disposable domains are loaded and when the list last refreshed.

## How the verdict is reached

Start at 100 and subtract for each signal.

**Hard signals** — force `invalid` on their own, whatever else is good:

| Signal | Meaning |
|---|---|
| `email_syntax_invalid` | Not a usable address |
| `email_disposable` | Domain is on the throwaway-provider blocklist |
| `email_domain_no_records` | No MX *and* no A/AAAA — the domain cannot receive mail |
| `tier1_undeliverable` | The hosted verifier says the mailbox does not exist |

**Capping signals** — put a ceiling on the verdict regardless of score:

| Signal | Weight | Caps at |
|---|---|---|
| `email_free_provider` | 20 | `suspicious` |

A personal mailbox can never make a lead a *confirmed company contact*, however
well the rest of the form reads, so this is a rule rather than a weight that a
long enquiry could outweigh.

**Weighted signals:**

| Signal | Weight |
|---|---|
| `website_not_a_url` | 30 |
| `email_domain_no_mx` (A record only — RFC 5321 fallback, so doubt not death) | 25 |
| `website_does_not_resolve` | 25 |
| `company_name_is_person_name` | 20 |
| `website_missing` | 20 |
| `company_name_missing` | 15 |
| `message_no_information` (`idk`, `n/a`, `test`…) | 15 |
| `message_missing` | 10 |
| `message_very_short` | 8 |
| `tier1_catch_all` | 8 |
| `email_role_account` (`info@`, `sales@`) | 5 |
| `full_name_single_word` | 5 |
| `budget_lowest_band` | 5 |
| `dns_lookup_failed` / `website_lookup_failed` | 5 |
| `phone_missing` | 3 |
| `email_matches_website` | **−15** (the strongest free positive) |
| `message_detailed` | **−5** |

Then: `score ≥ 70` → `valid`, `≥ 40` → `suspicious`, below → `invalid`. Both
thresholds are environment variables.

A resolver outage produces `dns_lookup_failed` (weight 5) rather than a
rejection — a lead is never penalised for our own network trouble.

## Deploying to Railway

The repo is Railway-ready: `railway.json` pins the build and start commands and
points the healthcheck at `/health`.

1. Railway → New Project → **Deploy from GitHub repo** → this repo.
2. Railway injects `PORT`; the service reads it. Nothing else is required.
3. Set `API_KEY` to a long random string so the endpoint is not open, and send
   it as `x-api-key` from the ingest function.
4. Generate a domain (Settings → Networking) and check `/health`.

Optional variables are listed in `.env.example`.

### Turning on the paid tier later

```
EMAIL_VERIFY_PROVIDER=abstract     # or checkmail
EMAIL_VERIFY_API_KEY=…
```

It is consulted **only** when the free checks cannot decide — the address has
MX, is not disposable and is not a free provider — so the quota is spent on
genuinely ambiguous leads. A Tier 1 outage degrades to the free result instead
of failing the request.

## Local development

```bash
npm install
npm run dev          # tsx watch on :8080
npm test             # 52 tests, no network required
npm run typecheck
```

The suite is hermetic: DNS is a fixture table and the blocklist runs from its
bundled seed. To exercise the real resolvers:

```bash
LIVE_DNS_TEST=true npx vitest run test/live.dns.test.ts
```

## Notes

- The disposable blocklist is fetched from
  [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
  at boot and every 24h, with its `allowlist.conf` applied so legitimate
  providers caught by the community list are rescued. A fetch that returns
  implausibly few domains is rejected rather than allowed to shrink the list,
  and a failed fetch keeps the previous one.
- DNS answers are cached in memory for an hour and concurrent lookups for the
  same domain are collapsed into one query.
- The service is stateless — scale it to as many replicas as you like.
