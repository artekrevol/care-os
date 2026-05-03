import Dexie, { type Table } from "dexie";

export type OutboxKind =
  | "clock-in"
  | "clock-out"
  | "checklist"
  | "note"
  | "incident"
  | "signature";

export type OutboxItem = {
  id: string;
  kind: OutboxKind;
  path: string;
  method: "POST" | "PUT";
  body: unknown;
  occurredAt: string;
  visitId?: string;
  /** Client-generated tempId (e.g. "local_..."), present when this mutation
   * targets a visit that hasn't been synced to the server yet. The flusher
   * will rewrite path/body to use the real visit ID once clock-in succeeds. */
  localVisitId?: string;
  scheduleId?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
};

export type CachedSchedule = {
  key: "current";
  data: unknown;
  fetchedAt: number;
};

export type CachedVisit = {
  visitId: string;
  data: unknown;
  fetchedAt: number;
};

/** Maps client tempIds (local_xxx) to real server visit IDs after sync. */
export type VisitIdMap = {
  localId: string;
  realId: string;
  syncedAt: number;
};

class CareOsCaregiverDb extends Dexie {
  outbox!: Table<OutboxItem, string>;
  schedule!: Table<CachedSchedule, string>;
  visits!: Table<CachedVisit, string>;
  idMap!: Table<VisitIdMap, string>;

  constructor() {
    super("careos.caregiver");
    this.version(1).stores({
      outbox: "id,kind,visitId,createdAt",
      schedule: "key",
      visits: "visitId",
    });
    this.version(2).stores({
      outbox: "id,kind,visitId,localVisitId,createdAt",
      schedule: "key",
      visits: "visitId",
      idMap: "localId,realId",
    });
  }
}

export const db = new CareOsCaregiverDb();
