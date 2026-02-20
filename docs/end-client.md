# End Client Guide

This guide covers the secure client journey.

## 1) Receive Secure Link + PIN

Ops sends:

- A secure access link (for example `/intake/access/:accessKey`)
- A PIN code

The link and PIN can expire and can be disabled by operations.

## 2) Verify PIN

Route: `/intake/access/:accessKey`

1. Open link.
2. Enter PIN.
3. Continue to intake form if verification succeeds.

## 3) Complete Application for Counselling

Route: `/intake`

The intake is multi-step and includes:

- Applicant profile details
- Presenting concerns and safeguarding questions
- Availability preferences (location, online option, time blocks)
- Signature/consent data

## 4) Submission Confirmation

Route: `/intake/success`

After submit, client receives:

- Confirmation that the application has been received.
- Crisis and helpline information.

## 5) Complete Follow-up Forms

Route: `/forms/access/:accessKey`

When required, ops issues additional PIN-gated forms:

- Terms of Counselling
- Consent / agreement forms
- Outtake form

Completion updates workflow state and scheduling eligibility.

