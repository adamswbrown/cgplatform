import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "crypto";
import { PrismaClient, CaseStatus, CaseProposalStatus, SessionTimeProposalStatus, DocumentState, SessionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const USER_SEED_FILE = path.join(process.cwd(), "prisma", "seed.user.json");

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

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function formPinSecret() {
  return process.env.FORM_PIN_SECRET || process.env.AUTH_SECRET || "dev-form-pin-secret";
}

function hashPin(accessKey, pin) {
  return createHash("sha256")
    .update(`pin|${formPinSecret()}|${accessKey}|${pin}`)
    .digest("hex");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseDateOrDefault(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeCompletionToken(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }

  if (normalized === "AVAILABILITY_SUBMISSION") {
    return "AVAILABILITY_CAPTURED";
  }

  return normalized;
}

function resolveStepCompletionToken(step) {
  if (step?.stepCode) {
    return normalizeCompletionToken(step.stepCode);
  }

  if (step?.formType) {
    return normalizeCompletionToken(step.formType);
  }

  return "";
}

function toCaseStatus(value, fallback = CaseStatus.NEW) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return Object.values(CaseStatus).includes(normalized) ? normalized : fallback;
}

function toSessionStatus(value, fallback = SessionStatus.SCHEDULED) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return Object.values(SessionStatus).includes(normalized) ? normalized : fallback;
}

function toDocumentState(value, fallback = DocumentState.SENT) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return Object.values(DocumentState).includes(normalized) ? normalized : fallback;
}

function buildDefaultClientFromEmail(email) {
  const localPart = String(email).split("@")[0] || "seed";
  const normalized = localPart
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  const [first, ...rest] = normalized.split(/\s+/).filter(Boolean);
  return {
    firstName: first ? first.charAt(0).toUpperCase() + first.slice(1) : "Seed",
    lastName: rest.length > 0 ? rest.join(" ") : "Client",
  };
}

