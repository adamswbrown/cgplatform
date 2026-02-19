import { db } from "@/lib/db";

export const OPERATIONAL_SETTINGS_KEY = "operational_settings";

export type SchedulingAssignmentMode = "manual" | "auto";
export type SchedulingEngineType = "manual" | "calcom" | "microsoft_bookings";
export type IntakeSourceType = "SECURE_LINK" | "MICROSOFT_FORMS" | "JOTFORM" | "WEB_FORM";

export type OperationalSettings = {
  schedulingEngineType: SchedulingEngineType;
  schedulingAssignmentMode: SchedulingAssignmentMode;
  defaultIntakeSource: IntakeSourceType;
  defaultIndividualSessionMinutes: number;
  defaultCoupleSessionMinutes: number;
  defaultSpecialistStandardStartHour: number;
  defaultSpecialistStandardEndHour: number;
  requireTermsBeforeInSession: boolean;
  requireOuttakeBeforeClose: boolean;
  manualProviderHorizonDays: number;
  manualProviderSlotIncrementMinutes: number;
  manualProviderMorningStartHour: number;
  manualProviderMorningEndHour: number;
  manualProviderAfternoonStartHour: number;
  manualProviderAfternoonEndHour: number;
  defaultFormPinExpiresHours: number;
  defaultFormPinMaxAttempts: number;
  defaultIntakeInviteExpiresHours: number;
  defaultIntakeInviteMaxAttempts: number;
  formAccessSessionHours: number;
  specialistAvailabilityDefaultGridDays: number;
  specialistAvailabilityMaxGridDays: number;
};

const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  schedulingEngineType: "manual",
  schedulingAssignmentMode: "manual",
  defaultIntakeSource: "SECURE_LINK",
  defaultIndividualSessionMinutes: 40,
  defaultCoupleSessionMinutes: 60,
  defaultSpecialistStandardStartHour: 9,
  defaultSpecialistStandardEndHour: 18,
  requireTermsBeforeInSession: true,
  requireOuttakeBeforeClose: true,
  manualProviderHorizonDays: 14,
  manualProviderSlotIncrementMinutes: 10,
  manualProviderMorningStartHour: 9,
  manualProviderMorningEndHour: 12,
  manualProviderAfternoonStartHour: 13,
  manualProviderAfternoonEndHour: 17,
  defaultFormPinExpiresHours: 72,
  defaultFormPinMaxAttempts: 5,
  defaultIntakeInviteExpiresHours: 72,
  defaultIntakeInviteMaxAttempts: 5,
  formAccessSessionHours: 8,
  specialistAvailabilityDefaultGridDays: 14,
  specialistAvailabilityMaxGridDays: 62,
};

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.round(parsed);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }

  return normalized;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function normalizeSchedulingAssignmentMode(value: unknown): SchedulingAssignmentMode | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "manual") {
    return "manual";
  }
  if (normalized === "auto") {
    return "auto";
  }

  return null;
}

export function normalizeSchedulingEngineType(value: unknown): SchedulingEngineType | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "manual") {
    return "manual";
  }
  if (normalized === "calcom") {
    return "calcom";
  }
  if (normalized === "microsoft_bookings" || normalized === "microsoft-bookings") {
    return "microsoft_bookings";
  }

  return null;
}

export function normalizeIntakeSourceType(value: unknown): IntakeSourceType | null {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");

  if (normalized === "SECURE_LINK" || normalized === "SECURE_INTAKE") {
    return "SECURE_LINK";
  }
  if (normalized === "MICROSOFT_FORMS") {
    return "MICROSOFT_FORMS";
  }
  if (normalized === "JOTFORM") {
    return "JOTFORM";
  }
  if (normalized === "WEB_FORM") {
    return "WEB_FORM";
  }

  return null;
}

function defaultAssignmentModeFromEnvironment() {
  return (
    normalizeSchedulingAssignmentMode(process.env.SCHEDULING_ASSIGNMENT_MODE) ||
    DEFAULT_OPERATIONAL_SETTINGS.schedulingAssignmentMode
  );
}

function defaultEngineTypeFromEnvironment() {
  return (
    normalizeSchedulingEngineType(
      process.env.SCHEDULING_ENGINE || process.env.SCHEDULING_PROVIDER,
    ) || DEFAULT_OPERATIONAL_SETTINGS.schedulingEngineType
  );
}

function defaultIntakeSourceFromEnvironment() {
  return (
    normalizeIntakeSourceType(process.env.DEFAULT_INTAKE_SOURCE) ||
    DEFAULT_OPERATIONAL_SETTINGS.defaultIntakeSource
  );
}

