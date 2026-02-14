import { hash } from "bcryptjs";
import {
  CaseStatus,
  DocumentState,
  Prisma,
  SessionStatus,
  UserRole,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createSchedulingProvider } from "@/lib/scheduling";
import type { SchedulingCaseData, SchedulingEventType } from "@/lib/scheduling/types";
import {
  CASE_TRANSITIONS,
  DOCUMENT_CODES,
  REQUIRED_DOCUMENTS_TO_ENTER,
} from "@/lib/workflow";

export class DomainError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DomainError";
    this.statusCode = statusCode;
  }
}

type Tx = Prisma.TransactionClient;
type AuditDetails = Prisma.InputJsonValue | undefined;

type SpecialistSchedulingConfig = {
  id: string;
  name: string;
  supportsCouples: boolean;
};

type CaseWithParticipantContacts = Prisma.CaseGetPayload<{
  include: {
    participants: {
      include: {
        client: true;
      };
    };
  };
}>;

export type IntakeParticipantInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
};

export type IntakeSubmissionInput = {
  primary: IntakeParticipantInput;
  secondary?: IntakeParticipantInput;
  notes?: string;
  requestedDurationMinutes?: number;
  autoAllocate?: boolean;
};

const ACTIVE_SESSION_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION];

async function createAuditLog(
  tx: Tx,
  input: {
    caseId?: string;
    userId?: string;
    action: string;
    details?: AuditDetails;
  },
) {
  await tx.auditLog.create({
    data: {
      caseId: input.caseId,
      userId: input.userId,
      action: input.action,
      details: input.details,
    },
  });
}

async function nextCaseReference(tx: Tx) {
  const count = await tx.case.count();
  const baseNumber = 1000 + count + 1;

  for (let i = 0; i < 100; i += 1) {
    const number = baseNumber + i;
    const reference = `CASE-${String(number)}`;
    const existing = await tx.case.findUnique({
      where: { reference },
      select: { id: true },
    });

    if (!existing) {
      return reference;
    }
  }

  return `CASE-${Date.now()}`;
}

async function sendDocumentsForStatus(
  tx: Tx,
  caseId: string,
  status: CaseStatus,
  sessionId?: string,
) {
  const templates = await tx.documentTemplate.findMany({
    where: {
      triggerStatus: status,
    },
  });

  if (templates.length === 0) {
    return;
  }

  await tx.documentInstance.createMany({
    data: templates.map((template) => ({
      caseId,
      templateId: template.id,
      sessionId: sessionId ?? null,
      status: DocumentState.SENT,
      required: template.required,
    })),
    skipDuplicates: true,
  });
}

async function ensureRequiredDocumentsCompleted(
  tx: Tx,
  caseId: string,
  targetStatus: CaseStatus,
) {
  const requiredCodes = REQUIRED_DOCUMENTS_TO_ENTER[targetStatus] ?? [];

  if (requiredCodes.length === 0) {
    return;
  }

  const completedDocs = await tx.documentInstance.findMany({
    where: {
      caseId,
      status: DocumentState.COMPLETED,
      template: {
        code: {
          in: requiredCodes,
        },
      },
    },
    include: {
      template: true,
    },
  });

  const completedCodes = new Set(completedDocs.map((doc) => doc.template.code));
  const missing = requiredCodes.filter((code) => !completedCodes.has(code));

  if (missing.length > 0) {
    throw new DomainError(
      `Cannot transition to ${targetStatus}. Required documents pending: ${missing.join(", ")}.`,
      409,
    );
  }
}

