# Outlook Calendar Sync Setup Guide

This guide covers configuring the Microsoft Graph integration so the admin team can manage counsellor availability through Outlook, with the platform syncing those calendars to pick up blocked time and exceptions.

## How It Works

Counsellors have fixed, recurring availability (e.g. Tuesday and Thursday 5-9pm). This base pattern is set once in the platform by ops. The admin team then manages exceptions — holidays, breaks, blocked periods — in Outlook. The platform syncs from Outlook to layer those exceptions on top of the base pattern.

```
Base availability (set once in platform)
  "Jane: Tues/Thurs 5-9pm"
        +
Exceptions (managed in Outlook by admin)
  "Jane: Out of office 10 Mar - 21 Apr"
        =
Effective availability (what ops sees in the assignment board)
  "Jane: Tues/Thurs 5-9pm, except 10 Mar - 21 Apr"
```

The sync reads Outlook free/busy status. Any time marked as **busy**, **tentative**, **out of office**, or **working elsewhere** in Outlook becomes an out-of-office window in the platform. Free time is ignored — the base pattern handles that.

### What the admin team does

- Each counsellor has an email address on the organisation's Office 365 tenant (e.g. `jane@cguidelines.org.uk`).
- When a counsellor needs time off, the admin team creates a calendar event in that counsellor's Outlook calendar (or uses the Outlook scheduling assistant) marking the period as **Busy** or **Out of Office**.
- When a counsellor finishes with a client and needs a six-week break, admin blocks out those six weeks in Outlook.
- An ops or admin user then clicks **Sync from Outlook** on the counsellor's availability page in the platform.
- The platform reads the free/busy data and creates out-of-office windows for every blocked period.
- The counsellor's base availability remains intact — when the blocked period ends, the next sync finds no Outlook conflicts and the counsellor's normal slots become active again.

### What counsellors do

Nothing. Counsellors do not need to log into Outlook, manage their own calendars, or interact with the platform's availability system. The organisation manages everything on their behalf.

## Prerequisites

- An Azure Active Directory (Entra ID) tenant with Office 365 licences for counsellors
- Counsellor email addresses on the tenant domain (e.g. `@cguidelines.org.uk`)
- A Global Administrator or Application Administrator to register the app and grant consent
- Access to the deployment environment variables

## Step 1: Register an App in Azure AD