function normalizeOperationalSettings(candidate: unknown): OperationalSettings {
  const parsed = (candidate as Partial<OperationalSettings>) || {};

  let defaultSpecialistStandardStartHour = clampInteger(
    parsed.defaultSpecialistStandardStartHour,
    DEFAULT_OPERATIONAL_SETTINGS.defaultSpecialistStandardStartHour,
    0,
    22,
  );
  let defaultSpecialistStandardEndHour = clampInteger(
    parsed.defaultSpecialistStandardEndHour,
    DEFAULT_OPERATIONAL_SETTINGS.defaultSpecialistStandardEndHour,
    1,
    23,
  );
  if (defaultSpecialistStandardEndHour <= defaultSpecialistStandardStartHour) {
    defaultSpecialistStandardStartHour =
      DEFAULT_OPERATIONAL_SETTINGS.defaultSpecialistStandardStartHour;
    defaultSpecialistStandardEndHour = DEFAULT_OPERATIONAL_SETTINGS.defaultSpecialistStandardEndHour;
  }

  const specialistAvailabilityDefaultGridDays = clampInteger(
    parsed.specialistAvailabilityDefaultGridDays,
    DEFAULT_OPERATIONAL_SETTINGS.specialistAvailabilityDefaultGridDays,
    1,
    120,
  );
  let specialistAvailabilityMaxGridDays = clampInteger(
    parsed.specialistAvailabilityMaxGridDays,
    DEFAULT_OPERATIONAL_SETTINGS.specialistAvailabilityMaxGridDays,
    1,
    180,
  );
  if (specialistAvailabilityMaxGridDays < specialistAvailabilityDefaultGridDays) {
    specialistAvailabilityMaxGridDays = specialistAvailabilityDefaultGridDays;
  }

  let manualProviderMorningStartHour = clampInteger(
    parsed.manualProviderMorningStartHour,
    DEFAULT_OPERATIONAL_SETTINGS.manualProviderMorningStartHour,
    0,
    23,
  );
  let manualProviderMorningEndHour = clampInteger(
    parsed.manualProviderMorningEndHour,
    DEFAULT_OPERATIONAL_SETTINGS.manualProviderMorningEndHour,
    1,
    23,
  );

  if (manualProviderMorningEndHour <= manualProviderMorningStartHour) {
    manualProviderMorningStartHour = DEFAULT_OPERATIONAL_SETTINGS.manualProviderMorningStartHour;
    manualProviderMorningEndHour = DEFAULT_OPERATIONAL_SETTINGS.manualProviderMorningEndHour;
  }

  let manualProviderAfternoonStartHour = clampInteger(
    parsed.manualProviderAfternoonStartHour,
    DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonStartHour,
    0,
    23,
  );
  let manualProviderAfternoonEndHour = clampInteger(
    parsed.manualProviderAfternoonEndHour,
    DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonEndHour,
    1,
    23,
  );

  if (manualProviderAfternoonEndHour <= manualProviderAfternoonStartHour) {
    manualProviderAfternoonStartHour =
      DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonStartHour;
    manualProviderAfternoonEndHour = DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonEndHour;
  }

  if (manualProviderAfternoonStartHour < manualProviderMorningEndHour) {
    manualProviderAfternoonStartHour = manualProviderMorningEndHour;
    if (manualProviderAfternoonEndHour <= manualProviderAfternoonStartHour) {
      manualProviderAfternoonStartHour =
        DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonStartHour;
      manualProviderAfternoonEndHour = DEFAULT_OPERATIONAL_SETTINGS.manualProviderAfternoonEndHour;
    }
  }

  return {
    schedulingEngineType:
      normalizeSchedulingEngineType(parsed.schedulingEngineType) ||
      defaultEngineTypeFromEnvironment(),
    schedulingAssignmentMode:
      normalizeSchedulingAssignmentMode(parsed.schedulingAssignmentMode) ||
      defaultAssignmentModeFromEnvironment(),
    defaultIntakeSource:
      normalizeIntakeSourceType(parsed.defaultIntakeSource) || defaultIntakeSourceFromEnvironment(),
    defaultIndividualSessionMinutes: clampInteger(
      parsed.defaultIndividualSessionMinutes,
      DEFAULT_OPERATIONAL_SETTINGS.defaultIndividualSessionMinutes,
      30,
      180,
    ),
    defaultCoupleSessionMinutes: clampInteger(
      parsed.defaultCoupleSessionMinutes,
      DEFAULT_OPERATIONAL_SETTINGS.defaultCoupleSessionMinutes,
      30,
      180,
    ),
    defaultSpecialistStandardStartHour,
    defaultSpecialistStandardEndHour,
    requireTermsBeforeInSession: normalizeBoolean(
      parsed.requireTermsBeforeInSession,
      DEFAULT_OPERATIONAL_SETTINGS.requireTermsBeforeInSession,
    ),
    requireOuttakeBeforeClose: normalizeBoolean(
      parsed.requireOuttakeBeforeClose,
      DEFAULT_OPERATIONAL_SETTINGS.requireOuttakeBeforeClose,
    ),
    manualProviderHorizonDays: clampInteger(
      parsed.manualProviderHorizonDays,
      DEFAULT_OPERATIONAL_SETTINGS.manualProviderHorizonDays,
      1,
      60,
    ),
    manualProviderSlotIncrementMinutes: clampInteger(
      parsed.manualProviderSlotIncrementMinutes,
      DEFAULT_OPERATIONAL_SETTINGS.manualProviderSlotIncrementMinutes,
      5,
      60,
    ),
    manualProviderMorningStartHour,
    manualProviderMorningEndHour,
    manualProviderAfternoonStartHour,
    manualProviderAfternoonEndHour,
    defaultFormPinExpiresHours: clampInteger(
      parsed.defaultFormPinExpiresHours,
      DEFAULT_OPERATIONAL_SETTINGS.defaultFormPinExpiresHours,
      1,
      24 * 14,
    ),
    defaultFormPinMaxAttempts: clampInteger(
      parsed.defaultFormPinMaxAttempts,
      DEFAULT_OPERATIONAL_SETTINGS.defaultFormPinMaxAttempts,
      1,
      20,
    ),
    defaultIntakeInviteExpiresHours: clampInteger(
      parsed.defaultIntakeInviteExpiresHours,
      DEFAULT_OPERATIONAL_SETTINGS.defaultIntakeInviteExpiresHours,
      1,
      24 * 14,
    ),
    defaultIntakeInviteMaxAttempts: clampInteger(
      parsed.defaultIntakeInviteMaxAttempts,
      DEFAULT_OPERATIONAL_SETTINGS.defaultIntakeInviteMaxAttempts,
      1,
      20,
    ),
    formAccessSessionHours: clampInteger(
      parsed.formAccessSessionHours,
      DEFAULT_OPERATIONAL_SETTINGS.formAccessSessionHours,
      1,
      24,
    ),
    specialistAvailabilityDefaultGridDays,
    specialistAvailabilityMaxGridDays,
  };
}