async function setCaseStatus(
  tx: Tx,
  input: {
    caseId: string;
    currentStatus: CaseStatus;
    targetStatus: CaseStatus;
    actorUserId?: string;
    statusReason?: string;
    sessionIdForDocs?: string;
  },
) {
  if (input.currentStatus === input.targetStatus) {
    return;
  }

  const allowed = CASE_TRANSITIONS[input.currentStatus];
  if (!allowed.includes(input.targetStatus)) {
    throw new DomainError(
      `Invalid status transition: ${input.currentStatus} -> ${input.targetStatus}`,
      409,
    );
  }

  let sessionIdForDocs = input.sessionIdForDocs;
  if (input.targetStatus === CaseStatus.SCHEDULED) {
    const scheduledSession = await tx.session.findFirst({
      where: {
        caseId: input.caseId,
        status: {
          in: ACTIVE_SESSION_STATUSES,
        },
      },
      select: {
        id: true,
      },
    });

    if (!scheduledSession) {
      throw new DomainError(
        "Cannot transition to SCHEDULED without a provider booking session.",
        409,
      );
    }

    sessionIdForDocs = sessionIdForDocs ?? scheduledSession.id;
  }

  await ensureRequiredDocumentsCompleted(tx, input.caseId, input.targetStatus);

  await tx.case.update({
    where: { id: input.caseId },
    data: {
      status: input.targetStatus,
    },
  });

  if (input.targetStatus === CaseStatus.IN_SESSION) {
    await tx.session.updateMany({
      where: {
        caseId: input.caseId,
        status: SessionStatus.SCHEDULED,
      },
      data: {
        status: SessionStatus.IN_SESSION,
      },
    });
  }

  if (input.targetStatus === CaseStatus.COMPLETED) {
    await tx.session.updateMany({
      where: {
        caseId: input.caseId,
        status: {
          in: [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION],
        },
      },
      data: {
        status: SessionStatus.COMPLETED,
      },
    });
  }

  await sendDocumentsForStatus(
    tx,
    input.caseId,
    input.targetStatus,
    sessionIdForDocs,
  );

  await createAuditLog(tx, {
    caseId: input.caseId,
    userId: input.actorUserId,
    action: "CASE_STATUS_TRANSITION",
    details: {
      from: input.currentStatus,
      to: input.targetStatus,
      reason: input.statusReason ?? null,
    },
  });
}

async function sendSchedulingDocuments(tx: Tx, caseId: string, sessionId: string) {
  await sendDocumentsForStatus(tx, caseId, CaseStatus.MATCHED);
  await sendDocumentsForStatus(tx, caseId, CaseStatus.SCHEDULED, sessionId);
}

function resolveSchedulingEventType(
  specialist: SpecialistSchedulingConfig,
  participantCount: number,
): SchedulingEventType {
  if (participantCount === 2) {
    if (!specialist.supportsCouples) {
      throw new DomainError(
        `${specialist.name} cannot run couple sessions based on current capability settings.`,
        409,
      );
    }

    return "couple";
  }

  return "individual";
}