1. Go to the [Azure Portal](https://portal.azure.com) and navigate to **Azure Active Directory** > **App registrations**.
2. Click **New registration**.
3. Set:
   - **Name**: `CG Platform Calendar Sync` (or similar)
   - **Supported account types**: Accounts in this organizational directory only (single tenant)
   - **Redirect URI**: Leave blank (not needed for app-only auth)
4. Click **Register**.
5. On the app's overview page, note the:
   - **Application (client) ID** — this is your `MICROSOFT_GRAPH_CLIENT_ID`
   - **Directory (tenant) ID** — this is your `MICROSOFT_GRAPH_TENANT_ID`

## Step 2: Create a Client Secret

1. In the app registration, go to **Certificates & secrets** > **Client secrets**.
2. Click **New client secret**.
3. Set a description (e.g. `cgplatform-production`) and expiry (24 months recommended).
4. Click **Add**.
5. Copy the **Value** immediately — it won't be shown again. This is your `MICROSOFT_GRAPH_CLIENT_SECRET`.

## Step 3: Grant API Permissions

1. In the app registration, go to **API permissions**.
2. Click **Add a permission** > **Microsoft Graph** > **Application permissions**.
3. Search for and add: **`Calendars.Read`**
   - This allows the app to read free/busy data for all users in the tenant.
   - `Schedule.Read.All` also works if you prefer a narrower scope.
4. Click **Add permissions**.
5. Click **Grant admin consent for [your tenant]** and confirm.
   - The status column should show a green tick for each permission.

> **Note**: Application permissions require admin consent because they apply tenant-wide. Counsellors do not need to individually consent.

## Step 4: Set Environment Variables

Add these to your deployment environment:

```
MICROSOFT_GRAPH_AUTH_MODE=client_secret
MICROSOFT_GRAPH_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_GRAPH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_GRAPH_CLIENT_SECRET=your-client-secret-value
```

If deploying to Azure with Managed Identity instead, set:

```
MICROSOFT_GRAPH_AUTH_MODE=managed_identity
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

And assign the `Calendars.Read` permission to the managed identity via the Azure CLI or Portal.

## Step 5: Ensure Counsellor Emails Are Configured

Each counsellor's Specialist profile in the platform must have their Office 365 email address set. This is the `email` field on the Specialist record. The sync uses this email to look up their Outlook calendar.

You can verify this at `/admin/specialists/[id]` — the email should match their `@cguidelines.org.uk` (or equivalent) address.

## Step 6: Set Up Base Availability

Before syncing exceptions from Outlook, set up each counsellor's recurring base availability in the platform:

1. Go to `/admin/specialists/[id]/availability`.
2. Use the batch preset tool to mark the counsellor's regular hours:
   - Select a date range (e.g. the next 6 weeks)
   - Choose the time blocks that match their schedule (Morning: 9:30-12:30, Afternoon: 1-4pm, Evening: 5-9pm Tues/Thurs)
   - Click to apply
3. Repeat when the current batch expires (or extend further ahead).

This base pattern tells the platform when the counsellor *could* be available. The Outlook sync then removes any times they *can't* be.

## Step 7: Sync from Outlook

1. Go to a counsellor's availability page: `/admin/specialists/[id]/availability`.
2. Click the **Sync from Outlook** button.
3. The system reads the next 28 days of the counsellor's Outlook calendar.
4. Any busy/tentative/out-of-office blocks are created as out-of-office windows in the platform.
5. Previous sync windows in the same date range are automatically cleared and replaced.
6. A summary is shown: windows created, skipped, and old entries cleared.

The sync is **idempotent** — you can run it multiple times safely. It always replaces the previous sync data.

## Environment Variables Summary

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `MICROSOFT_GRAPH_AUTH_MODE` | Yes | `client_secret` | Auth method: `client_secret` or `managed_identity` |
| `MICROSOFT_GRAPH_TENANT_ID` | Yes (client_secret mode) | `xxxxxxxx-xxxx-...` | Azure AD tenant ID |
| `MICROSOFT_GRAPH_CLIENT_ID` | Yes (client_secret mode) | `xxxxxxxx-xxxx-...` | App registration client ID |
| `MICROSOFT_GRAPH_CLIENT_SECRET` | Yes (client_secret mode) | `secret-value` | App registration client secret |
| `AZURE_CLIENT_ID` | Optional (managed_identity mode) | `xxxxxxxx-xxxx-...` | User-assigned managed identity client ID |

## Admin Team Workflow — Day to Day

### Setting up a new counsellor

1. Create the Specialist profile in the platform with their Office 365 email.
2. Set their base availability pattern (batch preset for the next 6 weeks).
3. If they have any known upcoming absences, block those in their Outlook calendar.
4. Run **Sync from Outlook** to pull in the blocks.

### Counsellor takes a break

1. Open the counsellor's Outlook calendar.
2. Create an event covering the break period (e.g. "Break - 6 weeks"). Mark it as **Busy** or **Out of Office**.
3. In the platform, go to their availability page and click **Sync from Outlook**.
4. The blocked period appears as out-of-office, preventing new assignments.

### Counsellor returns from a break

1. The Outlook block event ends naturally (or delete it manually if they're back early).
2. Run **Sync from Outlook** again — the old block is cleared and not recreated.
3. The counsellor's base availability is active again.

### Extending availability into the future

1. As weeks pass, the base availability pattern needs extending.
2. Use the batch preset tool to add the next 4-6 weeks.
3. Run **Sync from Outlook** to apply any future exceptions.

### Ad-hoc unavailability (sick day, single session cancellation)

1. Add a busy event in the counsellor's Outlook calendar for the specific time.
2. Run **Sync from Outlook**.
3. That slot is blocked. Other slots remain available.

## How the Sync Handles Different Outlook Statuses

| Outlook Status | Platform Result |
|---------------|----------------|
| **Free** | Ignored — base pattern handles availability |
| **Busy** | Creates out-of-office window |
| **Tentative** | Creates out-of-office window (treats as blocked) |
| **Out of Office** | Creates out-of-office window |
| **Working Elsewhere** | Creates out-of-office window |

## Technical Details

- **Sync range**: 28 days from today (configurable in the API call, max 62 days).
- **Source tracking**: All sync-created windows are tagged with source `outlook_calendar_sync`. Manual windows from other sources are never touched.
- **Merge logic**: Adjacent busy blocks are merged into continuous periods to avoid creating many small windows.
- **Minimum block**: Busy periods shorter than 30 minutes are skipped.
- **Deduplication**: If an existing out-of-office window (from any source) already covers a busy period, it's skipped.
- **Graph API endpoint**: `POST /users/{email}/calendar/getSchedule` with application permissions.
- **Token caching**: The Graph access token is cached and reused until 60 seconds before expiry.

## Troubleshooting

### "Specialist has no email configured"

The Specialist profile is missing the `email` field. Go to `/admin/specialists/[id]` and add their Office 365 email address.

### "Microsoft Graph getSchedule failed (403)"

The app registration doesn't have the correct permissions, or admin consent hasn't been granted. Check:

1. The app has `Calendars.Read` under **Application permissions** (not Delegated).
2. Admin consent has been granted (green tick in the Azure Portal).
3. The environment variables match the app registration.

### "Microsoft Graph getSchedule failed (404)"

The counsellor's email address doesn't match a user in the Azure AD tenant. Verify the email on the Specialist profile matches their actual Office 365 account.

### Sync runs but creates no windows

The counsellor's Outlook calendar has no busy/tentative/OOF events in the sync range. Check:

- The date range being synced (default: next 28 days).
- That the admin has actually created blocking events in the counsellor's calendar.
- That the events are marked as Busy or Out of Office (not Free).

### Old blocks not being removed

The sync only clears windows tagged with source `outlook_calendar_sync`. Manually-created out-of-office windows (source `ops_calendar` or similar) are preserved by design. If you need to remove those, do it from the availability calendar in the platform.

### Token/authentication errors

- Verify `MICROSOFT_GRAPH_AUTH_MODE` matches your setup.
- For `client_secret` mode: check all three variables are set and the secret hasn't expired.
- For `managed_identity` mode: check the identity has the correct Graph permissions.
- Restart the application after changing environment variables.
