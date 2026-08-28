# Inbound Leads → Pipedrive → Discord triage

## Context

New leads arrive by email. Today they are handled manually: someone reads the inbox,
decides whether the lead is real, creates it in Pipedrive, and works out who should own it.

This pipeline automates the mechanical parts and leaves the two human judgements —
*is this junk?* and *who owns it?* — as one Discord card with two controls:

- an **Assign owner** dropdown that writes the owner back to Pipedrive and opens a note box,
  creating a Pipedrive Activity assigned to that person, and
- an **Ignore** button that is entirely optional (a card nobody touches is simply left alone).

Everything else — parsing the email, validating the sender's domain, creating the
Organization / Person / Lead in Pipedrive — happens automatically before the card is posted.

---

## What already exists (verified)

| Thing | Where | Notes |
|---|---|---|
| `team` table with `pd_id` + `discord_id` | Supabase project **Team** (`tciqyupqtpbhremuprxe`) | `pd_id` **is** the Pipedrive user id — confirmed against live leads (`owner_id: 23072424` = Inigo, `23093412` = Ritchie, `23093401` = Valeriia) |
| `discord_interactions` edge function | same project | Existing Monday.com approve/decline handler. Useful as a shape reference, **but see the two defects below** |
| Pipedrive account | `Pipedrive` MCP / REST | Leads API in use; leads carry `owner_id`, `organization_id`, `person_id`, `is_archived`, `label_ids` |
| Railway `Outreach prod` | Railway | Redis + Postgres + `HoM` service. Not needed for this. |
| Discord channel `1489334181405266083` | Discord | Existing channel, reused for the lead cards |

Nothing lead-related, Discord-config-related or Pipedrive-sync-related exists in the
database yet — this feature is greenfield.

### Two defects in the existing `discord_interactions` function to *not* copy

1. It is deployed with **`verify_jwt: true`**. Discord does not send a Supabase JWT, so
   Discord can never call it directly. The new function must be deployed with
   `verify_jwt: false`.
2. It does **no Ed25519 signature verification**. Discord will not even accept an
   interactions endpoint URL that fails its verification handshake, and without it the
   endpoint is world-writable — anyone who learns the URL can reassign leads.

---

## Assignee dropdown — resolved

Exactly three people can be assigned a lead. All three have a Pipedrive user id, so the
dropdown works with no outstanding gaps:

| Person | Role | `team.id` | Pipedrive `pd_id` | Discord id |
|---|---|---|---|---|
| Carrick Klopper | partnership manager | 11 | 23723008 | 1372919114863083580 |
| Valeriia Mukhai | client director | 10 | 23093401 | 1186245045729366016 |
| Ritchie Boubouli | director of new partnerships | 9 | 23093412 | 1232286685707112450 |

The dropdown is **built from the database, not hardcoded** — an `is_lead_assignee` boolean on
`team`, seeded `true` for these three. Adding or removing someone later is a one-row update,
not a redeploy, and the Discord option label comes from `full_name` so it stays in sync.

Their `discord_id` values also let the handler check that the person clicking is a known team
member, and record *who* assigned the lead rather than just *to whom*.

---

## Domain validation — free first, paid only as a fallback

This is the "cheap, ideally free" layer. It runs **before** the Pipedrive write, and its
verdict is shown on the Discord card so a human can override it.

**Validate the right domain.** The mail arrives from `noreply@salesmatemail.com` — Salesmate's
notification sender. Validating *that* domain is meaningless. The two things worth checking are
the **`Email Address` field** from the form body and the **`Company Website` field**.

### Tier 0 — costs nothing, no API key, no rate limit

Catches the large majority of junk on its own:

