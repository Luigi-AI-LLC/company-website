# Consultation scheduling: how it works and your options

The site is a static page hosted on GitHub Pages. That is great for speed, cost
(free) and security, but a static page **cannot** on its own:

- read your real calendar to know what is actually free,
- reserve a slot atomically so two visitors can't book the same time,
- send confirmation emails, calendar invites, reminders or video links.

Those things need a server somewhere. You have three ways to get them, from
zero-setup to fully custom. The site ships with **Option B** live and can be
switched to **Option A** by editing two lines in `config.js`.

| | A · Hosted scheduler (recommended) | B · Built-in picker + email request (live now) | C · Custom backend |
|---|---|---|---|
| Real-time availability from your calendar | ✅ | ❌ rules-based | ✅ |
| Double-booking protection | ✅ | ❌ you confirm manually | ✅ |
| Automatic confirmations, reminders, Meet/Zoom link | ✅ | ❌ you send the invite | ✅ (you build it) |
| Visitor time-zone handling | ✅ | ✅ | ✅ |
| Setup time | ~15 min | 0–10 min | days |
| Ongoing cost | Free tier available | Free | Hosting + maintenance |
| Look & feel | Theirs, inside your page | Fully yours | Fully yours |
| Requires a backend | No (they host it) | No | Yes (serverless is enough) |

---

## Option A — Embed a hosted scheduler (recommended)

A hosted scheduler connects to your Google/Outlook calendar, shows only free
times, books the slot, emails both sides, adds a Google Meet link and sends
reminders. The site embeds it in the **Schedule a consultation** section and
the hero card turns into a "Book online" prompt.

### Pick a provider

| Provider | Free tier | Notes |
|---|---|---|
| **Google Calendar appointment schedules** | Yes (one booking page on a personal Gmail) | Zero extra accounts; you already use `alahiji@gmail.com`. Calendar → *Create* → *Appointment schedule*. Embed URL is on the schedule's *Share* dialog. |
| **Cal.com** | Yes (unlimited bookings, one event type) | Open-source, polished, easy custom branding. Share link looks like `https://cal.com/your-name/intro`. |
| **Calendly** | Yes (one event type) | Most widely recognised. Share link looks like `https://calendly.com/your-name/30min`. |
| **Microsoft Bookings** | Included with Microsoft 365 Business | If you move to a Microsoft stack. |

### Switch the site over (2 minutes)

1. Create a 30-minute event type / appointment schedule with the provider and
   connect your calendar.
2. Copy the public booking link.
3. In `config.js`:

   ```js
   scheduler: {
     mode: "embed",
     embedUrl: "https://cal.com/your-name/intro",   // your link
     ...
   }
   ```

4. Commit and push. GitHub Pages redeploys in about a minute.

The page adds provider-specific parameters for a cleaner embed (hides
Calendly's cookie banner, applies the brand colour, uses Google's `gv=true`
embed view) and shows an "open in a new tab" fallback under the iframe.

---

## Option B — Built-in picker + email request (what's live today)

Visitors see a date strip and time slots generated from your **availability
rules** in `config.js`, in their own time zone. They pick a slot, fill in a
short form, and the request is delivered to you. You confirm by replying with
a calendar invite.

### Your workflow when a request arrives

1. Open the email. It contains the requested time in **your** time zone, in
   the visitor's time zone, and a UTC "Slot ID".
2. Check your calendar. If you're free, create a Google Calendar event with a
   Meet link, invite the visitor's email, and reply "confirmed".
3. (Optional) Paste the Slot ID into `bookedSlots` in `config.js` so the slot
   disappears for other visitors:

   ```js
   bookedSlots: ["2026-09-28T14:00:00.000Z"]
   ```

   If you skip this step the slot stays visible and you might get a second
   request for the same time; you'd simply offer that person the next slot.

### Configure your availability

All in `config.js` → `availability`:

```js
availability: {
  timezone: "America/Chicago",     // IANA zone your hours are written in
  slotMinutes: 30,                 // length of each bookable slot
  minNoticeHours: 24,              // hide slots sooner than this
  horizonDays: 21,                 // how far ahead visitors can book
  weekly: {                        // 24h windows; omit a day to close it
    mon: [["09:00", "12:00"], ["13:00", "17:00"]],
    ...
    fri: [["09:00", "12:00"], ["13:00", "15:00"]]
  },
  blackoutDates: ["2026-11-26"],   // whole days off (YYYY-MM-DD)
  bookedSlots: []                  // individual taken slots (ISO UTC)
}
```