function defaultOperationalSettings() {
  return {
    ...DEFAULT_OPERATIONAL_SETTINGS,
    schedulingEngineType: defaultEngineTypeFromEnvironment(),
    schedulingAssignmentMode: defaultAssignmentModeFromEnvironment(),
    defaultIntakeSource: defaultIntakeSourceFromEnvironment(),
  } satisfies OperationalSettings;
}

const OPERATIONAL_SETTINGS_CACHE_TTL_MS = 15_000;
let operationalSettingsCache:
  | {
      value: OperationalSettings;
      expiresAt: number;
    }
  | null = null;
let operationalSettingsPromise: Promise<OperationalSettings> | null = null;

function setOperationalSettingsCache(value: OperationalSettings) {
  operationalSettingsCache = {
    value,
    expiresAt: Date.now() + OPERATIONAL_SETTINGS_CACHE_TTL_MS,
  };
}

export function clearOperationalSettingsCache() {
  operationalSettingsCache = null;
  operationalSettingsPromise = null;
}

async function loadOperationalSettingsFromDb() {
  const defaults = defaultOperationalSettings();
  const setting = await db.systemSetting.upsert({
    where: {
      key: OPERATIONAL_SETTINGS_KEY,
    },
    update: {},
    create: {
      key: OPERATIONAL_SETTINGS_KEY,
      value: defaults,
    },
    select: {
      value: true,
    },
  });

  return normalizeOperationalSettings(setting.value);
}

export async function getOperationalSettings(options?: { forceRefresh?: boolean }) {
  if (!options?.forceRefresh && operationalSettingsCache && operationalSettingsCache.expiresAt > Date.now()) {
    return operationalSettingsCache.value;
  }

  if (!options?.forceRefresh && operationalSettingsPromise) {
    return operationalSettingsPromise;
  }

  operationalSettingsPromise = loadOperationalSettingsFromDb().then((settings) => {
    setOperationalSettingsCache(settings);
    return settings;
  });

  try {
    return await operationalSettingsPromise;
  } finally {
    operationalSettingsPromise = null;
  }
}

export async function updateOperationalSettings(
  input: OperationalSettings,
  actorUserId: string,
) {
  const normalized = normalizeOperationalSettings(input);
  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: {
        key: OPERATIONAL_SETTINGS_KEY,
      },
      update: {
        value: normalized,
      },
      create: {
        key: OPERATIONAL_SETTINGS_KEY,
        value: normalized,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "OPERATIONAL_SETTINGS_UPDATED",
        details: {
          key: OPERATIONAL_SETTINGS_KEY,
        },
      },
    });
  });
  setOperationalSettingsCache(normalized);
}
