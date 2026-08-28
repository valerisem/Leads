/**
 * Forwards new Salesmate lead notifications from newbusiness@houseofmarketers.com
 * to the lead pipeline.
 *
 * Runs inside the mailbox itself, so it needs no Google Cloud project, no OAuth
 * client and no Workspace admin. Setup is in scripts/apps-script/README.md.
 *
 * Already-sent mail is marked with a Gmail label rather than tracked by
 * timestamp, so a failed run simply retries next time and nothing is sent twice.
 */

const LABEL_NAME = 'pipedrive-sent';

/** Tight enough to ignore the other mail that lands in this inbox. */
const SEARCH_QUERY =
  'from:noreply@salesmatemail.com subject:"New Submission" -label:' + LABEL_NAME;

/** Threads per run. The trigger fires often, so this only caps a backlog. */
const MAX_THREADS = 25;

/** The function the time-driven trigger calls. */
function forwardNewLeads() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = props.getProperty('ENDPOINT_URL');
  const secret = props.getProperty('SHARED_SECRET');

  if (!endpoint || !secret) {
    throw new Error(
      'Set ENDPOINT_URL and SHARED_SECRET in Project Settings → Script Properties.'
    );
  }

  const label = getOrCreateLabel_(LABEL_NAME);
  const threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS);

  if (threads.length === 0) {
    console.log('Nothing new.');
    return;
  }

  let sent = 0;
  let failed = 0;

  threads.forEach(function (thread) {
    // A thread is only labelled once every message in it is safely delivered,
    // so a partial failure is retried rather than silently dropped.
    const allDelivered = thread.getMessages().every(function (message) {
      const ok = postMessage_(endpoint, secret, message, thread);
      ok ? sent++ : failed++;
      return ok;
    });

    if (allDelivered) thread.addLabel(label);
  });

  console.log('Sent ' + sent + ' message(s), ' + failed + ' failed.');
}

function postMessage_(endpoint, secret, message, thread) {
  const payload = {
    messageId: message.getId(),
    threadId: thread.getId(),
    from: message.getFrom(),
    to: message.getTo(),
    subject: message.getSubject(),
    receivedAt: message.getDate().toISOString(),
    plainBody: message.getPlainBody(),
    htmlBody: message.getBody(),
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true,
    });

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) return true;

    console.error(
      'Endpoint returned ' + code + ' for "' + payload.subject + '": ' +
        response.getContentText().slice(0, 300)
    );
    return false;
  } catch (error) {
    console.error('Request failed for "' + payload.subject + '": ' + error);
    return false;
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Run once by hand to install the every-5-minutes trigger. Clears any existing
 * triggers first so running it twice cannot double up the schedule.
 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('forwardNewLeads').timeBased().everyMinutes(5).create();
  console.log('Trigger installed: forwardNewLeads every 5 minutes.');
}

/**
 * Run by hand to check the search query without sending anything. Prints what
 * would be forwarded on the next run.
 */
function dryRun() {
  const threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS);
  console.log('Query: ' + SEARCH_QUERY);
  console.log('Matching threads: ' + threads.length);

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      console.log('  - ' + message.getDate().toISOString() + '  ' + message.getSubject());
    });
  });
}

/**
 * Run by hand to undo a test: removes the label from everything, so the next
 * run re-sends. Useful while wiring things up, not in normal operation.
 */
function resetLabel() {
  const label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) return console.log('No label to reset.');

  label.getThreads().forEach(function (thread) {
    thread.removeLabel(label);
  });
  console.log('Label cleared — the next run will re-send.');
}