function resolveSessionDurationMinutes(flags: string[], participantCount: number) {
  const durationFlag = flags.find((flag) => flag.startsWith("duration:"));
  if (durationFlag) {
    const parsed = Number(durationFlag.split(":")[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new DomainError(`Invalid duration flag '${durationFlag}'.`, 409);
    }

    return Math.round(parsed);
  }

  return participantCount === 2 ? 60 : 40;
}

function getPrimaryAttendee(caseRecord: CaseWithParticipantContacts) {
  const primary = caseRecord.participants[0]?.client;

  if (!primary) {
    throw new DomainError("Case has no participants and cannot be scheduled.", 409);
  }

  return {
    attendeeName: `${primary.firstName} ${primary.lastName}`,
    attendeeEmail: primary.email,
  };
}

export async function createCaseFromIntake(
  input: IntakeSubmissionInput,
  actorUserId?: string,
) {
  const durationFlag =
    typeof input.requestedDurationMinutes === "number"
      ? [`duration:${Math.round(input.requestedDurationMinutes)}`]
      : [];

  const created = await db.$transaction(async (tx) => {
    const reference = await nextCaseReference(tx);

    const caseRecord = await tx.case.create({
      data: {
        reference,
        status: CaseStatus.NEW,
        notes: input.notes?.trim() || null,
        flags: [input.secondary ? "couple" : "individual", ...durationFlag],
      },
    });

    const primaryClient = await tx.client.create({
      data: {
        firstName: input.primary.firstName.trim(),
        lastName: input.primary.lastName.trim(),
        email: input.primary.email.trim().toLowerCase(),
        phone: input.primary.phone?.trim() || null,
      },
    });

    await tx.caseParticipant.create({
      data: {
        caseId: caseRecord.id,
        clientId: primaryClient.id,
        role: "PRIMARY",
      },
    });

    if (input.secondary) {
      const secondaryClient = await tx.client.create({
        data: {
          firstName: input.secondary.firstName.trim(),
          lastName: input.secondary.lastName.trim(),
          email: input.secondary.email.trim().toLowerCase(),
          phone: input.secondary.phone?.trim() || null,
        },
      });

      await tx.caseParticipant.create({
        data: {
          caseId: caseRecord.id,
          clientId: secondaryClient.id,
          role: "SECONDARY",
        },
      });
    }

    await sendDocumentsForStatus(tx, caseRecord.id, CaseStatus.NEW);

    await createAuditLog(tx, {
      caseId: caseRecord.id,
      userId: actorUserId,
      action: "CASE_CREATED_FROM_INTAKE",
      details: {
        participantCount: input.secondary ? 2 : 1,
      },
    });

    return caseRecord;
  });

  let allocationError: string | null = null;

  if (input.autoAllocate ?? true) {
    try {
      await allocateCaseAutomatically(created.id, actorUserId);
    } catch (error) {
      allocationError =
        error instanceof Error
          ? error.message
          : "Automatic allocation failed after intake submission.";
    }
  }

  return {
    caseId: created.id,
    reference: created.reference,
    allocationError,
  };
}

export async function allocateCaseAutomatically(caseId: string, actorUserId?: string) {
  return db.$transaction(async (tx) => {
    const schedulingProvider = createSchedulingProvider(tx);
    const caseRecord = await tx.case.findUnique({
      where: { id: caseId },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new DomainError("Cannot allocate a closed case.", 409);
    }

    if (caseRecord.sessions.length > 0) {
      throw new DomainError(
        "Case already has an active session. Use manual override to reassign.",
        409,
      );
    }

    const participantCount = caseRecord.participants.length;
    const supportsCouplesRequired = participantCount === 2;
    const durationMinutes = resolveSessionDurationMinutes(caseRecord.flags, participantCount);

    const specialists = await tx.specialist.findMany({
      where: {
        active: true,
        ...(supportsCouplesRequired ? { supportsCouples: true } : {}),
      },
      select: {
        id: true,
        name: true,
        supportsCouples: true,
      },
    });

    if (specialists.length === 0) {
      throw new DomainError(
        supportsCouplesRequired
          ? "No active specialists available for couples."
          : "No active specialists available.",
        409,
      );
    }

    const casePrimaryAttendee = getPrimaryAttendee(caseRecord);

    const availabilityChecks = await Promise.all(
      specialists.map(async (specialist) => {
        const eventType = resolveSchedulingEventType(specialist, participantCount);
        const slots = await schedulingProvider.getAvailableSlots(
          specialist.id,
          eventType,
          durationMinutes,
        );

        if (slots.length === 0) {
          return null;
        }

        return {
          specialist,
          eventType,
          slot: slots[0],
        };
      }),
    );

    const firstAvailable = availabilityChecks
      .filter(
        (
          candidate,
        ): candidate is {
          specialist: SpecialistSchedulingConfig;
          eventType: SchedulingEventType;
          slot: Date;
        } => Boolean(candidate),
      )
      .sort((a, b) => {
        const first = a.slot.getTime();
        const second = b.slot.getTime();
        return first - second;
      })[0];

    if (!firstAvailable) {
      throw new DomainError("No matching slots were returned by the scheduling provider.", 409);
    }

    const bookingCaseData: SchedulingCaseData = {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantCount,
      attendeeName: casePrimaryAttendee.attendeeName,
      attendeeEmail: casePrimaryAttendee.attendeeEmail,
      eventType: firstAvailable.eventType,
      durationMinutes,
    };

    const booking = await schedulingProvider.createBooking(
      firstAvailable.specialist.id,
      firstAvailable.slot,
      bookingCaseData,
    );

    const session = await tx.session.create({
      data: {
        caseId,
        specialistId: firstAvailable.specialist.id,
        status: SessionStatus.SCHEDULED,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime,
        providerEndTime: booking.endTime,
        providerType: booking.providerType,
      },
    });

    const targetStatus = CaseStatus.SCHEDULED;

    await tx.case.update({
      where: { id: caseId },
      data: {
        assignedSpecialistId: firstAvailable.specialist.id,
        status: targetStatus,
      },
    });

    await sendSchedulingDocuments(tx, caseId, session.id);

    if (targetStatus !== caseRecord.status) {
      await createAuditLog(tx, {
        caseId,
        userId: actorUserId,
        action: "CASE_STATUS_TRANSITION",
        details: {
          from: caseRecord.status,
          to: targetStatus,
          reason: "Automatic allocation progression",
        },
      });
    }

    await createAuditLog(tx, {
      caseId,
      userId: actorUserId,
      action: "AUTO_ALLOCATED",
      details: {
        participantCount,
        durationMinutes,
        specialistId: firstAvailable.specialist.id,
        providerType: booking.providerType,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime.toISOString(),
        providerEndTime: booking.endTime.toISOString(),
        eventType: firstAvailable.eventType,
      },
    });

    return tx.case.findUnique({
      where: { id: caseId },
      include: {
        assignedSpecialist: true,
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });
  });
}

export async function overrideCaseAssignment(input: {
  caseId: string;
  specialistId: string;
  reason: string;
  matchingRuleOverride?: string;
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    const schedulingProvider = createSchedulingProvider(tx);
    const caseRecord = await tx.case.findUnique({
      where: { id: input.caseId },
      include: {
        participants: {
          include: {
            client: true,
          },
        },
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
          orderBy: {
            providerStartTime: "desc",
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    if (caseRecord.status === CaseStatus.CLOSED) {
      throw new DomainError("Cannot override assignment for a closed case.", 409);
    }

    const specialist = await tx.specialist.findUnique({
      where: {
        id: input.specialistId,
      },
      select: {
        id: true,
        name: true,
        supportsCouples: true,
      },
    });

    if (!specialist) {
      throw new DomainError("Specialist not found.", 404);
    }

    const participantCount = caseRecord.participants.length;
    const eventType = resolveSchedulingEventType(specialist, participantCount);
    const durationMinutes = resolveSessionDurationMinutes(caseRecord.flags, participantCount);
    const availableSlots = await schedulingProvider.getAvailableSlots(
      specialist.id,
      eventType,
      durationMinutes,
    );

    if (availableSlots.length === 0) {
      throw new DomainError(
        `Scheduling provider returned no bookable slots for specialist ${specialist.name}.`,
        409,
      );
    }

    const earliestSlot = availableSlots[0];
    const attendee = getPrimaryAttendee(caseRecord);

    const bookingCaseData: SchedulingCaseData = {
      caseId: caseRecord.id,
      caseReference: caseRecord.reference,
      participantCount,
      attendeeName: attendee.attendeeName,
      attendeeEmail: attendee.attendeeEmail,
      eventType,
      durationMinutes,
    };

    const booking = await schedulingProvider.createBooking(
      specialist.id,
      earliestSlot,
      bookingCaseData,
    );

    const activeSession = caseRecord.sessions[0] ?? null;
    if (activeSession?.providerBookingId) {
      await schedulingProvider.cancelBooking(activeSession.providerBookingId);
    }

    const session = activeSession
      ? await tx.session.update({
          where: {
            id: activeSession.id,
          },
          data: {
            specialistId: input.specialistId,
            status: SessionStatus.SCHEDULED,
            providerBookingId: booking.bookingId,
            providerStartTime: booking.startTime,
            providerEndTime: booking.endTime,
            providerType: booking.providerType,
          },
        })
      : await tx.session.create({
          data: {
            caseId: input.caseId,
            specialistId: input.specialistId,
            status: SessionStatus.SCHEDULED,
            providerBookingId: booking.bookingId,
            providerStartTime: booking.startTime,
            providerEndTime: booking.endTime,
            providerType: booking.providerType,
          },
        });

    const targetStatus = CaseStatus.SCHEDULED;

    await tx.case.update({
      where: { id: input.caseId },
      data: {
        assignedSpecialistId: input.specialistId,
        manualOverride: true,
        status: targetStatus,
      },
    });

    await sendSchedulingDocuments(tx, input.caseId, session.id);

    if (targetStatus !== caseRecord.status) {
      await createAuditLog(tx, {
        caseId: input.caseId,
        userId: input.actorUserId,
        action: "CASE_STATUS_TRANSITION",
        details: {
          from: caseRecord.status,
          to: targetStatus,
          reason: "Manual override progression",
        },
      });
    }

    await createAuditLog(tx, {
      caseId: input.caseId,
      userId: input.actorUserId,
      action: "MANUAL_OVERRIDE",
      details: {
        previousSessionId: activeSession?.id ?? null,
        previousProviderBookingId: activeSession?.providerBookingId ?? null,
        specialistId: input.specialistId,
        providerType: booking.providerType,
        providerBookingId: booking.bookingId,
        providerStartTime: booking.startTime.toISOString(),
        providerEndTime: booking.endTime.toISOString(),
        eventType,
        durationMinutes,
        reason: input.reason,
        matchingRuleOverride: input.matchingRuleOverride ?? null,
      },
    });

    return tx.case.findUnique({
      where: { id: input.caseId },
      include: {
        assignedSpecialist: true,
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });
  });
}

export async function transitionCaseStatus(input: {
  caseId: string;
  targetStatus: CaseStatus;
  actorUserId?: string;
  reason?: string;
}) {
  return db.$transaction(async (tx) => {
    const caseRecord = await tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        sessions: {
          where: {
            status: {
              in: ACTIVE_SESSION_STATUSES,
            },
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
      },
    });

    if (!caseRecord) {
      throw new DomainError("Case not found.", 404);
    }

    await setCaseStatus(tx, {
      caseId: input.caseId,
      currentStatus: caseRecord.status,
      targetStatus: input.targetStatus,
      actorUserId: input.actorUserId,
      statusReason: input.reason,
      sessionIdForDocs:
        input.targetStatus === CaseStatus.SCHEDULED
          ? caseRecord.sessions[0]?.id
          : undefined,
    });

    return tx.case.findUnique({
      where: {
        id: input.caseId,
      },
      include: {
        assignedSpecialist: true,
        participants: {
          include: {
            client: true,
          },
        },
        sessions: {
          include: {
            specialist: true,
          },
          orderBy: {
            providerStartTime: "asc",
          },
        },
        documents: {
          include: {
            template: true,
          },
          orderBy: {
            sentAt: "asc",
          },
        },
      },
    });
  });
}

export async function completeDocumentInstance(documentId: string, actorUserId?: string) {
  return db.$transaction(async (tx) => {
    const document = await tx.documentInstance.findUnique({
      where: {
        id: documentId,
      },
      include: {
        case: true,
        template: true,
      },
    });

    if (!document) {
      throw new DomainError("Document not found.", 404);
    }

    if (document.status === DocumentState.COMPLETED) {
      return document;
    }

    const updated = await tx.documentInstance.update({
      where: {
        id: documentId,
      },
      data: {
        status: DocumentState.COMPLETED,
        completedAt: new Date(),
      },
      include: {
        template: true,
      },
    });

    await createAuditLog(tx, {
      caseId: document.caseId,
      userId: actorUserId,
      action: "DOCUMENT_COMPLETED",
      details: {
        documentId,
        templateCode: document.template.code,
      },
    });

    return updated;
  });
}

export async function listCasesForOps() {
  return db.case.findMany({
    include: {
      participants: {
        include: {
          client: true,
        },
      },
      assignedSpecialist: true,
      sessions: {
        where: {
          status: {
            in: ACTIVE_SESSION_STATUSES,
          },
        },
        orderBy: {
          providerStartTime: "asc",
        },
      },
      documents: {
        include: {
          template: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function listClientsForOps() {
  return db.client.findMany({
    include: {
      participants: {
        include: {
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              assignedSpecialist: {
                select: {
                  id: true,
                  name: true,
                },
              },
              sessions: {
                where: {
                  status: {
                    in: ACTIVE_SESSION_STATUSES,
                  },
                },
                orderBy: {
                  providerStartTime: "asc",
                },
                take: 1,
                select: {
                  id: true,
                  providerStartTime: true,
                },
              },
            },
          },
        },
        orderBy: {
          case: {
            updatedAt: "desc",
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function listClientsForSpecialist(specialistId: string) {
  return db.client.findMany({
    where: {
      participants: {
        some: {
          case: {
            assignedSpecialistId: specialistId,
          },
        },
      },
    },
    include: {
      participants: {
        where: {
          case: {
            assignedSpecialistId: specialistId,
          },
        },
        include: {
          case: {
            select: {
              id: true,
              reference: true,
              status: true,
              sessions: {
                where: {
                  specialistId,
                },
                orderBy: {
                  providerStartTime: "asc",
                },
                select: {
                  id: true,
                  providerStartTime: true,
                },
              },
            },
          },
        },
        orderBy: {
          case: {
            updatedAt: "desc",
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function getCaseDetails(caseId: string) {
  return db.case.findUnique({
    where: { id: caseId },
    include: {
      participants: {
        include: {
          client: true,
        },
      },
      assignedSpecialist: true,
      sessions: {
        include: {
          specialist: true,
          documents: {
            include: {
              template: true,
            },
          },
        },
        orderBy: {
          providerStartTime: "asc",
        },
      },
      documents: {
        include: {
          template: true,
        },
        orderBy: {
          sentAt: "asc",
        },
      },
      auditLogs: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      },
    },
  });
}

export async function listSpecialistsForOps() {
  return db.specialist.findMany({
    include: {
      sessions: {
        where: {
          providerStartTime: {
            gte: new Date(),
          },
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getSpecialistProfileForOps(specialistId: string) {
  return db.specialist.findUnique({
    where: {
      id: specialistId,
    },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      },
      sessions: {
        include: {
          case: {
            include: {
              participants: {
                include: {
                  client: true,
                },
              },
            },
          },
        },
        orderBy: {
          providerStartTime: "desc",
        },
        take: 50,
      },
      assignedCases: {
        where: {
          status: {
            not: CaseStatus.CLOSED,
          },
        },
        include: {
          participants: {
            include: {
              client: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 25,
      },
    },
  });
}

export async function createSpecialist(input: {
  name: string;
  email: string;
  supportsCouples: boolean;
  capabilities: string[];
  calUserId: string;
  calIndividualEventTypeId: string;
  calCouplesEventTypeId?: string;
  password?: string;
  notes?: string;
}) {
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedCalUserId = input.calUserId.trim();

  const existingUser = await db.userAccount.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new DomainError("A user with this email already exists.", 409);
  }

  const existingCalUserId = await db.specialist.findUnique({
    where: {
      calUserId: normalizedCalUserId,
    },
    select: {
      id: true,
    },
  });

  if (existingCalUserId) {
    throw new DomainError("Another specialist already uses this Cal.com user id.", 409);
  }

  const passwordHash = await hash(input.password || "password123", 10);

  return db.specialist.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      supportsCouples: input.supportsCouples,
      capabilities: input.capabilities,
      notes: input.notes?.trim() || null,
      calUserId: normalizedCalUserId,
      calIndividualEventTypeId: input.calIndividualEventTypeId.trim(),
      calCouplesEventTypeId: input.calCouplesEventTypeId?.trim() || null,
      userAccount: {
        create: {
          email: normalizedEmail,
          name: input.name.trim(),
          passwordHash,
          role: UserRole.SPECIALIST,
        },
      },
    },
  });
}

export async function updateSpecialistProfile(input: {
  specialistId: string;
  name: string;
  email: string;
  supportsCouples: boolean;
  active: boolean;
  capabilities: string[];
  notes?: string;
  calUserId: string;
  calIndividualEventTypeId: string;
  calCouplesEventTypeId?: string;
  actorUserId: string;
}) {
  const normalizedName = input.name.trim();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedNotes = input.notes?.trim() || null;
  const normalizedCalUserId = input.calUserId.trim();
  const normalizedIndividualEventTypeId = input.calIndividualEventTypeId.trim();
  const normalizedCouplesEventTypeId = input.calCouplesEventTypeId?.trim() || null;

  if (
    !normalizedName ||
    !normalizedEmail ||
    !normalizedCalUserId ||
    !normalizedIndividualEventTypeId
  ) {
    throw new DomainError(
      "Name, email, Cal.com user id, and individual event type id are required.",
      409,
    );
  }

  if (input.supportsCouples && !normalizedCouplesEventTypeId) {
    throw new DomainError(
      "Couples event type id is required for specialists that support couples.",
      409,
    );
  }

  const specialist = await db.specialist.findUnique({
    where: {
      id: input.specialistId,
    },
    include: {
      userAccount: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  if (!specialist) {
    throw new DomainError("Specialist not found.", 404);
  }

  const accountConflict = await db.userAccount.findFirst({
    where: {
      email: normalizedEmail,
      ...(specialist.userAccount ? { NOT: { id: specialist.userAccount.id } } : {}),
    },
    select: {
      id: true,
    },
  });

  if (accountConflict) {
    throw new DomainError("Another user already uses this email.", 409);
  }

  const specialistConflict = await db.specialist.findFirst({
    where: {
      email: normalizedEmail,
      NOT: {
        id: specialist.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (specialistConflict) {
    throw new DomainError("Another specialist already uses this email.", 409);
  }

  const calUserConflict = await db.specialist.findFirst({
    where: {
      calUserId: normalizedCalUserId,
      NOT: {
        id: specialist.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (calUserConflict) {
    throw new DomainError("Another specialist already uses this Cal.com user id.", 409);
  }

  const changedFields = {
    name:
      specialist.name !== normalizedName
        ? { from: specialist.name, to: normalizedName }
        : null,
    email:
      specialist.email !== normalizedEmail
        ? { from: specialist.email, to: normalizedEmail }
        : null,
    supportsCouples:
      specialist.supportsCouples !== input.supportsCouples
        ? { from: specialist.supportsCouples, to: input.supportsCouples }
        : null,
    active:
      specialist.active !== input.active
        ? { from: specialist.active, to: input.active }
        : null,
    capabilities:
      JSON.stringify(specialist.capabilities) !== JSON.stringify(input.capabilities)
        ? { from: specialist.capabilities, to: input.capabilities }
        : null,
    notes:
      (specialist.notes || null) !== normalizedNotes
        ? { from: specialist.notes || null, to: normalizedNotes }
        : null,
    calUserId:
      specialist.calUserId !== normalizedCalUserId
        ? { from: specialist.calUserId, to: normalizedCalUserId }
        : null,
    calIndividualEventTypeId:
      specialist.calIndividualEventTypeId !== normalizedIndividualEventTypeId
        ? {
            from: specialist.calIndividualEventTypeId,
            to: normalizedIndividualEventTypeId,
          }
        : null,
    calCouplesEventTypeId:
      (specialist.calCouplesEventTypeId || null) !== normalizedCouplesEventTypeId
        ? {
            from: specialist.calCouplesEventTypeId || null,
            to: normalizedCouplesEventTypeId,
          }
        : null,
  };

  return db.$transaction(async (tx) => {
    const updatedSpecialist = await tx.specialist.update({
      where: {
        id: specialist.id,
      },
      data: {
        name: normalizedName,
        email: normalizedEmail,
        supportsCouples: input.supportsCouples,
        active: input.active,
        capabilities: input.capabilities,
        notes: normalizedNotes,
        calUserId: normalizedCalUserId,
        calIndividualEventTypeId: normalizedIndividualEventTypeId,
        calCouplesEventTypeId: normalizedCouplesEventTypeId,
      },
    });

    if (specialist.userAccount) {
      await tx.userAccount.update({
        where: {
          id: specialist.userAccount.id,
        },
        data: {
          name: normalizedName,
          email: normalizedEmail,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: "SPECIALIST_PROFILE_UPDATED",
        details: {
          specialistId: specialist.id,
          changedFields,
        },
      },
    });

    return updatedSpecialist;
  });
}

export async function getUpcomingSessionsForSpecialist(specialistId: string) {
  return db.session.findMany({
    where: {
      specialistId,
      providerStartTime: {
        gte: new Date(),
      },
      status: {
        in: [SessionStatus.SCHEDULED, SessionStatus.IN_SESSION],
      },
    },
    include: {
      case: {
        include: {
          participants: {
            include: {
              client: true,
            },
          },
          documents: {
            include: {
              template: true,
            },
          },
          sessions: {
            include: {
              specialist: true,
            },
            orderBy: {
              providerStartTime: "asc",
            },
          },
        },
      },
    },
    orderBy: {
      providerStartTime: "asc",
    },
  });
}

export async function getSessionBriefingForSpecialist(
  sessionId: string,
  specialistId: string,
) {
  return db.session.findFirst({
    where: {
      id: sessionId,
      specialistId,
    },
    include: {
      specialist: true,
      case: {
        include: {
          participants: {
            include: {
              client: true,
            },
          },
          documents: {
            include: {
              template: true,
            },
            orderBy: {
              sentAt: "asc",
            },
          },
          sessions: {
            include: {
              specialist: true,
            },
            orderBy: {
              providerStartTime: "asc",
            },
          },
        },
      },
    },
  });
}

export async function getCaseStatusOptions(current: CaseStatus) {
  return CASE_TRANSITIONS[current];
}

export async function transitionToStatusIfAllowed(input: {
  caseId: string;
  targetStatus: CaseStatus;
  actorUserId?: string;
  reason?: string;
}) {
  return transitionCaseStatus(input);
}

export async function markDocumentComplete(input: {
  documentId: string;
  actorUserId?: string;
}) {
  return completeDocumentInstance(input.documentId, input.actorUserId);
}

export async function canUserOverride(userId: string) {
  const operationsUser = await db.operationsUser.findFirst({
    where: {
      userId,
      canOverride: true,
    },
    select: {
      id: true,
    },
  });

  return Boolean(operationsUser);
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function domainErrorMessage(error: unknown) {
  if (error instanceof DomainError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export function isCoupleCase(participantCount: number) {
  return participantCount === 2;
}

export function getRequiredDocumentCodesForStatus(status: CaseStatus) {
  return REQUIRED_DOCUMENTS_TO_ENTER[status] ?? [];
}

export function getDocumentCodeFriendlyName(code: string) {
  switch (code) {
    case DOCUMENT_CODES.TERMS_AND_CONDITIONS:
      return "Terms & Conditions";
    case DOCUMENT_CODES.CONTRACT:
      return "Contract";
    case DOCUMENT_CODES.INTAKE_FORM:
      return "Intake Form";
    case DOCUMENT_CODES.OUTTAKE_FORM:
      return "Outtake Form";
    default:
      return code;
  }
}
