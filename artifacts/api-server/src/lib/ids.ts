import { randomUUID } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 12)}`;
