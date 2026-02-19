import {
  getOperationalSettings,
  type SchedulingAssignmentMode,
  type SchedulingEngineType,
} from "@/lib/admin-settings";

export type { SchedulingAssignmentMode, SchedulingEngineType };

export async function getSchedulingEngineType(): Promise<SchedulingEngineType> {
  const settings = await getOperationalSettings();
  return settings.schedulingEngineType;
}

export async function getSchedulingAssignmentMode(): Promise<SchedulingAssignmentMode> {
  const settings = await getOperationalSettings();
  return settings.schedulingAssignmentMode;
}

export async function isAutoAllocationEnabled() {
  return (await getSchedulingAssignmentMode()) === "auto";
}
