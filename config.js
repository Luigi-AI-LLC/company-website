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
    meetingLabel: "Free intro video call",
    durationMinutes: 30,
    location: "Virtual video call (meeting link sent on confirmation)"
  },

  /*
   * Used by the "builtin" scheduler.
   *
   * Each host has their own time zone and weekly hours, written in THAT
   * host's local time. Visitors see the union of everyone's availability,
   * and each request email says which host(s) are free for the chosen slot.
   */
  availability: {
    slotMinutes: 30,
    /* Earliest a visitor may book, in hours from now. */
    minNoticeHours: 24,
    /* How many days ahead visitors can see. */
    horizonDays: 21,

    hosts: [
      {
        name: "McAllen, TX",
        timezone: "America/Chicago",
        /* Weekly windows as 24h "HH:MM" pairs. Leave a day out to close it. */
        weekly: {
          mon: [["19:00", "22:00"]],
          tue: [["19:00", "22:00"]],
          wed: [["19:00", "22:00"]],
          thu: [["19:00", "22:00"]],
          fri: [["19:00", "22:00"]],
          sat: [["08:00", "22:00"]],
          sun: [["08:00", "22:00"]]
        },
        /* Whole days off for this host, "YYYY-MM-DD" in their time zone. */
        blackoutDates: []
      },
      {
        name: "Muscat, Oman",
        timezone: "Asia/Muscat",
        weekly: {
          mon: [["12:00", "16:00"]],
          tue: [["12:00", "16:00"]],
          wed: [["12:00", "16:00"]],
          thu: [["12:00", "16:00"]],
          fri: [["12:00", "16:00"]],
          sat: [["08:00", "22:00"]],
          sun: [["08:00", "22:00"]]
        },
        blackoutDates: []
      }
    ],

    /* Individual slots already taken (hidden for every host), as ISO 8601
       UTC strings. Copy the "Slot ID" from the request email. */
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
