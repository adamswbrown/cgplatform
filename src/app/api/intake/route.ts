import { NextResponse } from "next/server";
import { CaseStatus } from "@prisma/client";
import { z } from "zod";
import { createCaseFromIntake, domainErrorMessage, isDomainError } from "@/lib/case-service";

const intakeApiSchema = z
  .object({
    primary: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
    }),
    secondary: z
      .object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
      })
      .optional(),
    notes: z.string().optional(),
    counsellingType: z.string().optional(),
    workflowCode: z.string().optional(),
    intakeSource: z.string().optional(),
    intakeExternalId: z.string().optional(),
    initialStatus: z.nativeEnum(CaseStatus).optional(),
    requestedDurationMinutes: z.number().int().positive().optional(),
    autoAllocate: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const payload = intakeApiSchema.parse(json);

    const result = await createCaseFromIntake(payload);

    return NextResponse.json(
      {
        ok: true,
        data: result,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.issues[0]?.message || "Invalid payload.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: domainErrorMessage(error),
      },
      { status: isDomainError(error) ? error.statusCode : 500 },
    );
  }
}
