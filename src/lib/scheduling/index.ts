import type { SchedulingPersistence, SchedulingProvider } from "@/lib/scheduling/types";
import { CalcomSchedulingProvider } from "@/lib/scheduling/calcom-provider";
import { FakeSchedulingProvider } from "@/lib/scheduling/fake-provider";

const DEFAULT_PROVIDER = "fake";

function resolveProviderName() {
  return (process.env.SCHEDULING_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
}

export function createSchedulingProvider(persistence: SchedulingPersistence): SchedulingProvider {
  const providerName = resolveProviderName();

  if (providerName === "fake") {
    return new FakeSchedulingProvider(persistence);
  }

  if (providerName === "calcom") {
    return new CalcomSchedulingProvider(persistence);
  }

  throw new Error(
    `Unsupported scheduling provider: ${providerName}. Use SCHEDULING_PROVIDER=fake|calcom.`,
  );
}
