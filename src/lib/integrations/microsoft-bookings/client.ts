import { getMicrosoftGraphAccessToken } from "@/lib/integrations/microsoft-graph/auth";

type GraphDateTime = {
  dateTime: string;
  timeZone: string;
};

type GraphAvailabilityItem = {
  status?: string;
  startDateTime?: GraphDateTime | string;
  endDateTime?: GraphDateTime | string;
};

type GraphStaffAvailability = {
  staffId?: string;
  availabilityItems?: GraphAvailabilityItem[];
};

type GraphListResponse<T> = {
  value?: T[];
};

type GraphBookingsCustomer = {
  customerEmailAddress?: string;
  emailAddress?: string;
  name?: string;
  timeZone?: string;
};

type GraphBookingAppointment = {
  id?: string;
  serviceId?: string;
  staffMemberIds?: string[];
  startDateTime?: GraphDateTime | string;
  endDateTime?: GraphDateTime | string;
  isCancelled?: boolean;
  isCanceled?: boolean;
  additionalInformation?: string;
  customers?: GraphBookingsCustomer[];
};

export type MicrosoftBookingsAvailabilityItem = {
  status: string;
  startTime: Date;
  endTime: Date;
};

export type MicrosoftBookingsStaffAvailability = {
  staffId: string;
  items: MicrosoftBookingsAvailabilityItem[];
};

export type MicrosoftBookingsCustomerInput = {
  email: string;
  name: string;
  timeZone?: string;
};

export type MicrosoftBookingsCreateAppointmentInput = {
  businessId: string;
  serviceId: string;
  staffMemberIds: string[];
  startTime: Date;
  endTime: Date;
  customerTimeZone: string;
  customers: MicrosoftBookingsCustomerInput[];
  additionalInformation?: string;
};

export type MicrosoftBookingsAppointment = {
  id: string;
  serviceId: string | null;
  staffMemberIds: string[];
  startTime: Date;
  endTime: Date;
  isCancelled: boolean;
  additionalInformation: string | null;
  customers: Array<{
    email: string;
    name: string;
  }>;
};

export type MicrosoftBookingsListAppointmentsInput = {
  businessId: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
};

const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

function getGraphBaseUrl() {
  const configured = String(process.env.MICROSOFT_GRAPH_BASE_URL || "").trim();
  if (!configured) {
    return DEFAULT_GRAPH_BASE_URL;
  }

  return configured.replace(/\/$/, "");
}

function asDate(value: unknown) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    value &&
    typeof value === "object" &&
    "dateTime" in value &&
    typeof (value as { dateTime?: unknown }).dateTime === "string"
  ) {
    const parsed = new Date((value as { dateTime: string }).dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function toGraphDateTime(value: Date, timeZone: string): GraphDateTime {
  return {
    dateTime: value.toISOString(),
    timeZone,
  };
}

function parseGraphErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const errorObject = (payload as { error?: unknown }).error;
  if (!errorObject || typeof errorObject !== "object") {
    return null;
  }

  const message = (errorObject as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }

  return null;
}

function requireBusinessId(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Microsoft Bookings business id is required.");
  }
  return normalized;
}

function normalizeStatus(value: string | undefined) {
  return (value || "").trim().toLowerCase();
}

function mapAppointment(value: GraphBookingAppointment): MicrosoftBookingsAppointment {
  const id = String(value.id || "").trim();
  const startTime = asDate(value.startDateTime);
  const endTime = asDate(value.endDateTime);

  if (!id || !startTime || !endTime) {
    throw new Error("Microsoft Bookings appointment payload is missing required fields.");
  }

  return {
    id,
    serviceId: typeof value.serviceId === "string" ? value.serviceId : null,
    staffMemberIds: Array.isArray(value.staffMemberIds)
      ? value.staffMemberIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    startTime,
    endTime,
    isCancelled: Boolean(value.isCancelled ?? value.isCanceled),
    additionalInformation:
      typeof value.additionalInformation === "string" ? value.additionalInformation : null,
    customers: Array.isArray(value.customers)
      ? value.customers
          .map((customer) => {
            const email =
              typeof customer.customerEmailAddress === "string"
                ? customer.customerEmailAddress
                : typeof customer.emailAddress === "string"
                  ? customer.emailAddress
                  : "";
            const name = typeof customer.name === "string" ? customer.name : "";

            if (!email.trim()) {
              return null;
            }

            return {
              email: email.trim(),
              name,
            };
          })
          .filter((entry): entry is { email: string; name: string } => Boolean(entry))
      : [],
  };
}

export class MicrosoftBookingsClient {
  private readonly baseUrl = getGraphBaseUrl();

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await getMicrosoftGraphAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    if (response.status === 204) {
      return {} as T;
    }

