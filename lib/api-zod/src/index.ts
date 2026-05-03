export * from "./generated/api";
// Note: ./generated/types/* contains plain TS interfaces with the same names
// as the runtime zod schemas already re-exported above (e.g. ClockInBody).
// Re-exporting both via wildcard causes TS2308 collisions, so consumers that
// need a TS type can derive it from the schema (`z.infer<typeof X>`) or
// import directly from "./generated/types/<name>".
