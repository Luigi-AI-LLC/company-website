/*
 * Luigi AI — consultation scheduler
 * ------------------------------------------------------------
 * Two modes, chosen in config.js:
 *
 *   builtin  Generates bookable slots from weekly availability rules,
 *            renders a date/time picker in the visitor's time zone, and
 *            delivers the request by Formspree, EmailJS or mailto.
 *            Works on a fully static host (GitHub Pages) with no backend.
 *
 *   embed    Drops in a hosted scheduler (Cal.com, Calendly, Google
 *            Calendar appointment schedule, Microsoft Bookings…) which
 *            handles real-time availability, confirmations and reminders.
 *
 * The pure functions (slot generation, time-zone math, ICS building) are
 * exported for tests; see tests/scheduler.test.js.
 */
(function (root) {
    'use strict';

    /* ---------------------------------------------------------------------
       Time-zone helpers (no libraries: Intl does the heavy lifting)
       --------------------------------------------------------------------- */
    var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var MS_MIN = 60000;
    var MS_HOUR = 3600000;
    var MS_DAY = 86400000;
    var partsCache = {};

    function partsFormatter(tz) {
        if (!partsCache[tz]) {
            partsCache[tz] = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, hourCycle: 'h23',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
        return partsCache[tz];
    }

    /** Calendar fields of an instant as seen in `tz`. */
    function partsInZone(date, tz) {
        var out = {};
        partsFormatter(tz).formatToParts(date).forEach(function (p) {
            if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
        });
        if (out.hour === 24) out.hour = 0;
        return out;
    }

    /** Offset (ms) of `tz` from UTC at instant `ts`. Positive east of UTC. */
    function tzOffsetMs(ts, tz) {
        var p = partsInZone(new Date(ts), tz);
        var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
        return asUtc - Math.floor(ts / 1000) * 1000;
    }

    /** Wall-clock time in `tz` → UTC instant. Handles DST transitions. */
    function zonedTimeToUtc(y, m, d, hh, mm, tz) {
        var guess = Date.UTC(y, m - 1, d, hh, mm, 0);
        var offset = tzOffsetMs(guess, tz);
        var ts = guess - offset;
        var offset2 = tzOffsetMs(ts, tz);
        if (offset2 !== offset) ts = guess - offset2;
        return new Date(ts);
    }

    /** "YYYY-MM-DD" of an instant in `tz`. */
    function ymdInZone(date, tz) {
        var p = partsInZone(date, tz);
        return pad(p.year, 4) + '-' + pad(p.month, 2) + '-' + pad(p.day, 2);
    }

    function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

    function ymdToParts(ymd) {
        var b = ymd.split('-');
        return { y: +b[0], m: +b[1], d: +b[2] };
    }

    function addDays(ymd, n) {
        var p = ymdToParts(ymd);
        var t = Date.UTC(p.y, p.m - 1, p.d) + n * MS_DAY;
        var dt = new Date(t);
        return pad(dt.getUTCFullYear(), 4) + '-' + pad(dt.getUTCMonth() + 1, 2) + '-' + pad(dt.getUTCDate(), 2);
    }

    /** Weekday key ('mon'…) of a calendar date; independent of time zone. */
    function weekdayOf(ymd) {
        var p = ymdToParts(ymd);
        return DAY_KEYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    }

    /** A Date that lands at noon on `ymd` in `tz` (safe for date formatting). */
    function noonOf(ymd, tz) {
        var p = ymdToParts(ymd);
        return zonedTimeToUtc(p.y, p.m, p.d, 12, 0, tz);
    }

    function parseHHMM(s) {
        var b = s.split(':');
        return (+b[0]) * 60 + (+(b[1] || 0));
    }

    function detectTimeZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch (e) { return 'UTC'; }
    }

    function isValidTimeZone(tz) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
        catch (e) { return false; }
    }

    /* ---------------------------------------------------------------------
       Slot generation
       --------------------------------------------------------------------- */
    /** Normalise config into a list of hosts (a single-host config still works). */
    function hostsOf(avail) {
        var list = (Array.isArray(avail.hosts) && avail.hosts.length) ? avail.hosts : [{
            name: avail.name || 'Luigi AI',
            timezone: avail.timezone,
            weekly: avail.weekly,
            blackoutDates: avail.blackoutDates
        }];
        return list.map(function (h, i) {
            return {
                name: h.name || ('Host ' + (i + 1)),
                timezone: isValidTimeZone(h.timezone || '') ? h.timezone : 'UTC',
                weekly: h.weekly || {},
                blackoutDates: h.blackoutDates || []
            };
        });
    }

    /**
     * Union of every host's availability, each evaluated in that host's own
     * time zone, minus globally booked slots.
     *
     * @param {object} avail  config.availability
     * @param {Date}   now    reference instant (defaults to new Date())
     * @returns {Array<{start: Date, end: Date, hosts: string[]}>} sorted slots
     */
    function generateSlots(avail, now) {
        now = now || new Date();
        var slotMin = avail.slotMinutes || 30;
        var slotMs = slotMin * MS_MIN;
        var earliest = now.getTime() + (avail.minNoticeHours || 0) * MS_HOUR;
        var horizon = avail.horizonDays || 21;
        var latest = now.getTime() + horizon * MS_DAY;
        var booked = {};
        (avail.bookedSlots || []).forEach(function (iso) {
            var t = Date.parse(iso);
            if (!isNaN(t)) booked[t] = true;
        });

        var byStart = {};
        hostsOf(avail).forEach(function (host) {
            var tz = host.timezone;
            var blackout = {};
            host.blackoutDates.forEach(function (d) { blackout[d] = true; });
            var today = ymdInZone(now, tz);

            for (var i = 0; i <= horizon; i++) {
                var ymd = addDays(today, i);
                if (blackout[ymd]) continue;
                var ranges = host.weekly[weekdayOf(ymd)];
                if (!ranges || !ranges.length) continue;
                var p = ymdToParts(ymd);

                ranges.forEach(function (range) {
                    var from = parseHHMM(range[0]);
                    var to = parseHHMM(range[1]);
                    for (var t = from; t + slotMin <= to; t += slotMin) {
                        var start = zonedTimeToUtc(p.y, p.m, p.d, Math.floor(t / 60), t % 60, tz);
                        var ts = start.getTime();
                        if (ts < earliest || ts > latest || booked[ts]) continue;
                        var slot = byStart[ts];
                        if (!slot) slot = byStart[ts] = { start: start, end: new Date(ts + slotMs), hosts: [] };
                        if (slot.hosts.indexOf(host.name) === -1) slot.hosts.push(host.name);
                    }
                });
            }
        });

        var slots = Object.keys(byStart).map(function (k) { return byStart[k]; });
        slots.sort(function (a, b) { return a.start - b.start; });
        return slots;
    }

    /* ---------------------------------------------------------------------
       Formatting
       --------------------------------------------------------------------- */
    function fmt(date, tz, opts) {
        opts.timeZone = tz;
        return new Intl.DateTimeFormat('en-US', opts).format(date);
    }
    function fmtTime(date, tz) { return fmt(date, tz, { hour: 'numeric', minute: '2-digit' }); }
    function fmtDayShort(date, tz) { return fmt(date, tz, { weekday: 'short', month: 'short', day: 'numeric' }); }
    function fmtDayLong(date, tz) { return fmt(date, tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
    function fmtFull(date, tz) {
        return fmt(date, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    }

    function tzOffsetLabel(tz, date) {
        try {
            var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date || new Date());
            var z = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
            return z ? z.value : '';
        } catch (e) {
            try {
                var parts2 = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date || new Date());
                var z2 = parts2.filter(function (p) { return p.type === 'timeZoneName'; })[0];
                return z2 ? z2.value : '';
            } catch (e2) { return ''; }
        }
    }

    function tzCity(tz) {
        var last = tz.split('/').pop();
        return last.replace(/_/g, ' ');
    }

    function tzLabel(tz) {
        var off = tzOffsetLabel(tz);
        return tzCity(tz) + (off ? ' (' + off + ')' : '');
    }

    var COMMON_TZ = [
        'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Phoenix',
        'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Mexico_City', 'America/Bogota',
        'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik', 'Europe/London',
        'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
        'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul',
        'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Asia/Dubai',
        'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore',
        'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth',
        'Australia/Adelaide', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'
    ];

    /* ---------------------------------------------------------------------
       ICS (calendar file) builder
       --------------------------------------------------------------------- */
    function icsDate(date) {
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }
    function icsEscape(s) {
        return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    }
    function buildIcs(opts) {
        var uid = 'luigi-' + icsDate(opts.start) + '@luigiai.dev';
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Luigi AI//Consultation//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:' + uid,
            'DTSTAMP:' + icsDate(new Date()),
            'DTSTART:' + icsDate(opts.start),
            'DTEND:' + icsDate(opts.end),
            'SUMMARY:' + icsEscape(opts.summary),
            'DESCRIPTION:' + icsEscape(opts.description || ''),
            'LOCATION:' + icsEscape(opts.location || ''),
            'STATUS:' + (opts.tentative ? 'TENTATIVE' : 'CONFIRMED'),
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
    }

    /* ---------------------------------------------------------------------
       "Add to calendar" links (URL-based, so they work on iPhone too)
       --------------------------------------------------------------------- */
    function calendarLinks(opts) {
        var q = function (o) {
            return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
        };
        var startIso = opts.start.toISOString();
        var endIso = opts.end.toISOString();
        var outlook = q({
            path: '/calendar/action/compose', rru: 'addevent',
            subject: opts.summary, startdt: startIso, enddt: endIso,
            body: opts.description || '', location: opts.location || ''
        });
        return {
            google: 'https://calendar.google.com/calendar/render?' + q({
                action: 'TEMPLATE', text: opts.summary,
                dates: icsDate(opts.start) + '/' + icsDate(opts.end),
                details: opts.description || '', location: opts.location || ''
            }),
            outlook: 'https://outlook.live.com/calendar/0/deeplink/compose?' + outlook,
            office365: 'https://outlook.office.com/calendar/0/deeplink/compose?' + outlook
        };
    }

    /* ---------------------------------------------------------------------
       Public API (for tests and other scripts)
       --------------------------------------------------------------------- */
    var api = {
        generateSlots: generateSlots,
        hostsOf: hostsOf,
        zonedTimeToUtc: zonedTimeToUtc,
        tzOffsetMs: tzOffsetMs,
        ymdInZone: ymdInZone,
        addDays: addDays,
        weekdayOf: weekdayOf,
        buildIcs: buildIcs,
        calendarLinks: calendarLinks,
        fmtTime: fmtTime,
        fmtDayShort: fmtDayShort,
        fmtFull: fmtFull,
        tzLabel: tzLabel
    };
    root.LuigiScheduler = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    /* Below here is browser-only UI. */
    if (typeof document === 'undefined') return;

    /* ---------------------------------------------------------------------
       DOM helpers
       --------------------------------------------------------------------- */
    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
                else if (attrs[k] === true) node.setAttribute(k, '');
                else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(function (c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }
    function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
    function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

    var ICON_CHEVRON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';
    var ICON_CHEVRON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
    var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';

    /* ---------------------------------------------------------------------
       Config + shared state
       --------------------------------------------------------------------- */
    var CFG = root.LUIGI_CONFIG || {};
    var SCHED = CFG.scheduler || {};
    var AVAIL = CFG.availability || {};
    var REQ = CFG.requests || {};
    var CONTACT = CFG.contactEmail || '';
    var HOSTS = hostsOf(AVAIL);
    var DURATION = SCHED.durationMinutes || AVAIL.slotMinutes || 30;
    var LABEL = SCHED.meetingLabel || 'Consultation';

    var state = {
        slots: [],
        byDay: {},        // visitor-ymd → [slot]
        visitorTz: detectTimeZone(),
        selectedDay: null,
        selectedSlot: null,
        ui: {}
    };

    function regroup() {
        state.byDay = {};
        state.slots.forEach(function (s) {
            var k = ymdInZone(s.start, state.visitorTz);
            (state.byDay[k] = state.byDay[k] || []).push(s);
        });
    }

    /* ---------------------------------------------------------------------
       Global text substitutions (labels, contact links)
       --------------------------------------------------------------------- */
    function applyGlobals() {
        qsa('[data-meeting-label]').forEach(function (n) { n.textContent = LABEL; });
        qsa('[data-duration]').forEach(function (n) { n.textContent = String(DURATION); });
        if (CONTACT) {
            qsa('[data-contact-link]').forEach(function (a) {
                a.href = 'mailto:' + CONTACT;
                a.textContent = CONTACT;
            });
        }
    }

    /* ---------------------------------------------------------------------
       Hero "next available" card
       --------------------------------------------------------------------- */
    function renderHero() {
        var list = qs('#heroSlots');
        var card = qs('#heroCard');
        if (!list || !card) return;
        list.innerHTML = '';

        if (SCHED.mode === 'embed') {
            var kicker = qs('.hero-card-kicker', card);
            if (kicker) kicker.textContent = 'Book online';
            list.appendChild(el('li', { class: 'hero-slot-empty', text: DURATION + '-minute video call · pick any open time' }));
            var foot = qs('[data-hero-tz]', card);
            if (foot) foot.textContent = 'Instant confirmation';
            var link = qs('.hero-card-foot a', card);
            if (link) link.textContent = 'Book now →';
            return;
        }

        var tzNote = qs('[data-hero-tz]', card);
        if (tzNote) tzNote.textContent = 'Times in ' + tzLabel(state.visitorTz);

        var days = Object.keys(state.byDay).sort().slice(0, 3);
        if (!days.length) {
            list.appendChild(el('li', { class: 'hero-slot-empty', text: 'No open times in the next few weeks. Email us and we\'ll find one.' }));
            return;
        }
        days.forEach(function (day) {
            var slot = state.byDay[day][0];
            var btn = el('button', {
                type: 'button', class: 'hero-slot',
                'aria-label': 'Book ' + fmtDayShort(slot.start, state.visitorTz) + ' at ' + fmtTime(slot.start, state.visitorTz),
                onclick: function () { selectSlot(slot, true); }
            }, [
                el('span', { class: 'hero-slot-day', text: fmtDayShort(slot.start, state.visitorTz) }),
                el('span', { class: 'hero-slot-time', text: fmtTime(slot.start, state.visitorTz) + ' · ' + state.byDay[day].length + ' open' }),
                el('span', { class: 'hero-slot-arrow', 'aria-hidden': 'true', text: '→' })
            ]);
            list.appendChild(el('li', null, [btn]));
        });
    }

    /* ---------------------------------------------------------------------
       Builtin picker
       --------------------------------------------------------------------- */
    function renderBuiltin(shell) {
        shell.innerHTML = '';
        var ui = state.ui;

        /* --- Left: date + time picker --- */
        ui.tzSelect = el('select', { id: 'tzSelect', 'aria-label': 'Time zone', onchange: onTzChange });
        var tzList = COMMON_TZ.slice();
        if (tzList.indexOf(state.visitorTz) === -1) tzList.unshift(state.visitorTz);
        HOSTS.forEach(function (h) { if (tzList.indexOf(h.timezone) === -1) tzList.push(h.timezone); });
        tzList.forEach(function (tz) {
            ui.tzSelect.appendChild(el('option', { value: tz, text: tzLabel(tz), selected: tz === state.visitorTz }));
        });

        ui.strip = el('div', { class: 'date-strip', role: 'listbox', 'aria-label': 'Choose a date' });
        ui.prev = el('button', { type: 'button', class: 'strip-nav', 'aria-label': 'Earlier dates', html: ICON_CHEVRON_L, onclick: function () { scrollStrip(-1); } });
        ui.next = el('button', { type: 'button', class: 'strip-nav', 'aria-label': 'Later dates', html: ICON_CHEVRON_R, onclick: function () { scrollStrip(1); } });
        ui.timesTitle = el('h3', { text: 'Available times' });
        ui.timesCount = el('span');
        ui.timeGrid = el('div', { class: 'time-groups' });

        var left = el('div', { class: 'booking-left' }, [
            el('div', { class: 'booking-toolbar' }, [
                el('span', { class: 'booking-step' }, [el('span', { class: 'booking-step-num', text: '1' }), 'Pick a date & time']),
                el('label', { class: 'booking-tz' }, ['Time zone', ui.tzSelect])
            ]),
            el('div', { class: 'date-strip-wrap' }, [ui.prev, ui.strip, ui.next]),
            el('div', { class: 'times-head' }, [ui.timesTitle, ui.timesCount]),
            ui.timeGrid
        ]);

        /* --- Right: summary + form --- */
        ui.slotValue = el('dd', { class: 'slot-value' });
        var summary = el('div', { class: 'booking-summary' }, [
            el('dl', null, [
                el('dt', { text: 'Meeting' }), el('dd', { text: LABEL + ' · ' + DURATION + ' min' }),
                el('dt', { text: 'Where' }), el('dd', { text: SCHED.location || 'Video call' }),
                el('dt', { text: 'When' }), ui.slotValue
            ])
        ]);

        ui.alert = el('div', { class: 'form-alert', role: 'alert' });
        ui.submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block', text: 'Request this time' });

        ui.form = el('form', { class: 'booking-form', novalidate: true, onsubmit: onSubmit }, [
            el('div', { class: 'field-row' }, [
                field('name', 'Full name', 'text', { autocomplete: 'name', required: true }),
                field('email', 'Work email', 'email', { autocomplete: 'email', required: true })
            ]),
            field('company', 'Company', 'text', { autocomplete: 'organization', optional: true }),
            selectField('topic', 'What would you like to discuss?', [
                ['', 'Choose a topic'],
                ['Not sure yet', 'Not sure yet — help me explore'],
                ['AI strategy', 'Developing an AI strategy'],
                ['Process automation', 'Automating a process'],
                ['Implementation', 'Choosing or implementing AI tools'],
                ['Team training', 'Training my team'],
                ['Other', 'Something else']
            ]),
            textareaField('notes', 'Anything we should know?', 'A challenge you\'re facing, tools you already use, or questions you have.'),
            el('div', { class: 'hp', 'aria-hidden': 'true' }, [
                el('label', { for: 'website', text: 'Website' }),
                el('input', { type: 'text', id: 'website', name: 'website', tabindex: '-1', autocomplete: 'off' })
            ]),
            ui.alert,
            ui.submit,
            el('p', { class: 'form-note', text: 'We\'ll confirm by email within one business day. No spam, ever.' })
        ]);

        var right = el('div', { class: 'booking-right' }, [
            el('div', { class: 'booking-toolbar' }, [
                el('span', { class: 'booking-step' }, [el('span', { class: 'booking-step-num', text: '2' }), 'Your details'])
            ]),
            summary,
            ui.form
        ]);

        ui.layout = el('div', { class: 'booking-layout' }, [left, right]);
        shell.appendChild(ui.layout);

        renderStrip();
        renderTimes();
        renderSummary();
    }

    function field(name, label, type, o) {
        o = o || {};
        var input = el('input', { type: type, id: 'f-' + name, name: name, autocomplete: o.autocomplete, required: !!o.required });
        return el('div', { class: 'field' }, [
            el('label', { for: 'f-' + name }, [label, o.optional ? el('span', { class: 'opt', text: ' (optional)' }) : null]),
            input,
            el('span', { class: 'field-error', text: o.required ? 'Please enter your ' + label.toLowerCase() + '.' : '' })
        ]);
    }
    function selectField(name, label, options) {
        var sel = el('select', { id: 'f-' + name, name: name });
        options.forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })); });
        return el('div', { class: 'field' }, [el('label', { for: 'f-' + name, text: label }), sel]);
    }
    function textareaField(name, label, placeholder) {
        return el('div', { class: 'field' }, [
            el('label', { for: 'f-' + name }, [label, el('span', { class: 'opt', text: ' (optional)' })]),
            el('textarea', { id: 'f-' + name, name: name, rows: '3', placeholder: placeholder })
        ]);
    }

    function stripDays() {
        var today = ymdInZone(new Date(), state.visitorTz);
        var keys = Object.keys(state.byDay).sort();
        var last = keys.length ? keys[keys.length - 1] : today;
        var end = addDays(today, AVAIL.horizonDays || 21);
        if (last > end) end = last;
        var days = [];
        for (var d = today; d <= end; d = addDays(d, 1)) days.push(d);
        return days;
    }

    function renderStrip() {
        var ui = state.ui;
        ui.strip.innerHTML = '';
        var today = ymdInZone(new Date(), state.visitorTz);
        stripDays().forEach(function (ymd) {
            var has = !!state.byDay[ymd];
            var noon = noonOf(ymd, state.visitorTz);
            var cls = 'date-chip' + (ymd === state.selectedDay ? ' is-selected' : '') + (ymd === today ? ' is-today' : '');
            var chip = el('button', {
                type: 'button', class: cls, role: 'option', disabled: !has,
                'aria-selected': ymd === state.selectedDay ? 'true' : 'false',
                'aria-label': fmtDayLong(noon, state.visitorTz) + (has ? ', ' + state.byDay[ymd].length + ' times available' : ', unavailable'),
                onclick: function () { selectDay(ymd); }
            }, [
                el('span', { class: 'date-dow', text: fmt(noon, state.visitorTz, { weekday: 'short' }) }),
                el('span', { class: 'date-day', text: fmt(noon, state.visitorTz, { day: 'numeric' }) }),
                el('span', { class: 'date-mon', text: fmt(noon, state.visitorTz, { month: 'short' }) })
            ]);
            chip.dataset.ymd = ymd;
            ui.strip.appendChild(chip);
        });
        scrollSelectedIntoView();
    }

    function scrollStrip(dir) {
        var ui = state.ui;
        ui.strip.scrollBy({ left: dir * ui.strip.clientWidth * 0.8, behavior: 'smooth' });
    }

    function scrollSelectedIntoView() {
        var ui = state.ui;
        var sel = qs('.date-chip.is-selected', ui.strip);
        if (!sel) return;
        var left = sel.offsetLeft - ui.strip.offsetLeft - 8;
        ui.strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }

    function renderTimes() {
        var ui = state.ui;
        ui.timeGrid.innerHTML = '';
        var slots = state.selectedDay ? (state.byDay[state.selectedDay] || []) : [];
        if (!state.selectedDay || !slots.length) {
            ui.timesTitle.textContent = 'Available times';
            ui.timesCount.textContent = '';
            ui.timeGrid.appendChild(el('div', { class: 'booking-empty', text: Object.keys(state.byDay).length ? 'Choose a date to see open times.' : 'No open times in the next few weeks. Please email us and we\'ll find one.' }));
            return;
        }
        ui.timesTitle.textContent = fmtDayShort(slots[0].start, state.visitorTz);
        ui.timesCount.textContent = slots.length + ' open · ' + DURATION + ' min each';

        /* Long days are split into Morning / Afternoon / Evening for scanning. */
        var groups = slots.length > 12 ? groupByPeriod(slots) : [{ label: null, slots: slots }];
        groups.forEach(function (g) {
            var grid = el('div', { class: 'time-grid', role: 'group', 'aria-label': g.label || 'Available times' });
            g.slots.forEach(function (s) { grid.appendChild(timeButton(s)); });
            if (g.label) {
                ui.timeGrid.appendChild(el('div', { class: 'time-group' }, [
                    el('h4', { class: 'time-group-label', text: g.label + ' · ' + g.slots.length }),
                    grid
                ]));
            } else {
                ui.timeGrid.appendChild(grid);
            }
        });
    }

    function timeButton(s) {
        var isSel = state.selectedSlot && state.selectedSlot.start.getTime() === s.start.getTime();
        return el('button', {
            type: 'button', class: 'time-slot' + (isSel ? ' is-selected' : ''),
            'aria-pressed': isSel ? 'true' : 'false',
            text: fmtTime(s.start, state.visitorTz),
            onclick: function () { selectSlot(s, false); }
        });
    }

    function groupByPeriod(slots) {
        var order = ['Morning', 'Afternoon', 'Evening'];
        var buckets = { Morning: [], Afternoon: [], Evening: [] };
        slots.forEach(function (s) {
            var h = partsInZone(s.start, state.visitorTz).hour;
            buckets[h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'].push(s);
        });
        return order.filter(function (k) { return buckets[k].length; })
            .map(function (k) { return { label: k, slots: buckets[k] }; });
    }

    function renderSummary() {
        var ui = state.ui;
        ui.slotValue.innerHTML = '';
        if (!state.selectedSlot) {
            ui.slotValue.appendChild(el('span', { class: 'slot-unset', text: 'Choose a date and time first' }));
            return;
        }
        var s = state.selectedSlot;
        ui.slotValue.appendChild(document.createTextNode(fmtFull(s.start, state.visitorTz)));
        if (HOSTS.length === 1 && state.visitorTz !== HOSTS[0].timezone) {
            ui.slotValue.appendChild(el('span', { class: 'slot-secondary', text: fmtFull(s.start, HOSTS[0].timezone) + ' for Luigi AI' }));
        }
    }

    function selectDay(ymd) {
        state.selectedDay = ymd;
        if (state.selectedSlot && ymdInZone(state.selectedSlot.start, state.visitorTz) !== ymd) state.selectedSlot = null;
        renderStrip();
        renderTimes();
        renderSummary();
    }

    function selectSlot(slot, scrollTo) {
        state.selectedSlot = slot;
        state.selectedDay = ymdInZone(slot.start, state.visitorTz);
        if (state.ui.strip) { renderStrip(); renderTimes(); renderSummary(); }
        if (scrollTo) {
            var book = qs('#book');
            if (book) book.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function () { var n = qs('#f-name'); if (n) n.focus({ preventScroll: true }); }, 600);
        }
    }

    function onTzChange(e) {
        var tz = e.target.value;
        if (!isValidTimeZone(tz)) return;
        state.visitorTz = tz;
        regroup();
        if (state.selectedSlot) state.selectedDay = ymdInZone(state.selectedSlot.start, tz);
        else if (!state.byDay[state.selectedDay]) state.selectedDay = Object.keys(state.byDay).sort()[0] || null;
        renderStrip();
        renderTimes();
        renderSummary();
        renderHero();
    }

    /* ---------------------------------------------------------------------
       Submission
       --------------------------------------------------------------------- */
    function readForm() {
        var f = state.ui.form;
        return {
            name: f.name.value.trim(),
            email: f.email.value.trim(),
            company: f.company.value.trim(),
            topic: f.topic.value,
            notes: f.notes.value.trim(),
            website: f.website.value
        };
    }

    function validate(data) {
        var ok = true;
        var f = state.ui.form;
        qsa('.field', f).forEach(function (n) { n.classList.remove('has-error'); });
        if (!data.name) { f.name.closest('.field').classList.add('has-error'); ok = false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            var ef = f.email.closest('.field');
            ef.classList.add('has-error');
            qs('.field-error', ef).textContent = 'Please enter a valid email address.';
            ok = false;
        }
        return ok;
    }

    function showAlert(msg) {
        var a = state.ui.alert;
        a.textContent = msg;
        a.classList.add('is-visible');
    }
    function hideAlert() { state.ui.alert.classList.remove('is-visible'); }

    function buildPayload(data) {
        var s = state.selectedSlot;
        var visitorWhen = fmtFull(s.start, state.visitorTz);
        var available = s.hosts || [];
        var primary = HOSTS.filter(function (h) { return available.indexOf(h.name) !== -1; })[0] || HOSTS[0];
        var multi = HOSTS.length > 1;
        var ownerWhen = fmtFull(s.start, primary.timezone) + (multi ? ' (' + primary.name + ')' : '');
        var hostLines = HOSTS.map(function (h) {
            var line = h.name + ': ' + fmtFull(s.start, h.timezone);
            if (multi) line += available.indexOf(h.name) !== -1 ? ' — available' : ' — outside hours';
            return line;
        });
        var hostsAvailable = available.length ? available.join(', ') : primary.name;
        var message = [
            'Requested time: ' + ownerWhen,
            'Visitor local time: ' + visitorWhen + ' (' + state.visitorTz + ')',
            'Duration: ' + DURATION + ' minutes',
            'Slot ID (UTC): ' + s.start.toISOString(),
            '',
            'Team availability for this slot:',
            hostLines.map(function (l) { return '  ' + l; }).join('\n'),
            '',
            'Company: ' + (data.company || 'Not provided'),
            'Topic: ' + (data.topic || 'Not specified'),
            '',
            'Notes:',
            data.notes || '(none)'
        ].join('\n');

        return {
            /* Human-friendly fields */
            name: data.name,
            email: data.email,
            company: data.company,
            topic: data.topic,
            notes: data.notes,
            slot_owner_time: ownerWhen,
            slot_host_times: hostLines.join('\n'),
            hosts_available: hostsAvailable,
            slot_visitor_time: visitorWhen,
            slot_start_utc: s.start.toISOString(),
            slot_end_utc: s.end.toISOString(),
            visitor_timezone: state.visitorTz,
            duration_minutes: DURATION,
            /* EmailJS template compatibility (see EMAILJS_SETUP.md) */
            to_email: CONTACT,
            from_name: data.name,
            from_email: data.email,
            reply_to: data.email,
            interest: data.topic,
            message: message,
            /* Formspree extras */
            _subject: 'Consultation request: ' + data.name + ' — ' + ownerWhen,
            _replyto: data.email
        };
    }

    function chooseProvider() {
        var p = (REQ.provider || 'mailto').toLowerCase();
        if (p === 'formspree' && REQ.formspreeEndpoint) return 'formspree';
        if (p === 'emailjs' && REQ.emailjs && REQ.emailjs.publicKey && REQ.emailjs.serviceId && REQ.emailjs.templateId) return 'emailjs';
        return 'mailto';
    }

    function sendFormspree(payload) {
        return fetch(REQ.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (res) {
            if (res.ok) return true;
            return res.json().catch(function () { return {}; }).then(function (j) {
                throw new Error((j && j.errors && j.errors.map(function (e) { return e.message; }).join(', ')) || 'Formspree returned ' + res.status);
            });
        });
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = resolve; s.onerror = function () { reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
    }

    function sendEmailJs(payload) {
        var ready = root.emailjs ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js');
        return ready.then(function () {
            root.emailjs.init({ publicKey: REQ.emailjs.publicKey });
            return root.emailjs.send(REQ.emailjs.serviceId, REQ.emailjs.templateId, payload);
        });
    }

    function mailtoUrl(payload) {
        var body = [
            'Hi Luigi AI,',
            '',
            'I\'d like to book a ' + LABEL.toLowerCase() + '.',
            '',
            'Name: ' + payload.name,
            'Email: ' + payload.email,
            payload.message
        ].join('\n');
        return 'mailto:' + encodeURIComponent(CONTACT) +
            '?subject=' + encodeURIComponent(payload._subject) +
            '&body=' + encodeURIComponent(body);
    }

    function onSubmit(e) {
        e.preventDefault();
        hideAlert();
        var data = readForm();
        if (data.website) return; /* honeypot: silently drop bots */
        if (!state.selectedSlot) {
            showAlert('Please choose a date and time first.');
            if (state.ui.timeGrid) state.ui.timeGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        if (!validate(data)) { showAlert('Please check the highlighted fields.'); return; }

        var payload = buildPayload(data);
        var provider = chooseProvider();
        var ui = state.ui;
        ui.submit.disabled = true;
        ui.submit.textContent = 'Sending…';

        var job;
        if (provider === 'formspree') job = sendFormspree(payload);
        else if (provider === 'emailjs') job = sendEmailJs(payload);
        else job = Promise.resolve().then(function () { root.location.href = mailtoUrl(payload); });

        job.then(function () {
            renderSuccess(payload, provider);
        }).catch(function (err) {
            if (root.console) console.error('Booking request failed:', err);
            showAlert('Sorry, something went wrong sending your request. Please email ' + CONTACT + ' directly, or try again.');
            ui.submit.disabled = false;
            ui.submit.textContent = 'Request this time';
        });
    }

    function renderSuccess(payload, provider) {
        var shell = qs('#bookingShell');
        var s = state.selectedSlot;
        var detailsText = [
            'To: ' + CONTACT,
            'Subject: ' + payload._subject,
            '',
            'Name: ' + payload.name,
            'Email: ' + payload.email,
            payload.message
        ].join('\n');

        var heading = provider === 'mailto' ? 'One more step: send the email' : 'Request sent!';
        var body = provider === 'mailto'
            ? 'Your email app should have opened with everything filled in. Hit send and we\'ll confirm your time within one business day.'
            : 'Thanks, ' + payload.name.split(' ')[0] + '. We\'ll confirm your time by email within one business day and send a video link.';

        var calendar = renderCalendarOptions(s);
        var copyBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Copy request details', onclick: function () {
            copyText(detailsText).then(function () { copyBtn.textContent = 'Copied ✓'; });
        } });
        var againBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Choose a different time', onclick: function () {
            state.selectedSlot = null;
            renderBuiltin(shell);
        } });

        shell.innerHTML = '';
        shell.appendChild(el('div', { class: 'booking-success' }, [
            el('div', { class: 'success-icon', html: ICON_CHECK }),
            el('h3', { text: heading }),
            el('p', { text: body }),
            el('div', { class: 'success-slot' }, [
                fmtFull(s.start, state.visitorTz),
                el('small', { text: LABEL + ' · ' + DURATION + ' min · ' + (SCHED.location || 'Video call') })
            ]),
            calendar,
            el('div', { class: 'success-actions' }, [provider === 'mailto' ? copyBtn : null, againBtn]),
            provider === 'mailto'
                ? el('details', { class: 'success-details' }, [
                    el('summary', { text: 'Email app didn\'t open? Send these details to ' + CONTACT }),
                    el('pre', { text: detailsText })
                ])
                : null
        ]));
        shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        return new Promise(function (resolve) {
            var ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e) { /* ignore */ }
            document.body.removeChild(ta);
            resolve();
        });
    }

    function isIOS() {
        var ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function eventDetails(slot) {
        return {
            start: slot.start, end: slot.end, tentative: true,
            summary: 'Luigi AI — ' + LABEL + ' (awaiting confirmation)',
            description: 'Requested via ' + (CFG.siteUrl || 'luigiai.dev') + '. Luigi AI will confirm by email and send a video link.',
            location: SCHED.location || 'Video call'
        };
    }

    /**
     * Google / Outlook / Office 365 open by URL on every device. Apple Calendar
     * has no URL scheme, so it gets an .ics file; on iPhone Safari saves that
     * to Files rather than opening Calendar, so we say where to find it.
     */
    function renderCalendarOptions(slot) {
        var ev = eventDetails(slot);
        var links = calendarLinks(ev);
        var hint = el('p', { class: 'cal-hint', hidden: true });
        var link = function (label, href) {
            return el('a', { class: 'btn btn-soft btn-sm', href: href, target: '_blank', rel: 'noopener', text: label });
        };
        var apple = el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Apple Calendar (.ics)', onclick: function () {
            downloadIcs(ev);
            hint.textContent = isIOS()
                ? 'Saved to Files › Downloads. Open it there and tap "Add All" to put the hold in your Calendar.'
                : 'Open the downloaded .ics file to add the hold to your calendar.';
            hint.hidden = false;
        } });
        return el('div', { class: 'cal-options' }, [
            el('p', { class: 'cal-label', text: 'Hold this time in your calendar' }),
            el('div', { class: 'cal-buttons' }, [
                link('Google Calendar', links.google),
                link('Outlook.com', links.outlook),
                link('Office 365', links.office365),
                apple
            ]),
            hint,
            el('p', { class: 'cal-note', text: 'We\'ll send a proper invite with the video link once we confirm.' })
        ]);
    }

    function downloadIcs(ev) {
        var ics = buildIcs(ev);
        var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = el('a', { href: url, download: 'luigi-ai-consultation.ics' });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* ---------------------------------------------------------------------
       Embed mode (hosted scheduler)
       --------------------------------------------------------------------- */
    function embedSrc(url) {
        var u;
        try { u = new URL(url); } catch (e) { return url; }
        var host = u.hostname;
        if (/calendly\.com$/.test(host)) {
            u.searchParams.set('hide_gdpr_banner', '1');
            u.searchParams.set('primary_color', '0071bc');
            u.searchParams.set('text_color', '0f172a');
        } else if (/cal\.com$/.test(host)) {
            u.searchParams.set('theme', 'light');
        } else if (/calendar\.google\.com$/.test(host) || /calendar\.app\.google$/.test(host)) {
            u.searchParams.set('gv', 'true');
        }
        return u.toString();
    }

    function renderEmbed(shell) {
        var src = embedSrc(SCHED.embedUrl);
        shell.innerHTML = '';
        shell.appendChild(el('div', { class: 'booking-embed' }, [
            el('iframe', { src: src, title: 'Book a ' + LABEL.toLowerCase(), loading: 'lazy', allow: 'payment' }),
            el('p', { class: 'booking-embed-foot' }, [
                'Not loading? ',
                el('a', { href: SCHED.embedUrl, target: '_blank', rel: 'noopener', text: 'Open the booking page in a new tab' }),
                '.'
            ])
        ]));
    }

    /* ---------------------------------------------------------------------
       Boot
       --------------------------------------------------------------------- */
    function init() {
        applyGlobals();
        var shell = qs('#bookingShell');

        if (SCHED.mode === 'embed' && SCHED.embedUrl) {
            if (shell) renderEmbed(shell);
            renderHero();
            return;
        }

        try {
            state.slots = generateSlots(AVAIL, new Date());
        } catch (err) {
            if (root.console) console.error('Could not generate availability:', err);
            state.slots = [];
        }
        regroup();
        state.selectedDay = Object.keys(state.byDay).sort()[0] || null;

        if (shell) renderBuiltin(shell);
        renderHero();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})(typeof window !== 'undefined' ? window : globalThis);
