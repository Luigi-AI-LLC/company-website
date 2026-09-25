# Luigi AI website

Marketing site for Luigi AI, an AI consulting practice for small and mid-size
businesses. Live at **https://luigiai.dev** via GitHub Pages.

Plain HTML, CSS and JavaScript: no build step, no framework, no dependencies.
Push to `main` and GitHub Pages publishes it.

## What's on the page

1. **Hero** with a live "next available" card that pulls the first three open
   slots from the scheduler.
2. **Services**: six offerings.
3. **How it works**: the three-step engagement path.
4. **About** with three value pillars.
5. **Schedule a consultation**: a date/time picker in the visitor's time zone
   with a short request form (or an embedded hosted scheduler, see below).
6. **FAQ** and footer.

Also included: `404.html`, `favicon.svg`, `robots.txt`, `sitemap.xml`,
Open Graph / Twitter tags and `ProfessionalService` structured data.

## Files

```
index.html          Page markup
styles.css          Design tokens, components, responsive rules
script.js           Navigation, scroll-spy, reveal animations
scheduler.js        Availability engine, booking UI, request delivery, embed mode
config.js           ← the only file you normally edit (contact, hours, providers)
tests/              Unit tests for the scheduler's time-zone and slot logic
SCHEDULING.md       How the booking flow works and your upgrade options
EMAILJS_SETUP.md    Optional: deliver requests through EmailJS
BUSINESS_ROADMAP.md Business planning notes
static/             Logo
```

## Booking flow in one paragraph

`config.js` describes your weekly hours, time zone, notice period and any
booked or blacked-out dates. `scheduler.js` turns that into bookable slots,
displays them in the visitor's local time, and delivers the chosen slot plus
their details to you by **mailto** (zero setup, live now), **Formspree** or
**EmailJS**. You reply with a calendar invite. When you're ready for real-time
availability and automatic confirmations, set `scheduler.mode` to `"embed"`
and paste a Cal.com / Calendly / Google Calendar appointment link.
**Read `SCHEDULING.md` for the full walkthrough and trade-offs.**

## Editing

- **Contact email, hours, time zone, providers** → `config.js`
- **Copy** → `index.html` (sections are labelled with comments)
- **Colours, spacing, type** → the `:root` tokens at the top of `styles.css`

The three stats from the original template (100+ use cases, 50+ industries,
95% satisfaction) were placeholders and have been replaced with qualitative
pillars. Add real numbers back when you have them.

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works; opening `index.html` directly also works.

## Test

```bash
node tests/scheduler.test.js
```

Covers wall-clock → UTC conversion, daylight-saving transitions, slot
windows, minimum notice, horizon, blackout dates, booked slots and the
calendar-file builder.

## Deploy

GitHub Pages serves the `main` branch with the custom domain in `CNAME`.
Merge to `main` and the site updates within a minute or two.
