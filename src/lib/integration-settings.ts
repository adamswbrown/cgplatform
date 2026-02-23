import { db } from "@/lib/db";

export const INTEGRATION_SETTINGS_KEY = "integration_settings";

export type IntegrationSettings = {
  // Microsoft Bookings connection
  microsoftBookingsBusinessId: string;
  microsoftBookingsDefaultTimeZone: string;
  microsoftBookingsAvailabilityHorizonDays: number;
  microsoftBookingsSlotIncrementMinutes: number;

  // Microsoft Bookings sync
  microsoftBookingsSyncLookbackHours: number;
  microsoftBookingsSyncLookaheadDays: number;
  microsoftBookingsSyncFetchLimit: number;

  // Resend email
  resendFromAddress: string;
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

function normalizeString(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

// --- Environment variable fallbacks (used as initial defaults) ---

function envString(key: string, fallback: string) {
  const value = process.env[key];
  return value?.trim() || fallback;
}

function envInteger(key: string, fallback: number, min: number, max: number) {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  return clampInteger(raw, fallback, min, max);
}

const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  microsoftBookingsBusinessId: "",
  microsoftBookingsDefaultTimeZone: "UTC",
  microsoftBookingsAvailabilityHorizonDays: 30,
  microsoftBookingsSlotIncrementMinutes: 15,
  microsoftBookingsSyncLookbackHours: 24,
  microsoftBookingsSyncLookaheadDays: 30,
  microsoftBookingsSyncFetchLimit: 500,
  resendFromAddress: "no-reply@localhost",
};

function defaultIntegrationSettingsFromEnvironment(): IntegrationSettings {
  return {
    microsoftBookingsBusinessId: envString(
      "MICROSOFT_BOOKINGS_BUSINESS_ID",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsBusinessId,
    ),
    microsoftBookingsDefaultTimeZone: envString(
      "MICROSOFT_BOOKINGS_DEFAULT_TIME_ZONE",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsDefaultTimeZone,
    ),
    microsoftBookingsAvailabilityHorizonDays: envInteger(
      "MICROSOFT_BOOKINGS_AVAILABILITY_HORIZON_DAYS",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsAvailabilityHorizonDays,
      1,
      120,
    ),
    microsoftBookingsSlotIncrementMinutes: envInteger(
      "MICROSOFT_BOOKINGS_SLOT_INCREMENT_MINUTES",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsSlotIncrementMinutes,
      5,
      60,
    ),
    microsoftBookingsSyncLookbackHours: envInteger(
      "MICROSOFT_BOOKINGS_SYNC_LOOKBACK_HOURS",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsSyncLookbackHours,
      1,
      168,
    ),
    microsoftBookingsSyncLookaheadDays: envInteger(
      "MICROSOFT_BOOKINGS_SYNC_LOOKAHEAD_DAYS",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsSyncLookaheadDays,
      1,
      90,
    ),
    microsoftBookingsSyncFetchLimit: envInteger(
      "MICROSOFT_BOOKINGS_SYNC_FETCH_LIMIT",
      DEFAULT_INTEGRATION_SETTINGS.microsoftBookingsSyncFetchLimit,
      50,
      2000,
    ),
    resendFromAddress: envString(
      "CONFIRMATION_EMAIL_FROM",
      DEFAULT_INTEGRATION_SETTINGS.resendFromAddress,
    ),
  };
}

function normalizeIntegrationSettings(candidate: unknown): IntegrationSettings {
  const parsed = (candidate as Partial<IntegrationSettings>) || {};
  const envDefaults = defaultIntegrationSettingsFromEnvironment();

  return {
    microsoftBookingsBusinessId: normalizeString(
      parsed.microsoftBookingsBusinessId,
      envDefaults.microsoftBookingsBusinessId,
    ),
    microsoftBookingsDefaultTimeZone: normalizeString(
      parsed.microsoftBookingsDefaultTimeZone,
      envDefaults.microsoftBookingsDefaultTimeZone,
    ),
    microsoftBookingsAvailabilityHorizonDays: clampInteger(
      parsed.microsoftBookingsAvailabilityHorizonDays,
      envDefaults.microsoftBookingsAvailabilityHorizonDays,
      1,
      120,
    ),
    microsoftBookingsSlotIncrementMinutes: clampInteger(
      parsed.microsoftBookingsSlotIncrementMinutes,
      envDefaults.microsoftBookingsSlotIncrementMinutes,
      5,
      60,
    ),
    microsoftBookingsSyncLookbackHours: clampInteger(
      parsed.microsoftBookingsSyncLookbackHours,
      envDefaults.microsoftBookingsSyncLookbackHours,
      1,
      168,
    ),
    microsoftBookingsSyncLookaheadDays: clampInteger(
      parsed.microsoftBookingsSyncLookaheadDays,
      envDefaults.microsoftBookingsSyncLookaheadDays,
      1,
      90,
    ),
    microsoftBookingsSyncFetchLimit: clampInteger(
      parsed.microsoftBookingsSyncFetchLimit,
      envDefaults.microsoftBookingsSyncFetchLimit,
      50,
      2000,
    ),
    resendFromAddress: normalizeString(
      parsed.resendFromAddress,
      envDefaults.resendFromAddress,
    ),
  };
}

// --- Cache ---

const INTEGRATION_SETTINGS_CACHE_TTL_MS = 15_000;
let integrationSettingsCache:
  | {
      value: IntegrationSettings;
      expiresAt: number;
    }
  | null = null;
let integrationSettingsPromise: Promise<IntegrationSettings> | null = null;

function setIntegrationSettingsCache(value: IntegrationSettings) {
  integrationSettingsCache = {
    value,
    expiresAt: Date.now() + INTEGRATION_SETTINGS_CACHE_TTL_MS,
  };
}

export function clearIntegrationSettingsCache() {
  integrationSettingsCache = null;
  integrationSettingsPromise = null;
}

async function loadIntegrationSettingsFromDb() {
  const defaults = defaultIntegrationSettingsFromEnvironment();
  const setting = await db.systemSetting.upsert({
    where: {
      key: INTEGRATION_SETTINGS_KEY,
    },
    update: {},
    create: {
      key: INTEGRATION_SETTINGS_KEY,
      value: defaults,
    },
    select: {
      value: true,
    },
  });

  return normalizeIntegrationSettings(setting.value);
}

export async function getIntegrationSettings(options?: { forceRefresh?: boolean }) {
  if (
    !options?.forceRefresh &&
    integrationSettingsCache &&
    integrationSettingsCache.expiresAt > Date.now()
  ) {
    return integrationSettingsCache.value;
  }

  if (!options?.forceRefresh && integrationSettingsPromise) {
    return integrationSettingsPromise;
  }

  integrationSettingsPromise = loadIntegrationSettingsFromDb().then((settings) => {
    setIntegrationSettingsCache(settings);
    return settings;
  });

  try {
    return await integrationSettingsPromise;
  } finally {
    integrationSettingsPromise = null;
  }
}

export async function updateIntegrationSettings(
  input: IntegrationSettings,
  actorUserId: string,
) {
  const normalized = normalizeIntegrationSettings(input);
  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: {
        key: INTEGRATION_SETTINGS_KEY,
      },
      update: {
        value: normalized,
      },
      create: {
        key: INTEGRATION_SETTINGS_KEY,
        value: normalized,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "INTEGRATION_SETTINGS_UPDATED",
        details: {
          key: INTEGRATION_SETTINGS_KEY,
        },
      },
    });
  });
  setIntegrationSettingsCache(normalized);
}
