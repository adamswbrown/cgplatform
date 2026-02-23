# Resend Setup Guide

This guide covers configuring the Resend email service for sending transactional emails and tracking delivery status via webhooks.

## Prerequisites

- A [Resend](https://resend.com) account
- A verified sending domain in Resend (or use `onboarding@resend.dev` for testing)
- Access to your deployment environment variables

## Step 1: Create an API Key

1. Log in to [Resend](https://resend.com).
2. Go to **API Keys** in the left sidebar.
3. Click **Create API Key**.
4. Name it something identifiable (e.g. `cgplatform-production`).
5. Set permission to **Sending access** (full access is not needed).
6. Optionally scope it to your verified domain.
7. Copy the key — it starts with `re_`.

Set the environment variable:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 2: Configure the Sender Address

Set the `from` address to an address on your verified domain:

```
CONFIRMATION_EMAIL_FROM=noreply@yourdomain.com
```

If you are testing without a verified domain, Resend provides a shared sandbox address (`onboarding@resend.dev`) but emails will only deliver to the account owner's email.

## Step 3: Create a Webhook for Delivery Tracking

1. In the Resend dashboard, go to **Webhooks** in the left sidebar.
2. Click **Add Endpoint**.
3. Set the **Endpoint URL** to your deployed application:
   ```
   https://your-app-domain.com/api/webhooks/resend
   ```
4. Subscribe to the following events:
   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.opened`
   - `email.clicked`
   - `email.bounced`
   - `email.complained`
   - `email.failed`
5. Click **Create**.
6. Copy the **Signing Secret** shown after creation (starts with `whsec_`).

Set the environment variable:

```
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 4: Verify the Webhook

Resend provides a **Send Test Event** button on the webhook detail page. Use it to verify your endpoint is reachable and responding with `200 OK`.

You can also test locally using the signing secret and a curl command, but note that signature verification will fail unless you construct a valid Svix signature.

## Environment Variables Summary

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `RESEND_API_KEY` | Yes (for email sending) | `re_abc123...` | Authenticates API requests to Resend |
| `CONFIRMATION_EMAIL_FROM` | Yes (for email sending) | `noreply@yourdomain.com` | Sender address on outgoing emails |
| `RESEND_WEBHOOK_SECRET` | Yes (for delivery tracking) | `whsec_abc123...` | Verifies incoming webhook signatures |

All three variables must be set for the full send + track workflow. Without `RESEND_API_KEY`, emails are logged to console but not sent. Without `RESEND_WEBHOOK_SECRET`, the webhook endpoint returns a 500 error.

## Using the Same Resend Account for Multiple Projects

A single Resend account can serve multiple projects:

- **Create separate API keys** per project for isolated access control.
- **Create separate webhooks** per project, each pointing to its own endpoint URL. Each webhook gets its own signing secret.
- **Share or separate sending domains** based on your branding needs.
- **Rate limits are shared** across all API keys in the account (2 requests/second by default). This is fine for typical transactional volumes but worth monitoring if both projects scale up.

## How Tracking Works

### Delivery lifecycle

```
SENT → DELIVERED → OPENED → CLICKED
                 ↘ BOUNCED (terminal)
                 ↘ COMPLAINED (terminal)
                 ↘ FAILED (terminal)
         DELIVERY_DELAYED (transient, can resolve to DELIVERED)
```

### What the ops team sees

In the case detail Emails tab (`/admin/cases/:id?panel=emails`):

- Each email shows a colour-coded badge for its current delivery status.
- An expandable **Event timeline** shows every delivery event in chronological order.
- **Bounce reasons** are shown when an email bounces.
- **Clicked URLs** are shown in the timeline when a recipient clicks a link.
- A separate **Responded** badge appears when the client submits the form the email linked to.

### Open tracking limitations

Open tracking uses a 1x1 tracking pixel embedded in the email HTML. It will not fire when:

- The recipient's email client blocks remote images (common in Outlook desktop).
- Apple Mail Privacy Protection is enabled (pre-fetches images, may report false opens).
- The recipient reads the email in plain-text mode.

As a result, "Opened" status should be treated as a positive signal when present, but its absence does not necessarily mean the email was not read.

## Troubleshooting

### Emails not sending

- Check that `RESEND_API_KEY` is set and valid.
- Check that `CONFIRMATION_EMAIL_FROM` uses a verified domain.
- Check application logs for `[mailer]` prefixed messages.

### Webhook events not arriving

- Verify the endpoint URL is publicly reachable (not `localhost`).
- Check that `RESEND_WEBHOOK_SECRET` matches the signing secret shown in the Resend dashboard.
- Check application logs for `[resend-webhook]` prefixed messages.
- In the Resend dashboard, check the webhook's delivery log for failed attempts.

### Status stuck on "Sent"

- The webhook endpoint may not be configured or reachable.
- Resend retries failed webhook deliveries, so events may arrive with a delay.
- Check the Resend dashboard webhook logs for delivery failures.

### Bounce with no reason shown

- Not all bounce events include a detailed reason. The bounce reason depends on what the recipient's mail server reports back to Resend.
