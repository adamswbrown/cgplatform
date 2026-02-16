import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidFormAccessSession } from "@/lib/form-access";

const searchSchema = z.object({
  accessKey: z.string().min(1),
  formType: z.string().optional(),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = searchSchema.safeParse({
    accessKey: params.get("accessKey") || "",
    formType: params.get("formType") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        authorized: false,
        error: parsed.error.issues[0]?.message || "accessKey is required.",
      },
      { status: 400 },
    );
  }

  const session = await hasValidFormAccessSession({
    accessKey: parsed.data.accessKey,
    formType: parsed.data.formType,
  });

  return NextResponse.json(
    {
      ok: true,
      authorized: Boolean(session),
      data: session
        ? {
            accessKey: session.accessKey,
            formType: session.formType,
            caseId: session.caseId,
            caseReference: session.caseReference,
            participantEmail: session.participantEmail,
            participantName: session.participantName,
            expiresAt: session.expiresAt.toISOString(),
          }
        : null,
    },
    { status: 200 },
  );
}
