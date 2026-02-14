import bcrypt from "bcryptjs";
import { PrismaClient, CaseStatus, DocumentState, SessionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function addHours(date, hours) {
  const value = new Date(date);
  value.setHours(value.getHours() + hours);
  return value;
}

async function main() {
  await prisma.authSession.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.documentInstance.deleteMany();
  await prisma.session.deleteMany();
  await prisma.caseAvailabilityWindow.deleteMany();
  await prisma.caseWorkflowState.deleteMany();
  await prisma.caseParticipant.deleteMany();
  await prisma.case.deleteMany();
  await prisma.caseWorkflowStep.deleteMany();
  await prisma.caseWorkflowTemplate.deleteMany();
  await prisma.documentTemplate.deleteMany();
  await prisma.operationsUser.deleteMany();
  await prisma.userAccount.deleteMany();
  await prisma.specialist.deleteMany();
  await prisma.client.deleteMany();

  await prisma.documentTemplate.createMany({
    data: [
      {
        code: "TERMS_AND_CONDITIONS",
        name: "Terms & Conditions",
        description: "Required before agreement progression.",
        triggerStatus: CaseStatus.NEW,
        required: true,
      },
      {
        code: "CONTRACT",
        name: "Engagement Contract",
        description: "Issued when a case is matched.",
        triggerStatus: CaseStatus.MATCHED,
        required: true,
      },
      {
        code: "INTAKE_FORM",
        name: "Session Intake Form",
        description: "Must be completed before the first session starts.",
        triggerStatus: CaseStatus.SCHEDULED,
        required: true,
      },
      {
        code: "OUTTAKE_FORM",
        name: "Session Outtake Form",
        description: "Collects completion feedback.",
        triggerStatus: CaseStatus.COMPLETED,
        required: true,
      },
      {
        code: "COUPLES_PREP_FORM",
        name: "Couples Preparation Form",
        description: "Additional context for couples counselling cases.",
        triggerStatus: CaseStatus.MATCHED,
        required: true,
      },
    ],
  });

  const [soloSpecialist, couplesSpecialist, backupSpecialist] = await Promise.all([
    prisma.specialist.create({
      data: {
        name: "Avery Mills",
        email: "avery.specialist@demo.local",
        supportsCouples: false,
        capabilities: ["individual", "career"],
        calUserId: "cal_avery",
        calIndividualEventTypeId: "1001",
        calCouplesEventTypeId: null,
      },
    }),
    prisma.specialist.create({
      data: {
        name: "Jordan Patel",
        email: "jordan.specialist@demo.local",
        supportsCouples: true,
        capabilities: ["couples", "conflict-resolution"],
        calUserId: "cal_jordan",
        calIndividualEventTypeId: "1002",
        calCouplesEventTypeId: "2002",
      },
    }),
    prisma.specialist.create({
      data: {
        name: "Morgan Lee",
        email: "morgan.specialist@demo.local",
        supportsCouples: true,
        capabilities: ["couples", "high-conflict"],
        calUserId: "cal_morgan",
        calIndividualEventTypeId: "1003",
        calCouplesEventTypeId: "2003",
      },
    }),
  ]);

  const passwordHash = await bcrypt.hash("password123", 10);

  const opsUser = await prisma.userAccount.create({
    data: {
      email: "ops@demo.local",
      name: "Ops Manager",
      passwordHash,
      role: UserRole.OPS,
      operationsUser: {
        create: {
          canOverride: true,
        },
      },
    },
  });

  await prisma.userAccount.createMany({
    data: [
      {
        email: "avery.specialist@demo.local",
        name: "Avery Mills",
        passwordHash,
        role: UserRole.SPECIALIST,
        specialistId: soloSpecialist.id,
      },
      {
        email: "jordan.specialist@demo.local",
        name: "Jordan Patel",
        passwordHash,
        role: UserRole.SPECIALIST,
        specialistId: couplesSpecialist.id,
      },
      {
        email: "morgan.specialist@demo.local",
        name: "Morgan Lee",
        passwordHash,
        role: UserRole.SPECIALIST,
        specialistId: backupSpecialist.id,
      },
    ],
  });

  const [singleClient, coupleA, coupleB] = await Promise.all([
    prisma.client.create({
      data: {
        firstName: "Taylor",
        lastName: "Ng",
        email: "taylor.ng@example.com",
      },
    }),
    prisma.client.create({
      data: {
        firstName: "Chris",
        lastName: "Diaz",
        email: "chris.diaz@example.com",
      },
    }),
    prisma.client.create({
      data: {
        firstName: "Robin",
        lastName: "Diaz",
        email: "robin.diaz@example.com",
      },
    }),
  ]);

  const templates = await prisma.documentTemplate.findMany();
  const byCode = Object.fromEntries(templates.map((template) => [template.code, template]));

  const [generalWorkflow, couplesWorkflow] = await Promise.all([
    prisma.caseWorkflowTemplate.create({
      data: {
        code: "INDIVIDUAL_COUNSELLING",
        name: "Individual Counselling",
        counsellingType: "individual",
        description: "Workflow for one-to-one counselling.",
        active: true,
        isDefault: true,
      },
    }),
    prisma.caseWorkflowTemplate.create({
      data: {
        code: "COUPLES_COUNSELLING",
        name: "Couples Counselling",
        counsellingType: "couples",
        description: "Workflow requiring form completion from both participants.",
        active: true,
      },
    }),
  ]);

  const generalStepInputs = [
    {
      templateId: generalWorkflow.id,
      name: "Intake form",
      formType: "INTAKE_FORM",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 10,
    },
    {
      templateId: generalWorkflow.id,
      name: "Terms & conditions",
      formType: "TERMS_AND_CONDITIONS",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 20,
    },
    {
      templateId: generalWorkflow.id,
      name: "Availability submission",
      formType: "AVAILABILITY_SUBMISSION",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 30,
    },
  ];

  const couplesStepInputs = [
    {
      templateId: couplesWorkflow.id,
      name: "Intake form (both participants)",
      formType: "INTAKE_FORM",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 10,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Consent form (both participants)",
      formType: "CONSENT_FORM",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 20,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Agreement form",
      formType: "AGREEMENT_FORM",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 30,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Availability submission (both participants)",
      formType: "AVAILABILITY_SUBMISSION",
      type: "FORM",
      required: true,
      blocksScheduling: true,
      sortOrder: 40,
    },
  ];

  const [generalSteps, couplesSteps] = await Promise.all([
    Promise.all(generalStepInputs.map((data) => prisma.caseWorkflowStep.create({ data }))),
    Promise.all(couplesStepInputs.map((data) => prisma.caseWorkflowStep.create({ data }))),
  ]);

  const singleCase = await prisma.case.create({
    data: {
      reference: "CASE-1001",
      status: CaseStatus.SCHEDULED,
      counsellingType: "individual",
      intakeSource: "WEB_FORM",
      intakeReceivedAt: addDays(new Date(), -4),
      caseWorkflowTemplateId: generalWorkflow.id,
      notes: "Prefers morning sessions and structured plans.",
      flags: ["first_time_client"],
      assignedSpecialistId: soloSpecialist.id,
      participants: {
        create: [
          {
            clientId: singleClient.id,
            role: "PRIMARY",
          },
        ],
      },
    },
  });

  const sessionStart = addDays(new Date(), 1);
  sessionStart.setHours(9, 0, 0, 0);

  const seededSession = await prisma.session.create({
    data: {
      caseId: singleCase.id,
      specialistId: soloSpecialist.id,
      status: SessionStatus.SCHEDULED,
      providerBookingId: "fake-seed-booking-1001",
      providerStartTime: sessionStart,
      providerEndTime: addHours(sessionStart, 1),
      providerType: "fake",
      providerStatus: "scheduled",
      lastProviderSyncAt: new Date(),
      notes: "Bring prior assessment notes.",
    },
  });

  await prisma.caseWorkflowState.createMany({
    data: generalSteps.map((step) => {
      const completeByFormType = new Set([
        "TERMS_AND_CONDITIONS",
        "INTAKE_FORM",
        "AVAILABILITY_SUBMISSION",
      ]);
      const isCompleted = Boolean(step.formType && completeByFormType.has(step.formType));
      return {
        caseId: singleCase.id,
        stepId: step.id,
        status: isCompleted ? "COMPLETED" : "PENDING",
        metadata: isCompleted
          ? {
              source: "seed",
              formType: step.formType,
            }
          : null,
        completedAt: isCompleted ? addDays(new Date(), -2) : null,
      };
    }),
  });

  await prisma.caseAvailabilityWindow.create({
    data: {
      caseId: singleCase.id,
      clientId: singleClient.id,
      startTime: addHours(sessionStart, -1),
      endTime: addHours(sessionStart, 1),
      timezone: "America/New_York",
      source: "seed",
      active: true,
      metadata: {
        note: "Seed availability window aligned with scheduled session.",
      },
    },
  });

  await prisma.documentInstance.createMany({
    data: [
      {
        caseId: singleCase.id,
        templateId: byCode.TERMS_AND_CONDITIONS.id,
        status: DocumentState.COMPLETED,
        sentAt: addDays(new Date(), -4),
        completedAt: addDays(new Date(), -3),
        required: true,
      },
      {
        caseId: singleCase.id,
        templateId: byCode.CONTRACT.id,
        status: DocumentState.COMPLETED,
        sentAt: addDays(new Date(), -2),
        completedAt: addDays(new Date(), -1),
        required: true,
      },
      {
        caseId: singleCase.id,
        templateId: byCode.INTAKE_FORM.id,
        sessionId: seededSession.id,
        status: DocumentState.SENT,
        sentAt: new Date(),
        required: true,
      },
    ],
  });

  const coupleCase = await prisma.case.create({
    data: {
      reference: "CASE-1002",
      status: CaseStatus.NEW,
      counsellingType: "couples",
      intakeSource: "MICROSOFT_FORMS",
      intakeExternalId: "seed-ms-response-1002",
      intakeReceivedAt: addDays(new Date(), -1),
      caseWorkflowTemplateId: couplesWorkflow.id,
      notes: "Couple requests late-afternoon availability.",
      flags: ["couple", "priority_match"],
      participants: {
        create: [
          {
            clientId: coupleA.id,
            role: "PRIMARY",
          },
          {
            clientId: coupleB.id,
            role: "SECONDARY",
          },
        ],
      },
    },
  });

  await prisma.documentInstance.create({
    data: {
      caseId: coupleCase.id,
      templateId: byCode.TERMS_AND_CONDITIONS.id,
      status: DocumentState.SENT,
      required: true,
    },
  });

  await prisma.caseWorkflowState.createMany({
    data: couplesSteps.map((step) => ({
      caseId: coupleCase.id,
      stepId: step.id,
      status: "PENDING",
    })),
  });

  await prisma.auditLog.createMany({
    data: [
      {
        caseId: singleCase.id,
        userId: opsUser.id,
        action: "SEED_CASE_CREATED",
        details: {
          note: "Seeded with active scheduled Cal.com-referenced session",
        },
      },
      {
        caseId: coupleCase.id,
        userId: opsUser.id,
        action: "SEED_CASE_CREATED",
        details: {
          note: "Seeded as NEW couple case pending Cal.com match",
        },
      },
    ],
  });

  console.log("Seed completed.");
  console.log("Login credentials:");
  console.log("  OPS: ops@demo.local / password123");
  console.log("  Specialist: avery.specialist@demo.local / password123");
  console.log("  Specialist: jordan.specialist@demo.local / password123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