1. **Syntax** — RFC-shaped address check.
2. **MX lookup over DNS-over-HTTPS** — `https://cloudflare-dns.com/dns-query?name=<domain>&type=MX`
   (Google's `https://dns.google/resolve` as a second source). Free, keyless, plain HTTPS
   from an edge function. A domain with **no MX record cannot receive mail** — that single
   check kills most typo and fake domains.
3. **Disposable / temp-mail blocklist** — sync
   [`disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
   (~200k domains, community-maintained, ships an `allowlist.conf` for false positives)
   into a `disposable_domains` table nightly via `pg_cron`. Lookup is then a local index
   hit, not a network call.
4. **Free-provider check** — gmail / yahoo / outlook / proton etc. Not invalid, but a
   signal that this is a personal address rather than a company one. Worth surfacing, never
   worth auto-rejecting.
5. **Domain resolves at all** — A/AAAA record present.

### Tier 1 — optional, only when Tier 0 is ambiguous

Call a hosted verifier **only** when Tier 0 says "has MX, not disposable, not a free
provider" — i.e. the cases where the cheap checks cannot decide. That keeps volume inside
a free quota.

| Service | Free tier | Paid entry | Notes |
|---|---|---|---|
| [Abstract](https://www.abstractapi.com/api/email-verification-validation-api) | 100/mo, no card | $17/mo for 5k | SMTP + catch-all + disposable in one call. Best default. |
| [Check-Mail](https://check-mail.org/) | 1,000/mo, no card | — | Largest free tier found; MX + disposable only |
| [Mailboxlayer](https://mailboxlayer.com/) | free for personal use | ~$14.99/mo | apilayer family, SMTP + typo checks |
| [ZeroBounce](https://www.zerobounce.net/) | ~100 free | $18 / 2k credits | Most thorough, most expensive at volume |

**Recommendation: ship Tier 0 only.** It is genuinely free and needs no account. Wire Tier 1
behind an optional `EMAIL_VERIFY_API_KEY` env var so it can be switched on later without a
code change — start with Abstract's free 100/mo, and only pay if the ambiguous-case volume
justifies it.

### Form-quality heuristic (also free)

The sample submission shows why MX alone is not enough. Its fields:

| Field | Value | Signal |
|---|---|---|
| Email Address | `alexandra.mus@icloud.com` | free provider — **icloud.com passes MX** |
| Company Name | `Alexandra` | same as the person's first name, not a company |
| Company Website | `url` | not a URL at all |
| How can we help | `idk` | no intent |
| Budget | Below $10k | lowest band |

Every network check passes here, yet the lead is obviously low quality. So alongside the DNS
checks, score the submission itself: is `Company Website` a parseable URL that resolves; does
`Company Name` differ from the contact's own name; is the free-text answer longer than a few
characters; which budget band. Cheap, deterministic, no API.

This is also why the layer **flags rather than rejects** — an `idk` from a real brand is still
worth a human glance.

### Verdict

Tier 0 + optional Tier 1 collapse to one of three verdicts, stored as JSON with the
individual reasons:

- `valid` — company domain, MX present, not disposable
- `suspicious` — free provider, catch-all, or no Tier 1 confirmation
- `invalid` — no MX, disposable, or malformed

**The lead is created in Pipedrive regardless of verdict** (the requirement is that leads
are created automatically). An `invalid` or `suspicious` verdict adds a Pipedrive label and
is shown prominently on the Discord card, so junk is filterable rather than silently
dropped.

---

## Flow

```
Gmail (leads inbox)
   │  poll every 2 min, historyId cursor
   ▼
leads_email_ingest  ──►  parse sender / company / body
   │                     dedupe on gmail_message_id (unique index)
   ▼
domain validation (Tier 0, then Tier 1 only if ambiguous)
   │
   ▼
Pipedrive: searchOrganization → addOrganization / addPerson / addLead
   │        + addNote with raw body and validation reasons
   ▼
Discord: POST card to the leads channel
         ├─ String select "Assign owner"  custom_id lead_assign:<row_id>
         └─ Button (danger) "Ignore"      custom_id lead_ignore:<row_id>
   │
   ▼
discord_lead_interactions  (verify_jwt:false + Ed25519 verify)
   ├─ select  → respond type 9 MODAL immediately  ── "Add a note (optional)"
   │              │
   │              ▼  MODAL_SUBMIT
   │           defer (type 5) → PATCH /v1/leads/{id} {owner_id: <pd_id>}
   │                          → POST /v1/activities {owner_id, lead_id, subject, note}
   │                          → edit card "Assigned to X · activity created"
   └─ ignore  → defer (type 5) → PATCH /v1/leads/{id} {is_archived: true}
                               → edit card "Ignored", strip controls
```

---

## Assignment note → Pipedrive Activity

When someone picks an owner, they get a note box, and the note becomes a **Pipedrive Activity
assigned to the new owner** — so the assignee gets a real task in their own Pipedrive queue
rather than just a silently changed owner field.

### Verified against the live Pipedrive account

Reading real activities back confirms the field that does the "tagging":

- **`owner_id` is the assigned user.** Live examples: activity 14306 has `owner_id: 26008478`
  (Sarineh), activity 14305 has `owner_id: 23723008` (Carrick). Same `pd_id` values as the
  `team` table — so the dropdown selection maps straight onto it.
- **`lead_id` is a supported link field** on activities, so the Activity attaches to the lead
  itself, not just to the person or organization.
- **`note` is free HTML**, which is where the Discord text goes.
- Also available and worth setting: `subject`, `type`, `due_date`, `due_time`, `priority`,
  `done`, `person_id`, `org_id`.

**Use `owner_id`, not an @-mention.** Pipedrive notes can carry @-mention markup, but it is
brittle undocumented HTML. Assigning `owner_id` is the supported, reliable way to make the
activity show up in that person's task list and notify them.

**One caveat:** `creator_user_id` is always the user the API token belongs to, so every
bot-created activity will read as created by that service user — not by the person who
clicked in Discord. The real clicker is therefore recorded two ways: prepended to the
activity note ("Assigned by @inigo via Discord") and stored in `lead_events`.

### Discord modal mechanics

Collecting free text needs a modal, and modals have two hard constraints that shape the flow:

1. **A modal must be the *immediate* response to the select interaction** — response type 9,
   within the 3-second window. You cannot defer first and send a modal afterwards. So the
   select handler does *no* Pipedrive work; it only opens the modal.
2. **The Pipedrive work happens on `MODAL_SUBMIT`**, which is a separate interaction. That one
   is deferred (type 5), then the writes happen, then the card is edited.

The modal carries its state in the `custom_id`: `lead_note:<row_id>:<assignee_pd_id>`
(well within the 100-character limit). It holds one paragraph-style text input
(`style: 2`) marked **`required: false`** — an assignment should never be blocked by a
mandatory note. A blank note still creates the activity, just with the default subject.

To edit the card afterwards, the handler uses the bot token against the stored
`discord_message_id` (`PATCH /channels/{channel_id}/messages/{message_id}`) rather than the
interaction's `@original` endpoint. Message-edit semantics differ between component and
modal-submit interactions; going through the stored id behaves identically in both cases.

### The activity that gets created

```ts
addActivity({
  lead_id:  lead.pd_lead_id,
  owner_id: assignee.pd_id,          // ← the "tag": lands in their task list
  subject:  `Follow up: ${lead.title}`,
  type:     'task',
  due_date: nextBusinessDay(),
  person_id: lead.pd_person_id,
  org_id:    lead.pd_org_id,
  note: `${noteFromModal || '(no note)'}<br><br>` +
        `<i>Assigned by ${discordUsername} via Discord</i>`,
})
```

Defaults worth confirming with you: activity **type** `task`, **due date** next business day,
and whether the note should *also* be added as a pinned Note on the lead (`addNote` with
`pinned_to_lead_flag: 1`) so it shows in the lead's note feed as well as on the activity.

---

## Lead source: the `newbusiness@houseofmarketers.com` inbox

The mail is **not** a customer writing in. It is a **Salesmate form-notification email** from
`noreply@salesmatemail.com`, sent to `chris@`, `newbusiness@` and `inigo@houseofmarketers.com`.
The body is a clean `Label: value` list, and the subject carries both the form name and a
submission number:

```
GAds Brand Enquiry Contact Form - New Submission [903]
```

That `[903]` is a per-submission id — a second idempotency key alongside the Gmail message id.
The form name identifies which campaign the lead came from and maps onto the Pipedrive lead
label / `source_name`. "A few variations" means a few form names, all with the same body shape.

### Field mapping

| Form field | Goes to |
|---|---|
| Full Name | Person name |
| Email Address | Person email — **the domain we validate** |
| Mobile Number | Person phone |
| Company Name | Organization name |
| Company Website | Organization domain — **also validated** |
| Country | Person / Organization |
| Company Industry | Lead note |
| Client Campaign Budget | Lead value + note |
| How did you find us? | Lead source |
| How can we help | Lead note (and the free-text quality signal) |
| Subject form name | Lead label / `source_name` |
| Subject `[nnn]` | Idempotency key |

### Consider skipping Gmail entirely

They already run **Salesmate**, which is where these forms live. If Salesmate can POST a
webhook on form submission, it delivers structured JSON straight to an edge function — no
OAuth, no admin consent, no HTML parsing, no drift when a form gains a field. That is strictly
more robust than reading the notification email and should be checked first.

Gmail remains the fallback, and is described below.

### What is needed to connect Gmail

**First, one fork that decides everything:** is `newbusiness@houseofmarketers.com` a real
Workspace **user mailbox**, or a **Google Group / distribution alias**? (Admin console →
Directory → Users vs Groups.) The Gmail API can only read a *mailbox*. If it is a group, there
is nothing to impersonate, and the options become: read `chris@` or `inigo@` instead with a
Gmail filter isolating these mails, convert the group to a mailbox, or use the Salesmate
webhook.

**Option A — service account + domain-wide delegation.** Best for an unattended shared inbox.
Needs:

1. A Google Cloud project with the **Gmail API enabled** — project id.
2. A **service account** in it, plus a **JSON key** (a secret — goes into Supabase secrets, not
   into chat or the repo).
3. A **Workspace super admin** to authorize that service account's numeric **Client ID** under
   Admin console → Security → Access and data control → API controls → Domain-wide delegation,
   with scope `https://www.googleapis.com/auth/gmail.readonly` — plus
   `https://www.googleapis.com/auth/gmail.modify` if we want to label processed mail, which is
   worth having as a visible audit trail in the inbox itself.
4. The address to impersonate: `newbusiness@houseofmarketers.com`.

**Option B — OAuth refresh token.** No admin needed, but someone must sign in as that mailbox
once. Needs client id, client secret, and the resulting refresh token. **Caveat:** if the OAuth
app is left in "Testing" publishing status the refresh token expires after 7 days and the
pipeline dies quietly — it must be "In production", or Internal to the Workspace.

**Option C — Google Apps Script.** Lowest setup of the three: someone logged in as the mailbox
pastes a script with a time-driven trigger that POSTs matching threads to our endpoint with a
shared secret. No GCP project, no admin involvement. Good if admin access is slow to get.

**Polling, not push.** Gmail push needs a Pub/Sub topic and a verified push endpoint. Polling
`users.messages.list` every 2 minutes with a narrow query is far less setup for a lead flow
where two minutes is immaterial:

```
from:noreply@salesmatemail.com subject:"New Submission" newer_than:1d
```

### Also worth having

- **3–5 sample emails covering the form variations** (forwarded as `.eml`, or screenshots) so
  the parser covers all of them rather than just the GAds form.
- Whether that inbox receives **anything other than these notifications**, which decides how
  tight the Gmail query needs to be.

---

## Files to create

All new. Repo is currently empty.

| Path | Purpose |
|---|---|
| `supabase/migrations/0001_leads.sql` | `leads_inbox`, `disposable_domains`, `lead_events` tables; `team.is_lead_assignee` column; RLS; pg_cron jobs |
| `supabase/functions/_shared/pipedrive.ts` | Thin Pipedrive REST client (`searchOrganization`, `addOrganization`, `addPerson`, `addLead`, `updateLead`, `addNote`, `addActivity`) |
| `supabase/functions/_shared/validate_domain.ts` | Tier 0 checks + optional Tier 1; returns `{verdict, reasons[]}` |
| `supabase/functions/_shared/discord.ts` | Ed25519 verification, card builder, **modal builder**, message PATCH helper |
| `supabase/functions/leads_email_ingest/index.ts` | Gmail poll → validate → Pipedrive → post card |
| `supabase/functions/discord_lead_interactions/index.ts` | Interaction handler: PING, select → modal, modal submit → Pipedrive, ignore button |
| `supabase/functions/sync_disposable_domains/index.ts` | Nightly blocklist refresh |
| `docs/SETUP.md` | Discord app setup, secrets, Gmail OAuth, endpoint registration |

### Schema sketch

```sql
create table leads_inbox (
  id                 bigint generated always as identity primary key,
  gmail_message_id   text not null unique,      -- idempotency key
  gmail_thread_id    text,
  from_email         text not null,
  from_name          text,
  domain             text not null,
  subject            text,
  body_text          text,
  received_at        timestamptz not null,
  validation         jsonb not null default '{}'::jsonb,
  validation_verdict text not null check (validation_verdict in ('valid','suspicious','invalid')),
  pd_lead_id         text,
  pd_org_id          bigint,
  pd_person_id       bigint,
  discord_message_id text,
  status             text not null default 'new'
                       check (status in ('new','assigned','ignored')),
  assigned_pd_id     numeric,
  assigned_by        numeric,                   -- team.discord_id of the clicker
  assign_note        text,                      -- free text typed into the Discord modal
  pd_activity_id     bigint,                    -- Activity created for the assignee
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

`gmail_message_id unique` is what makes the ingest safe to retry — a poller that runs twice
cannot create the lead twice.

### Secrets

`PIPEDRIVE_API_TOKEN`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`,
`DISCORD_LEADS_CHANNEL_ID` (= `1489334181405266083`), `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`,
and optionally `EMAIL_VERIFY_API_KEY`.

---

## Open decisions

Neither blocks starting on the schema, the validation module or the Pipedrive client:

1. **How we read the leads** — Salesmate webhook (preferred) or Gmail on
   `newbusiness@houseofmarketers.com`. If Gmail: whether that address is a real mailbox or a
   group, and which of options A/B/C we use. *(the one real blocker for an end-to-end
   pipeline — see the section above for the exact list of what is needed)*
2. **Activity defaults** — assumed type `task`, due next business day, and the note *not* also
   duplicated as a pinned Note on the lead. All three are one-line changes.
3. **What "Ignore" does in Pipedrive.** Assumed: archive (`is_archived: true`) — reversible
   and keeps the audit trail. Alternatives: apply an "Ignored" label, delete, or change
   nothing in Pipedrive and only grey out the Discord card.
4. **Who may use the controls.** Assumed: anyone in channel `1489334181405266083`. If it
   should be restricted, the `team.discord_id` lookup is already there to enforce it.

---

## Verification

1. **Validation module, offline** — unit tests over a fixture table: a real company domain,
   a domain with no MX, a known disposable domain, a gmail.com address, a malformed address.
   Assert the verdict and the reasons list. No network needed beyond the DoH calls.
2. **Pipedrive client, against the live account** — create a lead from a fixture, confirm via
   `getLead` that owner, org, person and note are set, then archive it. The Pipedrive MCP
   tools (`getLead`, `getLeads`, `searchOrganization`) can confirm state independently of our
   own code.
3. **Activity creation, against the live account** — create an activity with
   `owner_id` set to a test user and `lead_id` set to a fixture lead, then read it back with
   `getActivities({lead_id})` and assert `owner_id` matches the dropdown selection and `note`
   contains the modal text. Confirm in the Pipedrive UI that it appears in that user's task
   list — that is the real proof the person was "tagged".
4. **Discord endpoint handshake** — Discord will only save the interactions URL if the Ed25519
   verification and the PING (`type: 1` → `{"type": 1}`) response are both correct. Saving the
   URL in the Discord developer portal *is* the test.
5. **End to end** — send a test email to the leads inbox from a throwaway company domain and
   from a disposable one. Expect: two Pipedrive leads, two Discord cards with different
   verdicts. Pick an owner on one → a modal opens → type a note → confirm via `getLead` that
   `owner_id` changed, and via `getActivities({lead_id})` that an activity exists with that
   `owner_id` and the typed note. Submit the modal *empty* on a second run to confirm the
   assignment still succeeds. Click Ignore on the other → confirm `is_archived: true`.
6. **Idempotency** — run the ingest twice against the same inbox state. Expect zero new rows
   and zero new Pipedrive leads.
