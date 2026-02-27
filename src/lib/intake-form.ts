import { z } from "zod";
import { CaseStatus } from "@prisma/client";

export const PRESENTING_ISSUE_OPTIONS = [
  "ABUSE",
  "ADDICTION",
  "ANXIETY_STRESS",
  "EATING_DISORDER",
  "EMPLOYMENT",
  "FAMILY",
  "FINANCIAL",
  "LOSS_BEREAVEMENT",
  "MARRIAGE",
  "MENTAL_HEALTH",
  "NEURODIVERSITY",
  "RELATIONSHIPS",
  "SELF_ESTEEM",
  "SEXUAL",
  "SPIRITUAL",
  "OTHER",
] as const;

export const HEARD_ABOUT_OPTIONS = [
  "FRIEND_OR_FAMILY",
  "CHURCH",
  "SOCIAL_MEDIA",
  "WEBSITE",
  "GP_OR_HEALTHCARE",
  "OTHER",
] as const;

export const LOCATION_OPTIONS = [
  "NEWTOWNARDS",
  "CARRICKFERGUS",
  "DERRY_LONDONDERRY",
  "DROMORE_CO_DOWN",
  "ENNISKILLEN",
] as const;

export const TIME_PREFERENCE_OPTIONS = ["MORNING", "AFTERNOON", "EVENING"] as const;

export const DAY_OPTIONS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

export const EVENING_ELIGIBLE_DAYS: ReadonlySet<string> = new Set(["TUESDAY", "THURSDAY"]);

export const CONTACT_PREFERENCE_ROWS = [
  { key: "contactMainPhone", label: "May we contact you on your main phone number?" },
  { key: "leaveVoicemailMainPhone", label: "May we leave voicemail on your main phone number?" },
  { key: "contactSecondPhone", label: "May we contact you on your second phone number?" },
  { key: "leaveVoicemailSecondPhone", label: "May we leave voicemail on your second phone number?" },
  { key: "contactEmail", label: "May we contact you by email?" },
  { key: "contactWhatsApp", label: "May we contact you via WhatsApp?" },
] as const;

const yesNoSchema = z.enum(["yes", "no"]);
const yesNoPreferSchema = z.enum(["yes", "no", "prefer_not_to_say"]);

export const availabilitySlotSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

const secondaryParticipantSchema = z
  .object({
    title: z.string().trim().max(24).optional(),
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    email: z.string().trim().email().max(320).optional(),
    mainPhone: z.string().trim().max(40).optional(),
    dateOfBirth: z.string().trim().max(40).optional(),
    gender: z.enum(["female", "male"]).optional(),
  })
  .default({});

