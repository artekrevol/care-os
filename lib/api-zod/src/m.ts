import { z } from "zod";

export const MRequestOtpBody = z.object({ phone: z.string().min(7) });
export const MRequestOtpResponse = z.object({
  ok: z.boolean(),
  devCode: z.string().optional(),
  expiresInSeconds: z.number(),
});

export const MVerifyOtpBody = z.object({
  phone: z.string().min(7),
  code: z.string().min(4),
  deviceLabel: z.string().optional(),
});
export const MVerifyOtpResponse = z.object({
  sessionToken: z.string(),
  expiresAt: z.string(),
  caregiverId: z.string(),
  hasPin: z.boolean(),
});

export const MSetPinBody = z.object({
  pin: z.string().min(4).max(8),
});

export const MLoginPinBody = z.object({
  phone: z.string().min(7),
  pin: z.string().min(4).max(8),
  deviceLabel: z.string().optional(),
});

export const MSession = z.object({
  sessionToken: z.string(),
  expiresAt: z.string(),
  caregiverId: z.string(),
});

export const MMe = z.object({
  caregiverId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  hasPin: z.boolean(),
  hasWebAuthn: z.boolean(),
  agencyId: z.string(),
});

export const MWebauthnRegisterBody = z.object({
  credentialId: z.string(),
  publicKey: z.string(),
  deviceLabel: z.string().optional(),
});
export const MWebauthnLoginBody = z.object({
  phone: z.string().min(7),
  credentialId: z.string(),
  signature: z.string(),
  deviceLabel: z.string().optional(),
});

export const MClockInBody = z.object({
  scheduleId: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
});

export const MClockOutBody = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
  caregiverNotes: z.string().optional(),
});

export const MChecklistTask = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean(),
  notes: z.string().optional(),
  photoUrl: z.string().optional(),
  completedAt: z.string().optional(),
});

export const MSaveChecklistBody = z.object({
  tasks: z.array(MChecklistTask),
  completed: z.boolean().optional(),
});

export const MCreateNoteBody = z.object({
  body: z.string().optional(),
  voiceClipBase64: z.string().optional(),
  voiceClipMime: z.string().optional(),
  autoTranscribe: z.boolean().optional(),
});

export const MIncidentSeverity = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const MCreateIncidentBody = z.object({
  severity: MIncidentSeverity,
  category: z.string(),
  description: z.string(),
  photoBase64s: z.array(z.string()).optional(),
});

export const MCreateSignatureBody = z.object({
  signerRole: z.string(),
  signerName: z.string(),
  signatureSvg: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  declined: z.boolean().optional(),
  declinedReason: z.string().optional(),
});

export const MTranscribeBody = z.object({
  audioBase64: z.string(),
  mime: z.string().optional(),
});
