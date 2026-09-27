# EmailJS setup (optional)

EmailJS is one of three ways the built-in scheduler can deliver consultation
requests to **alahiji@gmail.com**. Formspree is simpler (see `SCHEDULING.md`);
use EmailJS if you prefer it or already have an account.

## 1. Create an account and connect Gmail

1. Sign up at https://www.emailjs.com/ and verify your email.
2. *Email Services* → *Add New Service* → **Gmail** → connect
   `alahiji@gmail.com`.
3. Copy the **Service ID** (e.g. `service_abc123`).

## 2. Create the template

*Email Templates* → *Create New Template*:

- **Subject:** `Consultation request: {{from_name}} — {{slot_owner_time}}`
- **To email:** `{{to_email}}`
- **Reply to:** `{{reply_to}}`
- **Body:**

```
New consultation request from luigiai.dev

Name:     {{from_name}}
Email:    {{from_email}}
Company:  {{company}}
Topic:    {{interest}}

Requested time
  Primary host:      {{slot_owner_time}}
  All hosts:
{{slot_host_times}}
  Available:         {{hosts_available}}
  Visitor time zone: {{slot_visitor_time}} ({{visitor_timezone}})
  Duration:          {{duration_minutes}} minutes
  Slot ID (UTC):     {{slot_start_utc}}

Notes
{{notes}}

---
Full message:
{{message}}
```

Save it and copy the **Template ID** (e.g. `template_xyz789`).

### Variables the site sends

| Variable | Content |
|---|---|
| `to_email` | Your address from `config.js` |
| `from_name`, `from_email`, `reply_to` | Visitor's name and email |
| `company` | Company (may be empty) |
| `interest` / `topic` | Chosen discussion topic |
| `notes` | Free-text notes |
| `message` | Everything above in one plain-text block |
| `slot_owner_time` | Requested time for the first available host, e.g. `Sat, Oct 3, 2026, 9:00 AM CDT (McAllen, TX)` |
| `slot_host_times` | The slot in every host's time zone, one per line, marked available / outside hours |
| `hosts_available` | Comma-separated names of the hosts free for this slot |
| `slot_visitor_time`, `visitor_timezone` | Same instant as the visitor saw it |
| `slot_start_utc`, `slot_end_utc` | ISO timestamps; paste `slot_start_utc` into `bookedSlots` to hide the slot |
| `duration_minutes` | Meeting length |

## 3. Get your public key

*Account* → *General* → copy the **Public Key**.

## 4. Configure the site

Open `config.js` and fill in the `requests` block:

```js
requests: {
  provider: "emailjs",
  formspreeEndpoint: "",
  emailjs: {
    publicKey: "aBcDeFgHiJkLmNoPqR",
    serviceId: "service_abc123",
    templateId: "template_xyz789"
  }
}
```

The EmailJS script is only loaded when a visitor submits the form, and only if
all three values are present. If any is missing the site silently falls back
to the `mailto` flow, so a half-finished setup never breaks the page.

## 5. Test

Open the site, pick a slot, submit a request, and check your inbox (and spam
folder). The browser console shows any EmailJS error.

## Notes

- Free tier: 200 emails per month.
- The public key is safe to expose in client-side code. Never put a private
  key in `config.js`.
- Restrict the key to `luigiai.dev` in the EmailJS dashboard (*Account* →
  *Security*) to stop other sites from using your quota.