export const newIntakeApiSchema = z
  .object({
    accessKey: z.string().trim().min(1).optional().default(""),
    participantType: z.enum(["single", "couple"]),
    primary: z.object({
      title: z.string().trim().min(1).max(24),
      firstName: z.string().trim().min(1).max(120),
      lastName: z.string().trim().min(1).max(120),
      dateOfBirth: z.string().trim().min(1).max(40),
      gender: z.enum(["female", "male"]),
      email: z.string().trim().email().max(320),
      mainPhone: z.string().trim().min(1).max(40),
      secondPhone: z.string().trim().max(40).optional(),
      addressLine1: z.string().trim().min(1).max(120),
      addressLine2: z.string().trim().max(120).optional(),
      city: z.string().trim().min(1).max(120),
      county: z.string().trim().max(120).optional(),
      postcode: z.string().trim().min(1).max(24),
      countryIfNotUk: z.string().trim().max(120).optional(),
      churchConnection: yesNoPreferSchema,
      leadershipRole: yesNoPreferSchema,
      heardAbout: z.enum(HEARD_ABOUT_OPTIONS),
      heardAboutOtherDetail: z.string().trim().max(1000).optional(),
      contactPreferences: z.object({
        contactMainPhone: yesNoSchema,
        leaveVoicemailMainPhone: yesNoSchema,
        contactSecondPhone: yesNoSchema,
        leaveVoicemailSecondPhone: yesNoSchema,
        contactEmail: yesNoSchema,
        contactWhatsApp: yesNoSchema,
      }),
      emergencyContactFirstName: z.string().trim().min(1).max(120),
      emergencyContactLastName: z.string().trim().min(1).max(120),
      emergencyRelationship: z.string().trim().min(1).max(120),
      emergencyPhone: z.string().trim().min(1).max(40),
      gpSurgeryName: z.string().trim().min(1).max(160),
      gpSurgeryPhone: z.string().trim().min(1).max(40),
      gpDoctorName: z.string().trim().max(160).optional(),
    }),
    secondary: secondaryParticipantSchema,
    counsellingType: z.enum(["individual", "couples"]),
    consent: z.object({
      signature: z.string().trim().min(1).max(300000),
      signatureType: z.enum(["typed", "drawn"]),
      signedAt: z.string().datetime().optional(),
    }),
    presenting: z.object({
      mainIssue: z.enum(PRESENTING_ISSUE_OPTIONS),
      otherDetails: z.string().trim().max(1000).optional(),
      issueDuration: z.string().trim().min(1).max(200),
      previousSupport: yesNoSchema,
      previousSupportDetails: z.string().trim().max(1000).optional(),
      suicidalThoughtsRecently: yesNoSchema,
      suicidalThoughtsDetails: z.string().trim().max(1000).optional(),
      attemptedSuicide: yesNoSchema,
      attemptedSuicideDetails: z.string().trim().max(1000).optional(),
    }),
    availability: z.object({
      location: z.enum(LOCATION_OPTIONS),
      includeOnline: z.boolean().default(false),
      notes: z.string().trim().max(1000).optional(),
      dayTimeBlocks: z.array(z.object({
        day: z.enum(DAY_OPTIONS),
        block: z.enum(TIME_PREFERENCE_OPTIONS),
      })).min(1),
      timePreferences: z.array(z.enum(TIME_PREFERENCE_OPTIONS)).max(3).default([]),
      selectedSlots: z.array(availabilitySlotSchema).max(40).default([]),
    }),
    requestedDurationMinutes: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.primary.heardAbout === "OTHER" && !value.primary.heardAboutOtherDetail?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide detail for 'how you heard about us'.",
        path: ["primary", "heardAboutOtherDetail"],
      });
    }

    if (value.presenting.mainIssue === "OTHER" && !value.presenting.otherDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide detail for presenting issue 'OTHER'.",
        path: ["presenting", "otherDetails"],
      });
    }

    if (value.presenting.previousSupport === "yes" && !value.presenting.previousSupportDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide previous support details.",
        path: ["presenting", "previousSupportDetails"],
      });
    }

    if (
      value.presenting.suicidalThoughtsRecently === "yes" &&
      !value.presenting.suicidalThoughtsDetails?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details for recent suicidal thoughts.",
        path: ["presenting", "suicidalThoughtsDetails"],
      });
    }

    if (value.presenting.attemptedSuicide === "yes" && !value.presenting.attemptedSuicideDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details for attempted suicide.",
        path: ["presenting", "attemptedSuicideDetails"],
      });
    }

    if (value.participantType === "couple") {
      if (!value.secondary.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary first name is required for couples.",
          path: ["secondary", "firstName"],
        });
      }
      if (!value.secondary.lastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary last name is required for couples.",
          path: ["secondary", "lastName"],
        });
      }
      if (!value.secondary.email?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary email is required for couples.",
          path: ["secondary", "email"],
        });
      }
      if (!value.secondary.mainPhone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary main phone is required for couples.",
          path: ["secondary", "mainPhone"],
        });
      }
      if (!value.secondary.dateOfBirth?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary date of birth is required for couples.",
          path: ["secondary", "dateOfBirth"],
        });
      }
      if (!value.secondary.gender) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Secondary gender is required for couples.",
          path: ["secondary", "gender"],
        });
      }
    }
  });

export const legacyIntakeApiSchema = z
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

export type NewIntakeApiPayload = z.infer<typeof newIntakeApiSchema>;
