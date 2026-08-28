# Getting the Gmail refresh token — click by click

You need to produce **three values**:

```
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
```

Roughly 10 minutes. Part 1 is clicking in the Google Cloud Console; Part 2 is
running one script.

> **Do not paste these into chat, a ticket, or the repo.** Put them straight into
> Railway → your service → Variables. Anyone holding all three can read the
> mailbox.

---

## Part 1 — Create the OAuth client

Sign in to Google with an account on the **houseofmarketers.com** Workspace
before you start. If you are signed into a personal Google account as well, use
a fresh incognito window so you do not create the project on the wrong account.

**1.** Go to **https://console.cloud.google.com/**

**2.** Create a project. Click the **project dropdown in the top bar** (next to
the "Google Cloud" logo) → **New Project** → Name it `HoM Lead Pipeline` →
**Create**. When it finishes, click the dropdown again and **select it** — the
top bar must read `HoM Lead Pipeline` for every step below.

**3.** Enable the Gmail API. Go to
**https://console.cloud.google.com/apis/library/gmail.googleapis.com** and click
**Enable**.

**4.** Configure the consent screen. Left menu → **APIs & Services** → **OAuth
consent screen**. (Newer consoles show this as **Google Auth Platform**; the
fields are the same, split across *Branding*, *Audience* and *Data Access*.)

  - **User type / Audience: choose `Internal`.** This matters more than anything
    else on this page — see the warning below. If `Internal` is greyed out you
    are not signed in with a Workspace account; go back and fix that first.
  - App name: `HoM Lead Pipeline`
  - User support email: your address
  - Developer contact email: your address
  - **Save and Continue**

**5.** Add the scopes. On the **Scopes** step (or **Data Access**) click
**Add or Remove Scopes**, paste these two into the filter box and tick them:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
```

`gmail.modify` lets the pipeline label mail it has already processed, which
gives you an audit trail in the inbox itself. If you would rather it stay
strictly read-only, add only the first — and remove `gmail.modify` from the
`SCOPES` array in `scripts/get-gmail-refresh-token.mjs` to match.

Click **Update** → **Save and Continue**.

**6.** Create the credential. Left menu → **APIs & Services** → **Credentials**
→ **+ Create Credentials** (top) → **OAuth client ID**.

  - **Application type: `Desktop app`** ← this specific choice matters. A
    Desktop client accepts a `localhost` redirect automatically, so you never
    have to register a redirect URL.
  - Name: `HoM Lead Pipeline CLI`
  - **Create**

**7.** A dialog shows **Client ID** and **Client secret**. Copy both. (If you
close it: Credentials → click the client name → the secret is there, and you can
add a new one.)

> ### Why `Internal` matters
> An **External** app left in *Testing* status issues refresh tokens that
> **expire after 7 days**. The pipeline would run fine for a week and then stop
> pulling leads, with nothing obviously broken. `Internal` has no such expiry.
>
> If your Workspace genuinely cannot use `Internal`, then on the OAuth consent
> screen you must click **Publish App** and move it to **In production** — a
> *Testing* app will silently break the pipeline a week after you set it up.

---

## Part 2 — Mint the refresh token

Run this **on your own machine**, not on a server — it opens a browser.

```bash
git clone https://github.com/valerisem/Leads.git
cd Leads
node scripts/get-gmail-refresh-token.mjs
```

**1.** It asks for the **Client ID** and **Client secret** from step 7. Paste
them.

**2.** It prints a URL. Open it in a browser that is **signed in as
`newbusiness@houseofmarketers.com`** — this is the step that decides *whose*
mail the pipeline can read. If you approve while signed in as yourself, you will
get a working token for the wrong mailbox.

**3.** Approve the permission prompt. The browser shows "Done"; the terminal
prints the three variables.

**4.** Paste all three into Railway → the service → **Variables**.

---

## If something goes wrong

| Symptom | Cause and fix |
|---|---|
| `refresh_token` missing from the output | Google only issues one on first approval. Revoke the app at **https://myaccount.google.com/permissions** and run the script again. |
| `Error 400: redirect_uri_mismatch` | The client was not created as **Desktop app**. Make a new credential with that type. |
| `Error 403: access_denied` | You approved as an account outside the Workspace, or the app is `External` + `Testing` and your account is not on the test-users list. |
| `EADDRINUSE` on port 53682 | Something else holds the port. Change `PORT` at the top of the script. |
| Leads stop arriving after ~7 days | The classic symptom of `External` + `Testing`. Switch the app to `Internal`, or publish it to *In production*, then re-run the script. |

## What the pipeline will do with it

Poll `users.messages.list` every couple of minutes with a query tight enough to
ignore the other mail in that inbox:

```
from:noreply@salesmatemail.com subject:"New Submission" newer_than:1d
```

The refresh token is exchanged for a short-lived access token as needed; the
refresh token itself is what must be stored.