Daylight-saving changes are handled automatically; tests cover the November
switch.

### Choose how requests reach you

`config.js` → `requests.provider`:

| Provider | Setup | Visitor experience |
|---|---|---|
| `"mailto"` (default) | None | Their email app opens pre-filled; they hit send. A "copy details" fallback is shown for people without a mail app. Least reliable, since some visitors won't complete the send. |
| `"formspree"` (**recommended for this option**) | 5 min, free for 50 submissions/month | Request is sent silently in the background; visitor sees "Request sent!". You get an email with every field, and Formspree keeps an inbox of submissions. |
| `"emailjs"` | 10 min, free for 200 emails/month | Same as Formspree; see `EMAILJS_SETUP.md`. |

**Formspree setup**

1. Sign up at https://formspree.io and create a form. Set the email to
   `alahiji@gmail.com`.
2. Copy the endpoint, e.g. `https://formspree.io/f/abcdwxyz`.
3. In `config.js`:

   ```js
   requests: {
     provider: "formspree",
     formspreeEndpoint: "https://formspree.io/f/abcdwxyz",
     ...
   }
   ```

4. In Formspree's form settings, add `luigiai.dev` under *Restrict to domain*
   (optional, blocks spam from elsewhere). The form already carries a honeypot
   field that silently drops bots.

The submission includes: `name`, `email`, `company`, `topic`, `notes`,
`slot_owner_time`, `slot_visitor_time`, `slot_start_utc`, `slot_end_utc`,
`visitor_timezone`, `duration_minutes`, plus a `_subject` line like
*"Consultation request: Jane Doe — Mon, Sep 28, 2026, 9:00 AM CDT"* and
`_replyto` so you can hit Reply.

### Limitations to be aware of

- Availability is rules-based, not read from your calendar. Anything you book
  elsewhere has to be reflected in `bookedSlots` or `blackoutDates`.
- No confirmation is sent automatically; the visitor is told to expect one
  within a business day. They can download a tentative `.ics` hold.
- If you regularly get more than a handful of requests a week, move to Option A.

---

## Option C — Custom backend (only if you outgrow A)

Keep the built-in picker UI (which is already yours and on-brand) and replace
its "email me the request" step with a small API that:

1. **Reads free/busy** from Google Calendar (`freebusy.query`) to compute real
   availability, and
2. **Creates the event** with a Meet link and the visitor as an attendee, so
   Google sends the invite and reminders.

Suggested stack, all with generous free tiers and no server to manage:

| Piece | Choice |
|---|---|
| API hosting | Cloudflare Workers, Netlify Functions or Vercel Functions (the static site can stay on GitHub Pages and call the function cross-origin) |
| Calendar access | Google Calendar API with a service account, or OAuth refresh token for `alahiji@gmail.com` |
| Endpoints | `GET /availability?from&to` → slots · `POST /book` → creates event, returns confirmation |
| Anti-abuse | Cloudflare Turnstile on the form, rate limit by IP |
| Double-booking | Re-check free/busy inside `POST /book` right before insert |

`scheduler.js` is structured so only `chooseProvider()` / `sendFormspree()`
would need swapping for a `fetch('/book')` call, and `generateSlots()` for a
`fetch('/availability')` call. Budget roughly 1–2 days of work plus a few
hours a year of maintenance (token rotation, API changes). It's the right
call only if you need custom booking logic a hosted tool can't express
(deposits, multi-person routing, CRM sync on your own terms).

---

## Quick reference: `config.js`

| Key | Meaning |
|---|---|
| `contactEmail` | Where requests go; also shown as the "prefer email?" link |
| `scheduler.mode` | `"builtin"` or `"embed"` |
| `scheduler.embedUrl` | Public booking link for embed mode |
| `scheduler.meetingLabel` / `durationMinutes` / `location` | Copy shown in the hero card, summary and confirmation |
| `availability.*` | Rules for the built-in picker (see above) |
| `requests.provider` | `"mailto"`, `"formspree"` or `"emailjs"`; falls back to mailto if the chosen provider isn't configured |

Run `node tests/scheduler.test.js` after editing availability logic.
