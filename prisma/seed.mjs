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
  await prisma.caseParticipant.deleteMany();
  await prisma.case.deleteMany();
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

  const singleCase = await prisma.case.create({
    data: {
      reference: "CASE-1001",
      status: CaseStatus.SCHEDULED,
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
      notes: "Bring prior assessment notes.",
    },
  });

  const templates = await prisma.documentTemplate.findMany();
  const byCode = Object.fromEntries(templates.map((template) => [template.code, template]));

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
