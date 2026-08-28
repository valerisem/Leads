# The easy way to connect the leads inbox

About **5 minutes**. No Google Cloud project, no OAuth client, no consent
screen, no Workspace admin, and no credentials to move around.

The script lives inside `newbusiness@houseofmarketers.com` and already has
access to that mailbox, which is what removes all the setup — the whole point of
the OAuth dance is granting an *outside* application access, and there is no
outside application here.

## Setup

**1.** Sign into Google as **`newbusiness@houseofmarketers.com`**. This is the
one step that matters — the script reads whichever mailbox it is created in.

**2.** Go to **https://script.google.com** → **New project**.

**3.** Delete the sample code in `Code.gs` and paste in the contents of
[`Code.gs`](./Code.gs) from this folder.

**4.** Name the project (top left) `HoM Lead Forwarder`.

**5.** Left sidebar → **Project Settings** (the gear) → scroll to **Script
Properties** → **Add script property**, twice:

| Property | Value |
|---|---|
| `ENDPOINT_URL` | The ingest URL, e.g. `https://<your-app>.up.railway.app/ingest/email` |
| `SHARED_SECRET` | The same string as the service's `API_KEY` |

**6.** Back in the editor, pick **`dryRun`** from the function dropdown at the
top and click **Run**.

Google asks for authorization the first time: **Review permissions** → choose
the `newbusiness@` account → **Allow**. It is your own script in your own
account, so there is no verification review and no admin involved.

Check the execution log — it prints how many lead emails matched. Nothing has
been sent yet.

**7.** Pick **`installTrigger`** from the dropdown and click **Run**. Done: it
now checks every 5 minutes.

## Checking on it

- **Executions** in the left sidebar shows every run, with logs and errors.
- Forwarded mail gets a **`pipedrive-sent`** Gmail label, so you can see exactly
  what has been through the pipeline by opening that label in Gmail.
- `dryRun` shows what the next run would pick up.
- `resetLabel` strips the label so everything re-sends — handy while testing,
  not something to run in normal operation.

## How it avoids duplicates

The Gmail label *is* the state. The search query excludes anything already
labelled, and a thread is labelled only once every message in it has been
accepted with a 2xx. So a failed run, a deploy, or a restart just means the same
mail is retried next time — never sent twice, never skipped.

## What it sends

```jsonc
{
  "messageId":  "18f2a…",     // Gmail's id — the pipeline's idempotency key
  "threadId":   "18f2a…",
  "from":       "Salesmate <noreply@salesmatemail.com>",
  "to":         "newbusiness@houseofmarketers.com",
  "subject":    "GAds Brand Enquiry Contact Form - New Submission [903]",
  "receivedAt": "2026-08-28T11:57:00.000Z",
  "plainBody":  "Full Name:\nAlexandra Musorin\n…",
  "htmlBody":   "<html>…"
}
```

with `x-api-key: <SHARED_SECRET>` as a header. The ingest service parses the
`Label: value` pairs out of `plainBody`.

## The trade-offs, honestly

**Good:** trivial setup, no admin, no secrets in transit, visible audit trail in
Gmail, and the Executions view makes failures obvious.

**Less good:** the script lives in Google rather than in this repo, so it is not
version-controlled or covered by CI — the copy here is the source of truth and
has to be pasted across by hand when it changes. It is also **tied to the
account that created it**: if `newbusiness@` is ever deleted or locked, the
forwarder stops. And Apps Script triggers can be delayed by a few minutes under
load, so treat 5 minutes as "usually" rather than a guarantee.

For a lead pipeline none of that is serious. If it ever becomes so, the OAuth
route in [`docs/GMAIL_SETUP.md`](../../docs/GMAIL_SETUP.md) is the sturdier
long-term answer, and the ingest service does not change either way — it
receives the same payload.
