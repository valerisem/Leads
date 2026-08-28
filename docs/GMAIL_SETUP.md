# Connecting the leads inbox — push, not polling

Ranked by least work. All three deliver the lead the moment it is submitted.

| | Effort | Gmail involved |
|---|---|---|
| **1. Salesmate webhook** | ~2 min | No |
| **2. Extra recipient on the Salesmate form** | ~5 min | No |
| **3. Gmail filter → forward** | ~10 min | Yes |

---

## 1. Salesmate native webhook

**Settings → Web Forms** (or the automation / journey builder) → look for a
webhook action. If it is there, point it at `POST /ingest/form` and stop — you
get structured JSON and email never enters the picture.

I could not confirm from the public docs that your plan exposes this for these
forms, so it is a check, not a promise.

## 2. Add an inbound address as a form recipient — recommended fallback

The notification already goes to `chris@`, `newbusiness@` and `inigo@`, set in
Salesmate's form settings. Add a fourth recipient that turns email into a
webhook. Instant, and it touches nothing about Gmail.

**a.** Get a free inbound address — no DNS setup with any of these:

| Service | Free tier | Address you get |
|---|---|---|
| [CloudMailin](https://www.cloudmailin.com/) | 200/mo | `…@cloudmailin.net` |
| [Postmark](https://postmarkapp.com/) inbound | 100/mo | `…@inbound.postmarkapp.com` |
| [Make.com](https://www.make.com/) mailhook | 1,000 ops/mo | `…@mailhook.integromat.com` |

**b.** Point it at `https://<service>.up.railway.app/ingest/email` with the
`x-api-key` header.

**c.** Salesmate → the form → **form settings** → add that address to the
notification recipients. Save.

Done. The next submission arrives in under a second.

## 3. Gmail filter → forward

Use this only if you cannot edit the Salesmate recipients.

Gmail (as `newbusiness@`) → **Settings → Forwarding and POP/IMAP → Add a
forwarding address** → paste the inbound address. Gmail emails it a
confirmation code; read the code out of the webhook service's log and enter it.

Then **Settings → Filters → Create a new filter**:

- From: `noreply@salesmatemail.com`
- Subject: `New Submission`
- → **Forward it to** that address

The extra step is only Gmail's forwarding-address verification.

---

## Polling fallback

[`scripts/apps-script/`](../scripts/apps-script/) polls the mailbox every 5
minutes with no external service at all. Slower and not a trigger — keep it only
if all three options above are blocked.

## The full Gmail API + OAuth route

Only worth it if you want the ingest entirely inside this repo and under CI.
`scripts/get-gmail-refresh-token.mjs` mints the token; create an **Internal**
OAuth consent screen and a **Desktop app** client in Google Cloud first. An
External app left in *Testing* issues refresh tokens that expire after 7 days.
