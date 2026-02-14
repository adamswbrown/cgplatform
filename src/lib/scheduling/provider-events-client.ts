import {
  handleProviderBookingEvent,
  type ProviderBookingEvent,
  type ProviderEventResult,
} from "@/lib/scheduling/events";

function resolveInternalApiBaseUrl() {
  const configured =
    process.env.INTERNAL_API_BASE_URL || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (configured && configured.trim()) {
    return configured.replace(/\/$/, "");
  }

  const port = process.env.PORT || "3001";
  return `http://127.0.0.1:${port}`;
}

export async function sendProviderEventWebhook(
  event: ProviderBookingEvent,
): Promise<ProviderEventResult> {
  const endpoint = `${resolveInternalApiBaseUrl()}/api/provider/events`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: ProviderEventResult;
      error?: string;
    };

    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error || `Provider event webhook failed with status ${response.status}.`);
    }

    return payload.data;
  } catch (error) {
    if (error instanceof TypeError) {
      return handleProviderBookingEvent(event);
    }

    throw error;
  }
}
