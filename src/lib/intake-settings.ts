import { db } from "@/lib/db";

export const INTAKE_FORM_CONTENT_KEY = "intake_form_content";

export type CrisisContact = {
  label: string;
  phone: string;
  description: string;
};

export type AvailabilityNote = {
  title: string;
  body: string;
};

export type IntakeFormContent = {
  crisisModal: {
    title: string;
    intro: string;
    contacts: CrisisContact[];
  };
  availability: {
    heading: string;
    subheading: string;
    notes: AvailabilityNote[];
    disclaimer: string;
    prompt: string;
  };
};

export const DEFAULT_INTAKE_FORM_CONTENT: IntakeFormContent = {
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
    subheading: "The more available you are the sooner you could be allocated to a Counsellor.",
    notes: [
      {
        title: "EVENING SESSIONS",
        body: "There are limited in-person appointments on Tuesday and Thursday evenings in Newtownards.",
      },
      {
        title: "COUPLES COUNSELLING",
        body: "We have very limited availability for couples counselling on Tuesday evenings and no couples counselling is available on Thursday evenings.",
      },
      {
        title: "SESSION TIMES",
        body: "Sessions do not commence before 9.30am and our last appointment on Tuesday or Thursdays is no later than 8.00pm.",
      },
    ],
    disclaimer: "We will endeavour to accommodate your request but this may not always be possible.",
    prompt: "Please list the days and times you are available (plus any other information regarding your availability).",
  },
};

function normalizeContacts(contacts: unknown): CrisisContact[] {
  if (!Array.isArray(contacts)) {
    return DEFAULT_INTAKE_FORM_CONTENT.crisisModal.contacts;
  }

  return contacts
    .map((entry) => {
      const candidate = entry as Partial<CrisisContact>;
      return {
        label: String(candidate.label || "").trim(),
        phone: String(candidate.phone || "").trim(),
        description: String(candidate.description || "").trim(),
      };
    })
    .filter((entry) => entry.label.length > 0);
}

function normalizeNotes(notes: unknown): AvailabilityNote[] {
  if (!Array.isArray(notes)) {
    return DEFAULT_INTAKE_FORM_CONTENT.availability.notes;
  }

  return notes
    .map((entry) => {
      const candidate = entry as Partial<AvailabilityNote>;
      return {
        title: String(candidate.title || "").trim(),
        body: String(candidate.body || "").trim(),
      };
    })
    .filter((entry) => entry.title.length > 0 && entry.body.length > 0);
}

function normalizeContent(candidate: unknown): IntakeFormContent {
  const parsed = (candidate as Partial<IntakeFormContent>) || {};
  const crisisModal = (parsed.crisisModal || {}) as Partial<IntakeFormContent["crisisModal"]>;
  const availability = (parsed.availability || {}) as Partial<IntakeFormContent["availability"]>;

  return {
    crisisModal: {
      title: String(crisisModal.title || DEFAULT_INTAKE_FORM_CONTENT.crisisModal.title).trim(),
      intro: String(crisisModal.intro || DEFAULT_INTAKE_FORM_CONTENT.crisisModal.intro).trim(),
      contacts: normalizeContacts(crisisModal.contacts),
    },
    availability: {
      heading: String(availability.heading || DEFAULT_INTAKE_FORM_CONTENT.availability.heading).trim(),
      subheading: String(
        availability.subheading || DEFAULT_INTAKE_FORM_CONTENT.availability.subheading,
      ).trim(),
      notes: normalizeNotes(availability.notes),
      disclaimer: String(
        availability.disclaimer || DEFAULT_INTAKE_FORM_CONTENT.availability.disclaimer,
      ).trim(),
      prompt: String(availability.prompt || DEFAULT_INTAKE_FORM_CONTENT.availability.prompt).trim(),
    },
  };
}

export async function getIntakeFormContent() {
  const setting = await db.systemSetting.findUnique({
    where: {
      key: INTAKE_FORM_CONTENT_KEY,
    },
    select: {
      value: true,
    },
  });

  if (!setting) {
    await db.systemSetting.create({
      data: {
        key: INTAKE_FORM_CONTENT_KEY,
        value: DEFAULT_INTAKE_FORM_CONTENT,
      },
    });
    return DEFAULT_INTAKE_FORM_CONTENT;
  }

  return normalizeContent(setting.value);
}

export async function updateIntakeFormContent(input: IntakeFormContent, actorUserId: string) {
  const normalized = normalizeContent(input);
  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: {
        key: INTAKE_FORM_CONTENT_KEY,
      },
      update: {
        value: normalized,
      },
      create: {
        key: INTAKE_FORM_CONTENT_KEY,
        value: normalized,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "INTAKE_FORM_CONTENT_UPDATED",
        details: {
          key: INTAKE_FORM_CONTENT_KEY,
        },
      },
    });
  });
}
