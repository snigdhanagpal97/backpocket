/**
 * Backpocket bridge.
 *
 * Runs in your own Google account at 6am. Reads today's Google Calendar
 * events and the last 3 days of emails that look like job-application
 * confirmations, and sends only those to Backpocket, signed with
 * BRIDGE_SECRET. Nothing else in your inbox leaves Google: emails go as
 * sender, subject, date and Gmail's one-line snippet, and Backpocket
 * doesn't store them.
 *
 * Script properties (Project Settings > Script properties):
 *   BACKPOCKET_URL   https://your-app.vercel.app
 *   BRIDGE_SECRET    the same value as BRIDGE_SECRET on Vercel
 *   PHONE            your WhatsApp number with country code, digits only
 *   OUTLOOK_ICS_URL  optional: your published Outlook calendar (.ics link)
 *
 * Run previewBrief to see today's brief without sending it, sendBrief to
 * send it now, and installDailyTrigger once to schedule it.
 */

var LOOKBACK = 'newer_than:3d';

// Phrases confirmation emails use, and the applicant tracking systems that send them.
var CONFIRMATION_QUERY =
  '("thank you for applying" OR "thanks for applying" OR "received your application" OR ' +
  '"application received" OR "application has been received" OR "application submitted" OR ' +
  '"your application to" OR "your application for" OR ' +
  'from:(greenhouse.io OR greenhouse-mail.io OR lever.co OR myworkday.com OR workday.com OR ' +
  'ashbyhq.com OR smartrecruiters.com OR icims.com OR jobvite.com OR successfactors.com OR ' +
  'taleo.net OR workablemail.com OR rippling.com))';

// Calendars that never need prep.
var SKIP_CALENDARS = /(holiday|#contacts|#weather|addressbook)/i;
var SKIP_EVENT_TYPES = { workingLocation: true, outOfOffice: true, focusTime: true, birthday: true };

/** Sends today's brief on WhatsApp. This is what the daily trigger runs. */
function sendBrief() {
  return post_(buildRequest_({ dryRun: false, force: false }));
}

/** Shows today's brief in the log without sending anything. */
function previewBrief() {
  return post_(buildRequest_({ dryRun: true, force: true }));
}

/** Sends today's brief again even if it already went out. */
function resendBrief() {
  return post_(buildRequest_({ dryRun: false, force: true }));
}

/** Schedules sendBrief every day between 6 and 7am in the script's time zone. Run once. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sendBrief') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sendBrief')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .inTimezone(Session.getScriptTimeZone())
    .create();
  Logger.log('sendBrief will run every day between 6 and 7am ' + Session.getScriptTimeZone() + '.');
}

function setting_(name, required) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (required && !value) throw new Error('Add the script property ' + name + ' (Project Settings > Script properties).');
  return value || '';
}

function buildRequest_(options) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var dayStart = new Date(Utilities.formatDate(now, tz, "yyyy-MM-dd'T'00:00:00XXX"));
  var dayEnd = new Date(Utilities.formatDate(now, tz, "yyyy-MM-dd'T'23:59:59XXX"));
  return {
    phone: setting_('PHONE', true),
    date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    timezone: tz,
    events: calendarEvents_(dayStart, dayEnd),
    emails: confirmationEmails_(),
    outlook_ics_url: setting_('OUTLOOK_ICS_URL', false),
    force: options.force,
    dry_run: options.dryRun
  };
}

function calendarEvents_(dayStart, dayEnd) {
  var calendars = Calendar.CalendarList.list({ minAccessRole: 'reader' }).items || [];
  var events = [];
  calendars
    .filter(function (cal) { return (cal.primary || cal.selected !== false) && !cal.hidden && !SKIP_CALENDARS.test(cal.id); })
    .forEach(function (cal) {
      var items = Calendar.Events.list(cal.id, {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50
      }).items || [];
      items.forEach(function (event) {
        if (event.status === 'cancelled' || SKIP_EVENT_TYPES[event.eventType]) return;
        var attendees = event.attendees || [];
        var me = attendees.filter(function (a) { return a.self; })[0];
        if (me && me.responseStatus === 'declined') return;
        events.push({
          id: cal.id + ':' + event.id,
          title: event.summary || '',
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          all_day: !event.start.dateTime,
          description: (event.description || '').slice(0, 4000),
          location: (event.location || '').slice(0, 500),
          attendees: attendees
            .filter(function (a) { return !a.self && !a.resource; })
            .slice(0, 100)
            .map(function (a) { return { name: a.displayName || '', email: a.email || '' }; }),
          calendar: 'google'
        });
      });
    });
  return events.slice(0, 80);
}

function header_(message, name) {
  var headers = (message.payload && message.payload.headers) || [];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].name.toLowerCase() === name.toLowerCase()) return headers[i].value || '';
  }
  return '';
}

function decodeEntities_(text) {
  return text
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function confirmationEmails_() {
  var list = Gmail.Users.Messages.list('me', { q: LOOKBACK + ' -in:chats ' + CONFIRMATION_QUERY, maxResults: 40 });
  return (list.messages || []).map(function (ref) {
    // Metadata only: headers and Gmail's snippet, never the body.
    var message = Gmail.Users.Messages.get('me', ref.id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    return {
      id: message.id,
      from: header_(message, 'From').slice(0, 400),
      subject: header_(message, 'Subject').slice(0, 500),
      date: new Date(Number(message.internalDate)).toISOString(),
      snippet: decodeEntities_(message.snippet || '').slice(0, 1000)
    };
  });
}

/** JSON with every non-ASCII character escaped, so the signed bytes are the sent bytes. */
function asciiJson_(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function sign_(body, secret) {
  var bytes = Utilities.computeHmacSha256Signature(body, secret, Utilities.Charset.UTF_8);
  return 'sha256=' + bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function post_(payload) {
  var body = asciiJson_(payload);
  var url = setting_('BACKPOCKET_URL', true).replace(/\/+$/, '') + '/api/brief';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: { 'x-backpocket-signature': sign_(body, setting_('BRIDGE_SECRET', true)) },
    muteHttpExceptions: true
  });
  var text = response.getContentText();
  Logger.log('Sent ' + payload.events.length + ' events and ' + payload.emails.length + ' emails. Backpocket replied ' +
    response.getResponseCode() + ':\n' + text);
  if (response.getResponseCode() >= 400) throw new Error('Backpocket returned ' + response.getResponseCode() + ': ' + text);
  return JSON.parse(text);
}
