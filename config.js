/*
 * Luigi AI — site configuration
 * ------------------------------------------------------------
 * Everything the booking flow needs to know lives here, so you
 * never have to touch the HTML or the scheduler code.
 *
 * See SCHEDULING.md for the full walkthrough of each option.
 */
window.LUIGI_CONFIG = {
  /* Where consultation requests are delivered. */
  contactEmail: "alahiji@gmail.com",

  /* Public site URL (used for SEO tags and calendar invites). */
  siteUrl: "https://luigiai.dev",

  scheduler: {
    /*
     * "builtin" — visitors pick a slot from the availability rules below
     *             and the request is emailed to you (no backend required).
     * "embed"   — a hosted scheduler (Cal.com, Calendly, Google Calendar
     *             appointment schedule, Microsoft Bookings…) is embedded
     *             and handles real-time availability + confirmations.
     */
    mode: "builtin",

    /* Only used when mode === "embed". Paste your public booking link. */
    embedUrl: "",

    /* Shown throughout the page. */
    meetingLabel: "Free intro call",
    durationMinutes: 30,
    location: "Video call (Google Meet link sent on confirmation)"
  },

  /* Used by the "builtin" scheduler. Times are in `timezone`. */
  availability: {
    timezone: "America/Chicago",
    slotMinutes: 30,
    /* Earliest a visitor may book, in hours from now. */
    minNoticeHours: 24,
    /* How many days ahead visitors can see. */
    horizonDays: 21,
    /* Weekly working windows, 24h "HH:MM" pairs. Leave a day out to close it. */
    weekly: {
      mon: [["09:00", "12:00"], ["13:00", "17:00"]],
      tue: [["09:00", "12:00"], ["13:00", "17:00"]],
      wed: [["09:00", "12:00"], ["13:00", "17:00"]],
      thu: [["09:00", "12:00"], ["13:00", "17:00"]],
      fri: [["09:00", "12:00"], ["13:00", "15:00"]]
    },
    /* Whole days to hide, "YYYY-MM-DD" in `timezone`. */
    blackoutDates: [],
    /* Individual slots already taken, as ISO 8601 UTC strings
       (copy them from the request email). */
    bookedSlots: []
  },

  /* How the builtin scheduler sends the request. */
  requests: {
    /*
     * "mailto"    — opens the visitor's email app with the details prefilled.
     *               Works with zero setup; used automatically as a fallback.
     * "formspree" — POSTs to Formspree (https://formspree.io). Recommended.
     * "emailjs"   — sends via EmailJS (see EMAILJS_SETUP.md).
     */
    provider: "mailto",
    formspreeEndpoint: "",          // e.g. "https://formspree.io/f/abcdwxyz"
    emailjs: {
      publicKey: "",
      serviceId: "",
      templateId: ""
    }
  }
};
