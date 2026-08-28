#!/usr/bin/env node
/**
 * Mints a Gmail refresh token for the leads inbox.
 *
 * Run it on your own machine (it needs a browser), signed in as the mailbox
 * whose mail you want to read — newbusiness@houseofmarketers.com.
 *
 *   node scripts/get-gmail-refresh-token.mjs
 *
 * It prints a URL, waits for you to approve in the browser, then prints the
 * three values to paste into Railway. No dependencies.
 */
import http from "node:http";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  // Lets the pipeline label mail it has processed, which doubles as an audit
  // trail in the inbox itself. Drop it if you would rather stay read-only.
  "https://www.googleapis.com/auth/gmail.modify",
];

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

const rl = readline.createInterface({ input: stdin, output: stdout });

const clientId = (process.env.GMAIL_CLIENT_ID ?? (await rl.question("Client ID: "))).trim();
const clientSecret = (
  process.env.GMAIL_CLIENT_SECRET ?? (await rl.question("Client secret: "))
).trim();

if (!clientId || !clientSecret) {
  console.error("Both a client ID and a client secret are required.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    // access_type=offline is what makes Google issue a refresh token at all,
    // and prompt=consent forces a fresh one even if you have approved before.
    access_type: "offline",
    prompt: "consent",
  });

console.log("\nOpen this URL in a browser signed in as the leads mailbox:\n");
console.log(authUrl);
console.log("\nWaiting for you to approve…\n");

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    const received = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">` +
        (received
          ? "<h1>Done.</h1><p>You can close this tab and return to the terminal.</p>"
          : `<h1>Failed</h1><p>${error ?? "No code returned."}</p>`) +
        "</body>",
    );

    server.close();
    received ? resolve(received) : reject(new Error(error ?? "no code returned"));
  });

  server.on("error", reject);
  server.listen(PORT);
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

const tokens = await response.json();

if (!response.ok || !tokens.refresh_token) {
  console.error("\nToken exchange failed:\n", tokens);
  console.error(
    "\nIf refresh_token is missing, revoke the app at " +
      "https://myaccount.google.com/permissions and run this again.",
  );
  process.exit(1);
}

console.log("\nSet these three as Railway variables:\n");
console.log(`GMAIL_CLIENT_ID=${clientId}`);
console.log(`GMAIL_CLIENT_SECRET=${clientSecret}`);
console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
console.log("\nKeep them out of chat, tickets and the repo.\n");

rl.close();
