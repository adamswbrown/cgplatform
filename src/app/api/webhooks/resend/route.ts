import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { processResendWebhookEvent } from "@/lib/email-tracking";

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { ok: false, error: "Webhook not configured" },
      { status: 500 },
    );
  }

  // Read the raw body for signature verification
  const body = await request.text();

  // Extract Svix headers used for verification
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { ok: false, error: "Missing svix headers" },
      { status: 400 },
    );
  }

  // Verify the webhook signature
  const wh = new Webhook(webhookSecret);
  let payload: { type: string; created_at: string; data: { email_id: string; [key: string]: unknown } };

  try {
    payload = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof payload;
  } catch {
    console.warn("[resend-webhook] Signature verification failed");
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  try {
    const result = await processResendWebhookEvent(payload);

    if (!result.processed) {
      console.info(`[resend-webhook] Event skipped: ${result.reason}`);
    }

    // Always return 200 so Resend doesn't retry events we intentionally skip
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[resend-webhook] Processing error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal processing error" },
      { status: 500 },
    );
  }
}
