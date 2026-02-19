import { PrismaClient, WorkflowStepCode, WorkflowStepType } from "@prisma/client";

const prisma = new PrismaClient();
const LEGACY_FORM_TYPE = "AVAILABILITY_SUBMISSION";
const MODERN_STEP_CODE = WorkflowStepCode.AVAILABILITY_CAPTURED;

function normalizeAvailabilityStepName(step) {
  const alreadyHasBoth = Boolean(step.requiresAllParticipants) ||
    step.name.toLowerCase().includes("both participants");
  return alreadyHasBoth
    ? "Availability captured from intake (both participants)"
    : "Availability captured from intake";
}

function toNumber(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return Number(value || 0);
}

async function main() {
  const legacySteps = await prisma.caseWorkflowStep.findMany({
    where: {
      OR: [
        {
          formType: {
            equals: LEGACY_FORM_TYPE,
            mode: "insensitive",
          },
        },
        {
          name: {
            equals: LEGACY_FORM_TYPE,
            mode: "insensitive",
          },
        },
        {
          name: {
            contains: "availability submission",
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      formType: true,
      requiresAllParticipants: true,
    },
  });

  let normalizedSteps = 0;
  for (const step of legacySteps) {
    await prisma.caseWorkflowStep.update({
      where: {
        id: step.id,
      },
      data: {
        name: normalizeAvailabilityStepName(step),
        type: WorkflowStepType.SYSTEM,
        stepCode: MODERN_STEP_CODE,
        formType: null,
        requiresAllParticipants:
          step.requiresAllParticipants || step.name.toLowerCase().includes("both participants"),
      },
    });
    normalizedSteps += 1;
  }

  const backfilledModernSteps = await prisma.caseWorkflowStep.updateMany({
    where: {
      stepCode: null,
      type: WorkflowStepType.SYSTEM,
      name: {
        contains: "availability captured",
        mode: "insensitive",
      },
    },
    data: {
      stepCode: MODERN_STEP_CODE,
    },
  });

  const workflowStateMetadataUpdated = await prisma.$executeRaw`
    UPDATE "CaseWorkflowState"
    SET
      "metadata" = (COALESCE("metadata", '{}'::jsonb) - 'formType')
        || jsonb_build_object('stepCode', ${MODERN_STEP_CODE}),
      "updatedAt" = NOW()
    WHERE "metadata"->>'formType' = ${LEGACY_FORM_TYPE}
  `;

  const auditDetailsUpdated = await prisma.$executeRaw`
    UPDATE "AuditLog"
    SET "details" = (COALESCE("details", '{}'::jsonb) - 'formType')
      || jsonb_build_object('stepCode', ${MODERN_STEP_CODE})
    WHERE "details"->>'formType' = ${LEGACY_FORM_TYPE}
  `;

  const deletedLegacyPins = await prisma.formAccessPin.deleteMany({
    where: {
      formType: {
        equals: LEGACY_FORM_TYPE,
        mode: "insensitive",
      },
    },
  });

  const remainingLegacyStepRecords = await prisma.caseWorkflowStep.count({
    where: {
      OR: [
        {
          formType: {
            equals: LEGACY_FORM_TYPE,
            mode: "insensitive",
          },
        },
        {
          name: {
            equals: LEGACY_FORM_TYPE,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  const remainingLegacyWorkflowMetadata = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "CaseWorkflowState"
    WHERE "metadata"->>'formType' = ${LEGACY_FORM_TYPE}
  `;

  const remainingLegacyMetadataCount = Array.isArray(remainingLegacyWorkflowMetadata)
    ? Number(remainingLegacyWorkflowMetadata[0]?.count || 0)
    : 0;

  const summary = {
    normalizedSteps,
    backfilledModernSteps: backfilledModernSteps.count,
    workflowStateMetadataUpdated: toNumber(workflowStateMetadataUpdated),
    auditDetailsUpdated: toNumber(auditDetailsUpdated),
    deletedLegacyPins: deletedLegacyPins.count,
    remainingLegacyStepRecords,
    remainingLegacyWorkflowMetadata: remainingLegacyMetadataCount,
  };

  console.log("Legacy availability purge summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (remainingLegacyStepRecords > 0 || remainingLegacyMetadataCount > 0) {
    throw new Error("Legacy AVAILABILITY_SUBMISSION records still remain.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
