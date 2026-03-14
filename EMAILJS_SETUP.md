# EmailJS Setup Instructions

This guide will help you configure EmailJS to send consultation form submissions to **alahiji@gmail.com**.

## Step 1: Create an EmailJS Account

1. Go to [https://www.emailjs.com/](https://www.emailjs.com/)
2. Click "Sign Up" and create a free account
3. Verify your email address

## Step 2: Add an Email Service

1. Go to the [Email Services](https://dashboard.emailjs.com/admin) page in your EmailJS dashboard
2. Click "Add New Service"
3. Choose **Gmail** as your email service
4. Click "Connect Account" and authorize EmailJS to use your Gmail account (alahiji@gmail.com)
5. Once connected, you'll see a **Service ID** (e.g., `service_abc123`) - **copy this ID**

## Step 3: Create an Email Template

1. Go to the [Email Templates](https://dashboard.emailjs.com/admin/templates) page
2. Click "Create New Template"
3. Use the following template configuration:

### Template Settings:
- **Template Name**: Luigi AI Consultation Request
- **Subject**: New Consultation Request from {{from_name}}

### Email Content (Body):
```
You have received a new consultation request from your Luigi AI website.

Client Details:
--------------
Name: {{from_name}}
Email: {{from_email}}
Company: {{company}}
Industry: {{industry}}

Interest:
---------
{{interest}}

Message:
--------
{{message}}

---
This email was sent from the Luigi AI consultation form.
Reply directly to this email to respond to the client.
```

### Template Variables:
Make sure these variables are included in your template:
- `{{to_email}}` - Recipient email (alahiji@gmail.com)
- `{{from_name}}` - Client's name
- `{{from_email}}` - Client's email
- `{{company}}` - Client's company
- `{{industry}}` - Client's industry
- `{{interest}}` - What they're interested in
- `{{message}}` - Additional message from client
- `{{reply_to}}` - Reply-to address (client's email)

4. In the "To email" field, enter: `{{to_email}}`
5. In the "Reply to" field, enter: `{{reply_to}}`
6. Click "Save" and copy the **Template ID** (e.g., `template_xyz789`)

## Step 4: Get Your Public Key

1. Go to [Account Settings](https://dashboard.emailjs.com/admin/account)
2. Find your **Public Key** (it looks like a random string, e.g., `aBcDeFgHiJkLmNoPqR`)
3. Copy this key

## Step 5: Update Your Website Code

Open `script.js` and replace the placeholder values with your actual EmailJS credentials:

1. Replace `YOUR_PUBLIC_KEY` with your actual Public Key (line 51)
2. Replace `YOUR_SERVICE_ID` with your Service ID (line 86)
3. Replace `YOUR_TEMPLATE_ID` with your Template ID (line 86)

### Example:
```javascript
// Before:
emailjs.init('YOUR_PUBLIC_KEY');

// After:
emailjs.init('aBcDeFgHiJkLmNoPqR');

// Before:
const response = await emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', {

// After:
const response = await emailjs.send('service_abc123', 'template_xyz789', {
```

## Step 6: Test Your Form

1. Open your website in a browser
2. Fill out the consultation form
3. Submit the form
4. Check your email at alahiji@gmail.com for the consultation request

## Troubleshooting

### Emails not being received?
- Check your spam/junk folder
- Verify all three IDs (Public Key, Service ID, Template ID) are correct
- Check the browser console for error messages
- Make sure you've verified your EmailJS account

### Rate Limits
- Free EmailJS accounts have a limit of 200 emails per month
- If you need more, consider upgrading to a paid plan

### Email Template Not Working?
- Make sure all template variables match exactly (case-sensitive)
- Verify the "To email" field is set to `{{to_email}}`
- Check that the "Reply to" field is set to `{{reply_to}}`

## Alternative: Using a Different Email Service

If you prefer not to use Gmail, EmailJS supports other services:
- Outlook/Office 365
- Yahoo
- Custom SMTP
- And many more

Simply choose a different service in Step 2.

## Security Note

Your EmailJS Public Key is safe to expose in client-side code. However, never expose your Private Key if you use one.

---

For more help, visit the [EmailJS Documentation](https://www.emailjs.com/docs/)
