import { serviceLogger } from "./logger";

type EnvSpec = {
  module: string;
  unlocks: string;
  required: string[];
  optional?: string[];
  /**
   * Alternative groups of variables that can satisfy the module. If any group
   * is fully present, the module is considered configured. Falls back to
   * `required` when omitted.
   */
  anyOfGroups?: string[][];
};

const SPECS: EnvSpec[] = [
  {
    module: "queue",
    unlocks: "Background jobs (BullMQ + Upstash Redis), BullBoard at /admin/jobs",
    required: ["UPSTASH_REDIS_URL"],
  },
  {
    module: "ai",
    unlocks: "Claude / Anthropic agent runs (intake, care plan, anomaly, etc.)",
    required: ["ANTHROPIC_API_KEY"],
    anyOfGroups: [
      ["ANTHROPIC_API_KEY"],
      ["AI_INTEGRATIONS_ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
    ],
  },
  {
    module: "ocr",
    unlocks: "AWS Textract document OCR (caregiver docs, referral PDFs)",
    required: ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  },
  {
    module: "realtime",
    unlocks: "Pusher Channels (live visits, dashboard, family portal)",
    required: ["PUSHER_APP_ID", "PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"],
  },
  {
    module: "storage",
    unlocks: "Replit Object Storage (signatures, photos, voice notes, AI artifacts)",
    required: ["REPLIT_OBJECT_STORE_BUCKET_ID"],
  },
  {
    module: "notifications.email",
    unlocks: "Outbound email via Resend",
    required: ["RESEND_API_KEY"],
    optional: ["RESEND_FROM_EMAIL"],
  },
  {
    module: "notifications.sms",
    unlocks: "Outbound SMS via Twilio",
    required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
  },
  {
    module: "notifications.push",
    unlocks: "Web Push notifications (PWA)",
    required: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    optional: ["VAPID_SUBJECT"],
  },
  {
    module: "maps",
    unlocks: "Google Distance Matrix (drive-time / scheduling)",
    required: ["GOOGLE_MAPS_API_KEY"],
  },
];

function groupSatisfied(group: string[]): boolean {
  return group.every((k) => Boolean(process.env[k]));
}

function specSatisfied(spec: EnvSpec): boolean {
  if (spec.anyOfGroups && spec.anyOfGroups.length > 0) {
    return spec.anyOfGroups.some(groupSatisfied);
  }
  return groupSatisfied(spec.required);
}

export function isModuleConfigured(module: string): boolean {
  const spec = SPECS.find((s) => s.module === module);
  if (!spec) return false;
  return specSatisfied(spec);
}

export function logServiceStartupReport(): void {
  for (const spec of SPECS) {
    const ok = specSatisfied(spec);
    const missing = spec.required.filter((k) => !process.env[k]);
    if (ok) {
      serviceLogger.info(
        { module: spec.module },
        `service module ready: ${spec.module}`,
      );
    } else {
      serviceLogger.warn(
        { module: spec.module, missing, unlocks: spec.unlocks },
        `service module disabled (dev fallback active): ${spec.module} — set ${missing.join(", ")} to enable`,
      );
    }
  }
}
