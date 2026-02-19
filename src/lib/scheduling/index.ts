import type { SchedulingPersistence, SchedulingProvider } from "@/lib/scheduling/types";
import { CalcomSchedulingProvider } from "@/lib/scheduling/calcom-provider";
import { ManualSchedulingProvider } from "@/lib/scheduling/manual-provider";
import { MicrosoftBookingsSchedulingProvider } from "@/lib/scheduling/microsoft-bookings-provider";
import { getSchedulingEngineType, type SchedulingEngineType } from "@/lib/scheduling/config";

const DEFAULT_ENGINE: SchedulingEngineType = "manual";

function resolveLegacyEngineFromEnvironment(): SchedulingEngineType {
  const normalized = String(
    process.env.SCHEDULING_ENGINE || process.env.SCHEDULING_PROVIDER || DEFAULT_ENGINE,
  )
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

  return DEFAULT_ENGINE;
}

function createProviderByEngine(
  persistence: SchedulingPersistence,
  engine: SchedulingEngineType,
): SchedulingProvider {
  if (engine === "manual") {
    return new ManualSchedulingProvider(persistence, { providerType: "manual" });
  }
  if (engine === "calcom") {
    return new CalcomSchedulingProvider(persistence);
  }
  if (engine === "microsoft_bookings") {
    return new MicrosoftBookingsSchedulingProvider(persistence);
  }

  throw new Error(
    `Unsupported scheduling engine: ${engine}. Use manual|calcom|microsoft_bookings.`,
  );
}

export async function createSchedulingProvider(
  persistence: SchedulingPersistence,
): Promise<SchedulingProvider> {
  try {
    const engine = await getSchedulingEngineType();
    return createProviderByEngine(persistence, engine);
  } catch {
    const fallbackEngine = resolveLegacyEngineFromEnvironment();
    return createProviderByEngine(persistence, fallbackEngine);
  }
}