async function loadUserSeedConfig() {
  try {
    const raw = await fs.readFile(USER_SEED_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
      formPins: Array.isArray(parsed.formPins) ? parsed.formPins : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function applyUserSeedConfig(input) {
  const {
    config,
    generalWorkflow,
    couplesWorkflow,
    generalSteps,
    couplesSteps,
    specialistsByEmail,
    documentTemplatesByCode,
    opsUser,
  } = input;

  if (!config) {
    return {
      customCases: [],
      customPins: [],
      loaded: false,
    };
  }

  const workflowByCode = new Map([
    [generalWorkflow.code, generalWorkflow],
    [couplesWorkflow.code, couplesWorkflow],
  ]);
  const stepsByTemplateId = new Map([
    [generalWorkflow.id, generalSteps],
    [couplesWorkflow.id, couplesSteps],
  ]);

  const clientsByEmail = new Map();
  const existingClients = await prisma.client.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  });
  for (const client of existingClients) {
    clientsByEmail.set(normalizeEmail(client.email), client);
  }

  async function ensureClientByEmail(entry) {
    const email = normalizeEmail(entry.email);
    if (!email) {
      return null;
    }

    const existing = clientsByEmail.get(email);
    if (existing) {
      return existing;
    }

    const fallback = buildDefaultClientFromEmail(email);
    const created = await prisma.client.create({
      data: {
        firstName: String(entry.firstName || fallback.firstName).trim() || fallback.firstName,
        lastName: String(entry.lastName || fallback.lastName).trim() || fallback.lastName,
        email,
        phone: entry.phone ? String(entry.phone).trim() : null,
      },
    });
    clientsByEmail.set(email, created);
    return created;
  }

  for (const clientSeed of config.clients) {
    if (!clientSeed || typeof clientSeed !== "object") {
      continue;
    }
    await ensureClientByEmail(clientSeed);
  }

  const customCases = [];
  const customPins = [];
  const now = new Date();

  async function createPinRecord({
    caseId,
    caseReference,
    participantEmail,
    formType,
    formPath,
    accessKey,
    pin,
    expiresInDays,
    maxAttempts,
  }) {
    const participant = clientsByEmail.get(normalizeEmail(participantEmail));
    if (!participant) {
      console.warn(
        `[seed.user] skipped PIN for ${participantEmail} (${formType}) on ${caseReference}: participant not found`,
      );
      return;
    }

    const normalizedFormType = String(formType || "")
      .trim()
      .toUpperCase();
    if (!normalizedFormType) {
      return;
    }

    const normalizedPath = String(formPath || "").trim() || "/forms/terms-and-conditions";
    const normalizedAccessKey = String(accessKey || "").trim();
    const normalizedPin = String(pin || "")
      .replace(/\D+/g, "")
      .padStart(6, "0")
      .slice(0, 6);

    if (!normalizedAccessKey || !normalizedPin) {
      return;
    }

    const expiryDays = Number.isFinite(expiresInDays) ? Number(expiresInDays) : 30;
    const safeMaxAttempts = Number.isFinite(maxAttempts) ? Math.max(1, Number(maxAttempts)) : 8;
    const expiresAt = addDays(now, expiryDays);

    await prisma.formAccessPin.create({
      data: {
        caseId,
        clientId: participant.id,
        formType: normalizedFormType,
        formPath: normalizedPath,
        accessKey: normalizedAccessKey,
        pinHash: hashPin(normalizedAccessKey, normalizedPin),
        expiresAt,
        maxAttempts: safeMaxAttempts,
        metadata: {
          source: "seed.user",
        },
        issuedByUserId: opsUser.id,
      },
    });

    customPins.push({
      caseReference,
      participantEmail: participant.email,
      formType: normalizedFormType,
      accessKey: normalizedAccessKey,
      pin: normalizedPin,
    });
  }

  for (const caseSeed of config.cases) {
    if (!caseSeed || typeof caseSeed !== "object") {
      continue;
    }

    const reference = String(caseSeed.reference || "").trim();
    if (!reference) {
      console.warn("[seed.user] skipped case without reference");
      continue;
    }

    const participantEmails = Array.isArray(caseSeed.participants)
      ? caseSeed.participants.map((value) => normalizeEmail(value)).filter(Boolean)
      : [];

    if (participantEmails.length === 0 || participantEmails.length > 2) {
      console.warn(
        `[seed.user] skipped case ${reference}: provide 1 or 2 participant emails in 'participants'`,
      );
      continue;
    }

    const participantClients = [];
    for (const participantEmail of participantEmails) {
      const client = await ensureClientByEmail({ email: participantEmail });
      if (client) {
        participantClients.push(client);
      }
    }

    if (participantClients.length !== participantEmails.length) {
      console.warn(`[seed.user] skipped case ${reference}: unable to resolve participants`);
      continue;
    }

    const counsellingType =
      String(caseSeed.counsellingType || "")
        .trim()
        .toLowerCase() || (participantClients.length === 2 ? "couples" : "individual");
    const workflowCode = String(caseSeed.workflowCode || "")
      .trim()
      .toUpperCase();
    const workflowTemplate =
      workflowByCode.get(workflowCode) ||
      (counsellingType.includes("couple") ? couplesWorkflow : generalWorkflow);
    const assignedSpecialist = caseSeed.assignedSpecialistEmail
      ? specialistsByEmail.get(normalizeEmail(caseSeed.assignedSpecialistEmail)) || null
      : null;

    const existingCase = await prisma.case.findUnique({
      where: { reference },
      select: {
        id: true,
        reference: true,
      },
    });
    const caseRecord =
      existingCase ||
      (await prisma.case.create({
        data: {
          ...(Object.prototype.hasOwnProperty.call(caseSeed, "intakeFormData")
            ? {
                intakeFormData: caseSeed.intakeFormData,
              }
            : {}),
          reference,
          status: toCaseStatus(caseSeed.status, CaseStatus.NEW),
          counsellingType,
          intakeSource: String(caseSeed.intakeSource || "SECURE_LINK"),
          intakeExternalId: caseSeed.intakeExternalId ? String(caseSeed.intakeExternalId) : null,
          intakeReceivedAt: parseDateOrDefault(caseSeed.intakeReceivedAt, now),
          caseWorkflowTemplateId: workflowTemplate?.id || null,
          notes: caseSeed.notes ? String(caseSeed.notes) : null,
          flags: Array.isArray(caseSeed.flags)
            ? caseSeed.flags.map((flag) => String(flag).trim()).filter(Boolean)
            : [],
          assignedSpecialistId: assignedSpecialist?.id || null,
          participants: {
            create: participantClients.map((client, index) => ({
              clientId: client.id,
              role: index === 0 ? "PRIMARY" : "SECONDARY",
            })),
          },
        },
      }));

    const templateSteps = stepsByTemplateId.get(workflowTemplate.id) || [];
    if (templateSteps.length > 0) {
      await prisma.caseWorkflowState.createMany({
        data: templateSteps.map((step) => ({
          caseId: caseRecord.id,
          stepId: step.id,
          status: "PENDING",
        })),
      });
    }

    const completedFormTypes = Array.isArray(caseSeed.completedFormTypes)
      ? caseSeed.completedFormTypes.map((formType) => normalizeCompletionToken(formType))
      : [];
    for (const step of templateSteps) {
      const stepCompletionToken = resolveStepCompletionToken(step);
      if (!stepCompletionToken || !completedFormTypes.includes(stepCompletionToken)) {
        continue;
      }

      await prisma.caseWorkflowState.updateMany({
        where: {
          caseId: caseRecord.id,
          stepId: step.id,
        },
        data: {
          status: "COMPLETED",
          completedAt: now,
          metadata: {
            source: "seed.user",
            formType: step.formType,
            stepCode: step.stepCode || null,
          },
        },
      });
    }

    if (Array.isArray(caseSeed.documents)) {
      for (const documentSeed of caseSeed.documents) {
        const code = String(documentSeed.code || "")
          .trim()
          .toUpperCase();
        const template = documentTemplatesByCode[code];
        if (!template) {
          continue;
        }

        const status = toDocumentState(documentSeed.status, DocumentState.SENT);
        const sentAt = parseDateOrDefault(documentSeed.sentAt, now);
        const completedAt =
          status === DocumentState.COMPLETED
            ? parseDateOrDefault(documentSeed.completedAt, now)
            : null;

        await prisma.documentInstance.create({
          data: {
            caseId: caseRecord.id,
            templateId: template.id,
            status,
            sentAt,
            completedAt,
            required:
              typeof documentSeed.required === "boolean" ? Boolean(documentSeed.required) : true,
          },
        });
      }
    }

    if (caseSeed.session && typeof caseSeed.session === "object") {
      const sessionSpecialist =
        (caseSeed.session.specialistEmail &&
          specialistsByEmail.get(normalizeEmail(caseSeed.session.specialistEmail))) ||
        assignedSpecialist;

      if (sessionSpecialist) {
        const defaultStart = addDays(now, 3);
        defaultStart.setHours(10, 0, 0, 0);
        const startTime = parseDateOrDefault(caseSeed.session.startTime, defaultStart);
        let endTime = parseDateOrDefault(caseSeed.session.endTime, addHours(startTime, 1));
        if (endTime <= startTime) {
          endTime = addHours(startTime, 1);
        }

        await prisma.session.create({
          data: {
            caseId: caseRecord.id,
            specialistId: sessionSpecialist.id,
            status: toSessionStatus(caseSeed.session.status, SessionStatus.SCHEDULED),
            providerBookingId:
              String(caseSeed.session.providerBookingId || "").trim() ||
              `manual-custom-${reference.toLowerCase()}`,
            providerStartTime: startTime,
            providerEndTime: endTime,
            providerType: String(caseSeed.session.providerType || "manual"),
            providerStatus: String(caseSeed.session.providerStatus || "scheduled"),
            lastProviderSyncAt: now,
            notes: caseSeed.session.notes ? String(caseSeed.session.notes) : null,
          },
        });
      }
    }

    // Seed case proposals (counsellor check-in)
    if (caseSeed.caseProposal && typeof caseSeed.caseProposal === "object") {
      const proposalSpecialist = caseSeed.caseProposal.specialistEmail
        ? specialistsByEmail.get(normalizeEmail(caseSeed.caseProposal.specialistEmail))
        : assignedSpecialist;
      if (proposalSpecialist) {
        await prisma.caseProposal.create({
          data: {
            caseId: caseRecord.id,
            specialistId: proposalSpecialist.id,
            proposedByUserId: opsUser.id,
            status: String(caseSeed.caseProposal.status || "PENDING").toUpperCase(),
            proposalNote: caseSeed.caseProposal.notes || null,
          },
        });
      }
    }

    // Seed session time proposals
    if (Array.isArray(caseSeed.sessionTimeProposals)) {
      const proposalSpecialist = assignedSpecialist;
      if (proposalSpecialist) {
        for (const slotSeed of caseSeed.sessionTimeProposals) {
          const slotStart = parseDateOrDefault(slotSeed.startTime, addDays(now, 5));
          let slotEnd = parseDateOrDefault(slotSeed.endTime, addHours(slotStart, 1));
          if (slotEnd <= slotStart) slotEnd = addHours(slotStart, 1);
          const status = String(slotSeed.status || "PENDING").toUpperCase();
          await prisma.sessionTimeProposal.create({
            data: {
              caseId: caseRecord.id,
              specialistId: proposalSpecialist.id,
              proposedByUserId: opsUser.id,
              proposedStartTime: slotStart,
              proposedEndTime: slotEnd,
              status,
              confirmToken: randomBytes(32).toString("hex"),
              specialistNotes: slotSeed.specialistNotes || null,
              specialistRespondedAt: status !== "PENDING" ? now : null,
              clientConfirmedAt: status === "CLIENT_CONFIRMED" ? now : null,
            },
          });
        }
      }
    }

    if (Array.isArray(caseSeed.pins)) {
      for (const pinSeed of caseSeed.pins) {
        await createPinRecord({
          caseId: caseRecord.id,
          caseReference: caseRecord.reference,
          participantEmail: pinSeed.participantEmail,
          formType: pinSeed.formType,
          formPath: pinSeed.formPath,
          accessKey: pinSeed.accessKey,
          pin: pinSeed.pin,
          expiresInDays: pinSeed.expiresInDays,
          maxAttempts: pinSeed.maxAttempts,
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        caseId: caseRecord.id,
        userId: opsUser.id,
        action: "SEED_USER_CASE_CREATED",
        details: {
          reference: caseRecord.reference,
          counsellingType,
        },
      },
    });

    customCases.push({
      reference: caseRecord.reference,
      counsellingType,
      participants: participantClients.map((client) => client.email),
    });
  }

  for (const pinSeed of config.formPins) {
    if (!pinSeed || typeof pinSeed !== "object") {
      continue;
    }

    const caseReference = String(pinSeed.caseReference || "").trim();
    const caseRecord = caseReference
      ? await prisma.case.findUnique({
          where: { reference: caseReference },
          select: {
            id: true,
            reference: true,
          },
        })
      : null;

    if (!caseRecord) {
      console.warn(
        `[seed.user] skipped top-level form pin for ${pinSeed.participantEmail || "unknown"}: caseReference not found`,
      );
      continue;
    }

    await createPinRecord({
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantEmail: pinSeed.participantEmail,
      formType: pinSeed.formType,
      formPath: pinSeed.formPath,
      accessKey: pinSeed.accessKey,
      pin: pinSeed.pin,
      expiresInDays: pinSeed.expiresInDays,
      maxAttempts: pinSeed.maxAttempts,
    });
  }

  return {
    customCases,
    customPins,
    loaded: true,
  };
}

async function main() {
  await prisma.authSession.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.formAccessPin.deleteMany();
  await prisma.intakeAccessInvite.deleteMany();
  await prisma.sessionTimeProposal.deleteMany();
  await prisma.caseProposal.deleteMany();
  await prisma.documentInstance.deleteMany();
  await prisma.session.deleteMany();
  await prisma.specialistAvailabilityWindow.deleteMany();
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
        description: "Issued after scheduling and required before session begins.",
        triggerStatus: CaseStatus.SCHEDULED,
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

  await prisma.systemSetting.create({
    data: {
      key: "intake_form_content",
      value: {
        crisisModal: {
          title: "Immediate Support",
          intro:
            "If you are feeling vulnerable in the meantime please contact one of the following services:",
          contacts: [
            {
              label: "LIFELINE",
              phone: "0808 808 8000",
              description:
                "Lifeline is a crisis response helpline service for people who are experiencing distress or despair.",
            },
            {
              label: "PREMIER LIFELINE (Christian)",
              phone: "0300 111 0101",
              description: "",
            },
            {
              label: "SAMARITANS",
              phone: "0330 094 5717",
              description: "",
            },
            {
              label: "YOUR GP",
              phone: "",
              description: "",
            },
            {
              label: "Emergency",
              phone: "999",
              description: "In an immediate emergency call 999.",
            },
          ],
        },
        availability: {
          heading: "Your Availability",
          subheading:
            "The more available you are the sooner you could be allocated to a Counsellor.",
          notes: [
            {
              title: "EVENING SESSIONS",
              body:
                "There are limited in-person appointments on Tuesday and Thursday evenings in Newtownards.",
            },
            {
              title: "COUPLES COUNSELLING",
              body:
                "We have very limited availability for couples counselling on Tuesday evenings and unfortunately no couples counselling is available on Thursday evenings.",
            },
            {
              title: "SESSION TIMES",
              body:
                "Sessions do not commence before 9.30am and our last appointment on Tuesday or Thursdays is no later than 8.00pm.",
            },
          ],
          disclaimer:
            "We will endeavour to accommodate your request but this may not always be possible.",
          prompt:
            "Please list the days and times you are available (plus any other information regarding your availability).",
        },
      },
    },
  });

  await prisma.systemSetting.create({
    data: {
      key: "operational_settings",
      value: {
        defaultIntakeSource: "SECURE_LINK",
      },
    },
  });

  const [soloSpecialist, couplesSpecialist, backupSpecialist] = await Promise.all([
    prisma.specialist.create({
      data: {
        id: "seed-specialist-avery-mills",
        name: "Avery Mills",
        email: "avery.specialist@demo.local",
        supportsCouples: false,
        standardStartHour: 9,
        standardEndHour: 18,
        capabilities: ["individual", "career"],
        calUserId: "cal_avery",
        calIndividualEventTypeId: "1001",
        calCouplesEventTypeId: null,
      },
    }),
    prisma.specialist.create({
      data: {
        id: "seed-specialist-jordan-patel",
        name: "Jordan Patel",
        email: "jordan.specialist@demo.local",
        supportsCouples: true,
        standardStartHour: 8,
        standardEndHour: 18,
        capabilities: ["couples", "conflict-resolution"],
        calUserId: "cal_jordan",
        calIndividualEventTypeId: "1002",
        calCouplesEventTypeId: "2002",
      },
    }),
    prisma.specialist.create({
      data: {
        id: "seed-specialist-morgan-lee",
        name: "Morgan Lee",
        email: "morgan.specialist@demo.local",
        supportsCouples: true,
        standardStartHour: 10,
        standardEndHour: 18,
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

  const seededAvailabilityWindows = [];
  const specialistAvailabilityTargets = [soloSpecialist, couplesSpecialist, backupSpecialist];
  const availabilityStart = startOfDay(new Date());

  for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
    const day = addDays(availabilityStart, dayOffset);
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }

    for (const specialist of specialistAvailabilityTargets) {
      for (let hour = 9; hour < 18; hour += 1) {
        const startTime = new Date(day);
        startTime.setHours(hour, 0, 0, 0);
        const endTime = new Date(startTime);
        endTime.setHours(hour + 1, 0, 0, 0);
        seededAvailabilityWindows.push({
          specialistId: specialist.id,
          startTime,
          endTime,
          timezone: "Europe/London",
          source: "seed",
          createdByUserId: opsUser.id,
        });
      }
    }
  }

  if (seededAvailabilityWindows.length > 0) {
    await prisma.specialistAvailabilityWindow.createMany({
      data: seededAvailabilityWindows,
    });
  }

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
      stepCode: "INTAKE_FORM",
      formType: "INTAKE_FORM",
      type: "FORM",
      required: true,
      requiresAllParticipants: false,
      blocksScheduling: true,
      sortOrder: 10,
    },
    {
      templateId: generalWorkflow.id,
      name: "Availability captured from intake",
      stepCode: "AVAILABILITY_CAPTURED",
      type: "SYSTEM",
      required: true,
      requiresAllParticipants: false,
      blocksScheduling: true,
      sortOrder: 20,
    },
    {
      templateId: generalWorkflow.id,
      name: "Terms & conditions",
      stepCode: "TERMS_AND_CONDITIONS",
      formType: "TERMS_AND_CONDITIONS",
      type: "FORM",
      required: true,
      requiresAllParticipants: false,
      blocksScheduling: false,
      sortOrder: 30,
    },
  ];

  const couplesStepInputs = [
    {
      templateId: couplesWorkflow.id,
      name: "Intake form (both participants)",
      stepCode: "INTAKE_FORM",
      formType: "INTAKE_FORM",
      type: "FORM",
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: true,
      sortOrder: 10,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Consent form (both participants)",
      stepCode: "CONSENT_FORM",
      formType: "CONSENT_FORM",
      type: "FORM",
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: true,
      sortOrder: 20,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Agreement form",
      stepCode: "AGREEMENT_FORM",
      formType: "AGREEMENT_FORM",
      type: "FORM",
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: true,
      sortOrder: 30,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Availability captured from intake (both participants)",
      stepCode: "AVAILABILITY_CAPTURED",
      type: "SYSTEM",
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: true,
      sortOrder: 40,
    },
    {
      templateId: couplesWorkflow.id,
      name: "Terms & conditions (both participants)",
      stepCode: "TERMS_AND_CONDITIONS",
      formType: "TERMS_AND_CONDITIONS",
      type: "FORM",
      required: true,
      requiresAllParticipants: true,
      blocksScheduling: false,
      sortOrder: 50,
    },
  ];

  const [generalSteps, couplesSteps] = await Promise.all([
    Promise.all(generalStepInputs.map((data) => prisma.caseWorkflowStep.create({ data }))),
    Promise.all(couplesStepInputs.map((data) => prisma.caseWorkflowStep.create({ data }))),
  ]);

  const singleCaseIntakeFormData = {
    participantType: "single",
    primary: {
      title: "Mr",
      firstName: "Taylor",
      lastName: "Ng",
      dateOfBirth: "1989-04-12",
      gender: "male",
      email: "taylor.ng@example.com",
      mainPhone: "+447700900001",
      secondPhone: "+447700900009",
      addressLine1: "24 Willow Court",
      addressLine2: "",
      city: "Newtownards",
      county: "County Down",
      postcode: "BT23 4EN",
      countryIfNotUk: "",
      churchConnection: "yes",
      leadershipRole: "no",
      heardAbout: "WEBSITE",
      heardAboutOtherDetail: "",
      contactPreferences: {
        contactMainPhone: "yes",
        leaveVoicemailMainPhone: "yes",
        contactSecondPhone: "no",
        leaveVoicemailSecondPhone: "no",
        contactEmail: "yes",
      },
      emergencyContactFirstName: "Alex",
      emergencyContactLastName: "Ng",
      emergencyRelationship: "Sibling",
      emergencyPhone: "+447700900010",
      gpSurgeryName: "West Street Medical Centre",
      gpSurgeryPhone: "+442891468846",
      gpDoctorName: "Dr Stewart",
    },
    secondary: {},
    counsellingType: "individual",
    consent: {
      signature: "Taylor Ng",
      signatureType: "typed",
      signedAt: addDays(new Date(), -4).toISOString(),
    },
    presenting: {
      mainIssue: "ANXIETY_STRESS",
      otherDetails: "",
      issueDuration: "About 8 months",
      previousSupport: "yes",
      previousSupportDetails: "Saw GP for stress management in 2025.",
      suicidalThoughtsRecently: "no",
      suicidalThoughtsDetails: "",
      attemptedSuicide: "no",
      attemptedSuicideDetails: "",
    },
    availability: {
      location: "NEWTOWNARDS",
      includeOnline: true,
      notes: "Morning sessions preferred due to childcare.",
      timePreferences: ["MORNING"],
      selectedSlots: [
        {
          startTime: addDays(new Date(), 1).toISOString(),
          endTime: addHours(addDays(new Date(), 1), 1).toISOString(),
        },
      ],
    },
    requestedDurationMinutes: 60,
  };

  const singleCase = await prisma.case.create({
    data: {
      reference: "CASE-1001",
      status: CaseStatus.SCHEDULED,
      counsellingType: "individual",
      intakeSource: "SECURE_LINK",
      intakeReceivedAt: addDays(new Date(), -4),
      intakeFormData: singleCaseIntakeFormData,
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
      providerBookingId: "manual-seed-booking-1001",
      providerStartTime: sessionStart,
      providerEndTime: addHours(sessionStart, 1),
      providerType: "manual",
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
        "AVAILABILITY_CAPTURED",
      ]);
      const isCompleted = Boolean(completeByFormType.has(resolveStepCompletionToken(step)));
      return {
        caseId: singleCase.id,
        stepId: step.id,
        status: isCompleted ? "COMPLETED" : "PENDING",
        metadata: isCompleted
          ? {
              source: "seed",
              formType: step.formType,
              stepCode: step.stepCode || null,
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

  const coupleCaseIntakeFormData = {
    participantType: "couple",
    primary: {
      title: "Mrs",
      firstName: "Chris",
      lastName: "Diaz",
      dateOfBirth: "1987-01-05",
      gender: "female",
      email: "chris.diaz@example.com",
      mainPhone: "+447700900021",
      secondPhone: "",
      addressLine1: "16 Shore Road",
      addressLine2: "",
      city: "Bangor",
      county: "County Down",
      postcode: "BT20 3AB",
      countryIfNotUk: "",
      churchConnection: "yes",
      leadershipRole: "prefer_not_to_say",
      heardAbout: "OTHER",
      heardAboutOtherDetail: "Referred by church safeguarding lead.",
      contactPreferences: {
        contactMainPhone: "yes",
        leaveVoicemailMainPhone: "no",
        contactSecondPhone: "no",
        leaveVoicemailSecondPhone: "no",
        contactEmail: "yes",
      },
      emergencyContactFirstName: "Mia",
      emergencyContactLastName: "Diaz",
      emergencyRelationship: "Sister",
      emergencyPhone: "+447700900022",
      gpSurgeryName: "Ards Family Practice",
      gpSurgeryPhone: "+442891468850",
      gpDoctorName: "Dr Patel",
    },
    secondary: {
      title: "Mr",
      firstName: "Robin",
      lastName: "Diaz",
      email: "robin.diaz@example.com",
      mainPhone: "+447700900023",
      dateOfBirth: "1986-07-11",
      gender: "male",
    },
    counsellingType: "couples",
    consent: {
      signature: "Chris Diaz",
      signatureType: "typed",
      signedAt: addDays(new Date(), -1).toISOString(),
    },
    presenting: {
      mainIssue: "MARRIAGE",
      otherDetails: "",
      issueDuration: "Relationship pressure over the last 18 months",
      previousSupport: "yes",
      previousSupportDetails: "Attended short couples mediation last year.",
      suicidalThoughtsRecently: "no",
      suicidalThoughtsDetails: "",
      attemptedSuicide: "no",
      attemptedSuicideDetails: "",
    },
    availability: {
      location: "NEWTOWNARDS",
      includeOnline: true,
      notes: "Afternoon works best, evening can work on Thursdays.",
      timePreferences: ["AFTERNOON", "EVENING"],
      selectedSlots: [
        {
          startTime: addDays(new Date(), 2).toISOString(),
          endTime: addHours(addDays(new Date(), 2), 1).toISOString(),
        },
      ],
    },
    requestedDurationMinutes: 60,
  };

  const coupleCase = await prisma.case.create({
    data: {
      reference: "CASE-1002",
      status: CaseStatus.READY_TO_SCHEDULE,
      counsellingType: "couples",
      intakeSource: "MICROSOFT_FORMS",
      intakeExternalId: "seed-ms-response-1002",
      intakeReceivedAt: addDays(new Date(), -1),
      intakeFormData: coupleCaseIntakeFormData,
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

  await prisma.caseWorkflowState.createMany({
    data: couplesSteps.map((step) => {
      const completeByFormType = new Set([
        "INTAKE_FORM",
        "CONSENT_FORM",
        "AGREEMENT_FORM",
        "AVAILABILITY_CAPTURED",
      ]);
      const isCompleted = Boolean(completeByFormType.has(resolveStepCompletionToken(step)));

      return {
        caseId: coupleCase.id,
        stepId: step.id,
        status: isCompleted ? "COMPLETED" : "PENDING",
        metadata: isCompleted
          ? {
              source: "seed",
              formType: step.formType,
              stepCode: step.stepCode || null,
            }
          : null,
        completedAt: isCompleted ? addDays(new Date(), -1) : null,
      };
    }),
  });

  const seededFormPins = [
    {
      accessKey: "seed-terms-case-1001",
      pin: "111111",
      caseId: singleCase.id,
      caseReference: singleCase.reference,
      clientId: singleClient.id,
      participantLabel: `${singleClient.firstName} ${singleClient.lastName}`,
      participantEmail: singleClient.email,
      formType: "TERMS_AND_CONDITIONS",
      formPath: "/forms/terms-and-conditions",
      expiresAt: addDays(new Date(), 30),
      maxAttempts: 8,
    },
    {
      accessKey: "seed-outtake-case-1001",
      pin: "222222",
      caseId: singleCase.id,
      caseReference: singleCase.reference,
      clientId: singleClient.id,
      participantLabel: `${singleClient.firstName} ${singleClient.lastName}`,
      participantEmail: singleClient.email,
      formType: "OUTTAKE_FORM",
      formPath: "/forms/outtake",
      expiresAt: addDays(new Date(), 30),
      maxAttempts: 8,
    },
    {
      accessKey: "seed-consent-case-1002-a",
      pin: "333333",
      caseId: coupleCase.id,
      caseReference: coupleCase.reference,
      clientId: coupleA.id,
      participantLabel: `${coupleA.firstName} ${coupleA.lastName}`,
      participantEmail: coupleA.email,
      formType: "CONSENT_FORM",
      formPath: "/forms/consent",
      expiresAt: addDays(new Date(), 30),
      maxAttempts: 8,
    },
    {
      accessKey: "seed-consent-case-1002-b",
      pin: "444444",
      caseId: coupleCase.id,
      caseReference: coupleCase.reference,
      clientId: coupleB.id,
      participantLabel: `${coupleB.firstName} ${coupleB.lastName}`,
      participantEmail: coupleB.email,
      formType: "CONSENT_FORM",
      formPath: "/forms/consent",
      expiresAt: addDays(new Date(), 30),
      maxAttempts: 8,
    },
    {
      accessKey: "seed-agreement-case-1002-a",
      pin: "555555",
      caseId: coupleCase.id,
      caseReference: coupleCase.reference,
      clientId: coupleA.id,
      participantLabel: `${coupleA.firstName} ${coupleA.lastName}`,
      participantEmail: coupleA.email,
      formType: "AGREEMENT_FORM",
      formPath: "/forms/agreement",
      expiresAt: addDays(new Date(), 30),
      maxAttempts: 8,
    },
  ];

  const seededIntakeInvite = {
    accessKey: "seed-intake-primary-2001",
    pin: "778899",
    recipientEmail: "intake.prospect@example.com",
    recipientName: "Intake Prospect",
    expiresAt: addDays(new Date(), 14),
    maxAttempts: 8,
  };

  await prisma.formAccessPin.createMany({
    data: seededFormPins.map((entry) => ({
      caseId: entry.caseId,
      clientId: entry.clientId,
      formType: entry.formType,
      formPath: entry.formPath,
      accessKey: entry.accessKey,
      pinHash: hashPin(entry.accessKey, entry.pin),
      expiresAt: entry.expiresAt,
      maxAttempts: entry.maxAttempts,
      metadata: {
        source: "seed",
        note: "Deterministic local test PIN",
      },
      issuedByUserId: opsUser.id,
    })),
  });

  await prisma.intakeAccessInvite.create({
    data: {
      recipientEmail: seededIntakeInvite.recipientEmail,
      recipientName: seededIntakeInvite.recipientName,
      accessKey: seededIntakeInvite.accessKey,
      pinHash: hashPin(seededIntakeInvite.accessKey, seededIntakeInvite.pin),
      expiresAt: seededIntakeInvite.expiresAt,
      maxAttempts: seededIntakeInvite.maxAttempts,
      metadata: {
        source: "seed",
        note: "Deterministic secure intake invite",
      },
      issuedByUserId: opsUser.id,
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
      ...seededFormPins.map((entry) => ({
        caseId: entry.caseId,
        userId: opsUser.id,
        action: "SEED_FORM_PIN_CREATED",
        details: {
          formType: entry.formType,
          formPath: entry.formPath,
          accessKey: entry.accessKey,
          participantEmail: entry.participantEmail,
          pin: entry.pin,
          expiresAt: entry.expiresAt.toISOString(),
        },
      })),
    ],
  });

  const userSeedConfig = await loadUserSeedConfig();
  const userSeedResult = await applyUserSeedConfig({
    config: userSeedConfig,
    generalWorkflow,
    couplesWorkflow,
    generalSteps,
    couplesSteps,
    specialistsByEmail: new Map([
      [normalizeEmail(soloSpecialist.email), soloSpecialist],
      [normalizeEmail(couplesSpecialist.email), couplesSpecialist],
      [normalizeEmail(backupSpecialist.email), backupSpecialist],
    ]),
    documentTemplatesByCode: byCode,
    opsUser,
  });

  console.log("Seed completed.");
  console.log("Login credentials:");
  console.log("  OPS: ops@demo.local / password123");
  console.log("  Specialist: avery.specialist@demo.local / password123");
  console.log("  Specialist: jordan.specialist@demo.local / password123");
  console.log("Seeded cases:");
  console.log("  CASE-1001: Individual, scheduled (Taylor Ng)");
  console.log("  CASE-1002: Couples, ready to schedule (Chris Diaz + Robin Diaz)");
  const localBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  console.log("Seeded secure intake access:");
  console.log(
    `  ${seededIntakeInvite.recipientName} <${seededIntakeInvite.recipientEmail}> | PIN ${seededIntakeInvite.pin} | ${localBaseUrl}/intake/access/${seededIntakeInvite.accessKey}`,
  );
  console.log("Seeded form PIN test data:");
  for (const entry of seededFormPins) {
    console.log(
      `  ${entry.caseReference} | ${entry.formType} | ${entry.participantLabel} <${entry.participantEmail}> | PIN ${entry.pin} | ${localBaseUrl}/forms/access/${entry.accessKey}`,
    );
  }
  if (userSeedResult.loaded) {
    console.log(`Custom user seed loaded from ${USER_SEED_FILE}`);
    if (userSeedResult.customCases.length > 0) {
      console.log("Custom seeded cases:");
      for (const customCase of userSeedResult.customCases) {
        console.log(
          `  ${customCase.reference} | ${customCase.counsellingType} | ${customCase.participants.join(", ")}`,
        );
      }
    }
    if (userSeedResult.customPins.length > 0) {
      console.log("Custom seeded form PINs:");
      for (const pin of userSeedResult.customPins) {
        console.log(
          `  ${pin.caseReference} | ${pin.formType} | ${pin.participantEmail} | PIN ${pin.pin} | ${localBaseUrl}/forms/access/${pin.accessKey}`,
        );
      }
    }
  } else {
    console.log(`No custom seed file found at ${USER_SEED_FILE}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
