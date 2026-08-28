# Lead domain validation service

Scores an inbound lead from the `newbusiness@houseofmarketers.com` enquiry forms
so the Discord triage card can show whether it is worth a salesperson's time.

Runs entirely on **free** checks by default: DNS-over-HTTPS lookups, a real
live-site check, a synced disposable-domain blocklist, and a deterministic
form-quality heuristic. No API key, no account, no per-lookup cost. A paid
verifier can be switched on later through environment variables alone.

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

## The live-site check

DNS resolution proves a domain is *registered*. It does not prove a website is
*there* — parked domains, dead hosts and abandoned projects all have perfectly
good A records. So the service fetches the homepage and classifies what comes
back:

| `website.liveness` | Meaning | Weight |
|---|---|---|
| `live` | A real page is served | **−10** |
| `protected` | A server answered but blocked the automated check (403/429/503) | 0 |
| `placeholder` | "Coming soon", a default nginx/Apache page, or near-empty markup | 20 |
| `http_error` | 404, 410, 5xx | 20 |
| `parked` | Redirects to a domain-parking host, or the page offers the domain for sale | 35 |
| `unreachable` | Resolves in DNS, but nothing answers on HTTPS or HTTP | 30 |

Three of these — `parked`, `unreachable`, and a stated website absent from DNS
entirely — also **cap the verdict at `suspicious`**. A company with no working
website is never a confirmed prospect, however well the rest of the form reads.

**`protected` is deliberately neutral.** Cloudflare, Akamai and similar WAFs
routinely serve 403 to an unrecognised client, and plenty of real company sites
sit behind them. Counting that as "dead" would reject genuine leads, so it earns
neither credit nor blame and says so in the reasons.

When the website field is junk but the email is on a company domain, that domain
is checked as the implied website — reported as `inferredFromEmailDomain: true`.
Because it is our guess rather than their claim, it carries half weight and
never caps the verdict.

Set `WEBSITE_LIVENESS_ENABLED=false` to fall back to DNS-only.

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
    "raw": "url",
    "hostname": null,
    "parsed": false,
    "resolves": false,        // exists in DNS
    "liveness": null,         // whether a site is actually served
    "httpStatus": null,
    "finalUrl": null,         // after redirects — exposes parking redirects
    "inferredFromEmailDomain": false,
    "matchesEmailDomain": false
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
| `website_parked` | 35 | `suspicious` |
| `website_unreachable` | 30 | `suspicious` |
| `website_does_not_resolve` | 25 | `suspicious` |

These are rules rather than weights a long enquiry could outweigh. A personal
mailbox can never make a lead a *confirmed company contact*, and a company with
no working website is never a confirmed prospect. The three website caps apply
only to a site the person actually stated, never to one inferred from their
email domain.

**Weighted signals:**

| Signal | Weight |
|---|---|
| `website_parked` | 35 |
| `website_not_a_url` | 30 |
| `website_unreachable` | 30 |
| `email_domain_no_mx` (A record only — RFC 5321 fallback, so doubt not death) | 25 |
| `website_does_not_resolve` | 25 |
| `website_placeholder` | 20 |
| `website_http_error` | 20 |
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
| `website_protected` (responded but blocked us — neutral on purpose) | 0 |
| `email_matches_website` | **−15** (the strongest free positive) |
| `website_live` | **−10** |
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
npm test             # 65 tests, no network required
npm run typecheck
```

The suite is hermetic: DNS and liveness are fixture tables and the blocklist
runs from its bundled seed. To exercise the real resolvers:

```bash
LIVE_DNS_TEST=true npx vitest run test/live.dns.test.ts
```

## Connecting the leads inbox

`docs/GMAIL_SETUP.md` is the click-by-click guide to producing
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`, and
`scripts/get-gmail-refresh-token.mjs` does the token exchange.

## Notes

- The disposable blocklist is fetched from
  [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
  at boot and every 24h, with its `allowlist.conf` applied so legitimate
  providers caught by the community list are rescued. A fetch that returns
  implausibly few domains is rejected rather than allowed to shrink the list,
  and a failed fetch keeps the previous one.
- DNS answers are cached in memory for an hour and concurrent lookups for the
  same domain are collapsed into one query.
- The live-site check reads at most 64 KB of the homepage and gives up after
  `WEBSITE_TIMEOUT_MS` (default 6s), so a hanging site cannot stall a lead.
- The service is stateless — scale it to as many replicas as you like.