    const textPayload = await response.text();
    let jsonPayload: unknown = {};
    if (textPayload) {
      try {
        jsonPayload = JSON.parse(textPayload) as unknown;
      } catch {
        jsonPayload = {};
      }
    }

    if (!response.ok) {
      const providerMessage = parseGraphErrorMessage(jsonPayload);
      const fallbackMessage = textPayload || response.statusText || "Unknown error";
      throw new Error(
        `Microsoft Graph request failed (${response.status}) at ${path}: ${providerMessage || fallbackMessage}`,
      );
    }

    return jsonPayload as T;
  }

  async getStaffAvailability(input: {
    businessId: string;
    staffIds: string[];
    startTime: Date;
    endTime: Date;
    timeZone: string;
  }): Promise<MicrosoftBookingsStaffAvailability[]> {
    const businessId = requireBusinessId(input.businessId);
    const staffIds = input.staffIds.map((value) => value.trim()).filter(Boolean);
    if (staffIds.length === 0) {
      return [];
    }

    const payload = await this.request<GraphListResponse<GraphStaffAvailability>>(
      `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/getStaffAvailability`,
      {
        method: "POST",
        body: JSON.stringify({
          staffIds,
          startDateTime: toGraphDateTime(input.startTime, input.timeZone),
          endDateTime: toGraphDateTime(input.endTime, input.timeZone),
        }),
      },
    );

    const items = Array.isArray(payload.value) ? payload.value : [];
    return items.map((entry) => ({
      staffId: String(entry.staffId || "").trim(),
      items: Array.isArray(entry.availabilityItems)
        ? entry.availabilityItems
            .map((item) => {
              const startTime = asDate(item.startDateTime);
              const endTime = asDate(item.endDateTime);
              if (!startTime || !endTime) {
                return null;
              }

              return {
                status: normalizeStatus(item.status),
                startTime,
                endTime,
              } satisfies MicrosoftBookingsAvailabilityItem;
            })
            .filter((entry): entry is MicrosoftBookingsAvailabilityItem => Boolean(entry))
        : [],
    }));
  }

  async createAppointment(
    input: MicrosoftBookingsCreateAppointmentInput,
  ): Promise<MicrosoftBookingsAppointment> {
    const businessId = requireBusinessId(input.businessId);

    const payload = await this.request<GraphBookingAppointment>(
      `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/appointments`,
      {
        method: "POST",
        body: JSON.stringify({
          serviceId: input.serviceId,
          staffMemberIds: input.staffMemberIds,
          startDateTime: toGraphDateTime(input.startTime, input.customerTimeZone),
          endDateTime: toGraphDateTime(input.endTime, input.customerTimeZone),
          customerTimeZone: input.customerTimeZone,
          customers: input.customers.map((customer) => ({
            customerEmailAddress: customer.email,
            name: customer.name,
            timeZone: customer.timeZone || input.customerTimeZone,
          })),
          additionalInformation: input.additionalInformation,
        }),
      },
    );

    return mapAppointment(payload);
  }

  async cancelAppointment(input: {
    businessId: string;
    appointmentId: string;
    reason?: string;
  }) {
    const businessId = requireBusinessId(input.businessId);
    const appointmentId = String(input.appointmentId || "").trim();
    if (!appointmentId) {
      throw new Error("Microsoft Bookings appointment id is required.");
    }

    await this.request(
      `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/appointments/${encodeURIComponent(appointmentId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({
          cancellationMessage:
            input.reason?.trim() || "Cancelled by counselling operations platform",
        }),
      },
    );
  }

  async listAppointments(
    input: MicrosoftBookingsListAppointmentsInput,
  ): Promise<MicrosoftBookingsAppointment[]> {
    const businessId = requireBusinessId(input.businessId);
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.round(input.limit!))) : 200;

    const query = new URLSearchParams();
    query.set("$top", String(limit));

    const filters: string[] = [];
    if (input.startTime) {
      filters.push(`startDateTime/dateTime ge '${input.startTime.toISOString()}'`);
    }
    if (input.endTime) {
      filters.push(`endDateTime/dateTime le '${input.endTime.toISOString()}'`);
    }
    if (filters.length > 0) {
      query.set("$filter", filters.join(" and "));
    }

    const payload = await this.request<GraphListResponse<GraphBookingAppointment>>(
      `/solutions/bookingBusinesses/${encodeURIComponent(businessId)}/appointments?${query.toString()}`,
      {
        method: "GET",
      },
    );

    const appointments = Array.isArray(payload.value) ? payload.value : [];
    return appointments.map(mapAppointment);
  }
}
