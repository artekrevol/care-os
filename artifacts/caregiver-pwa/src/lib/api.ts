import { loadSession, clearSession } from "./session";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const session = loadSession();
  if (session) headers.set("Authorization", `Bearer ${session.sessionToken}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    if (res.status === 401) clearSession();
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export type Me = {
  caregiverId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  hasPin: boolean;
  hasWebAuthn: boolean;
  agencyId: string;
};

export type ScheduleEntry = {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  visitType: string | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    carePreferences?: string | null;
    allergies?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  } | null;
  carePlanTitle?: string | null;
  carePlanTasks?: Array<{ id: string; label: string }>;
  visitId?: string | null;
};

export type ScheduleDay = {
  date: string;
  entries: ScheduleEntry[];
};

export type ScheduleResponse = {
  today: ScheduleDay;
  upcoming: ScheduleDay[];
  nextEntry: ScheduleEntry | null;
};

export type ChecklistTask = {
  id: string;
  label: string;
  done: boolean;
  notes?: string;
  photoUrl?: string;
  completedAt?: string;
};

export type VisitDetail = {
  id: string;
  scheduleId: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  durationMinutes: number | null;
  verificationStatus: string;
  geoFenceMatch: boolean | null;
  hasIncident: boolean;
  client: ScheduleEntry["client"] & {
    carePreferences?: string | null;
    allergies?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  } | null;
  carePlan: {
    id: string;
    version: number;
    title: string | null;
    tasks: unknown;
    goals: unknown;
    riskFactors: unknown;
  } | null;
  checklist: {
    id: string;
    tasks: ChecklistTask[];
    completedAt: string | null;
  } | null;
  notes: Array<{
    id: string;
    authorRole: string;
    body: string;
    voiceClipUrl: string | null;
    createdAt: string;
  }>;
  incidents: Array<{
    id: string;
    severity: string;
    category: string;
    description: string;
    photoUrls: string[];
    createdAt: string;
  }>;
  signature: {
    id: string;
    signerRole: string;
    signerName: string;
    signatureSvg: string | null;
    declined: boolean;
    declinedReason: string | null;
    capturedAt: string;
  } | null;
};
