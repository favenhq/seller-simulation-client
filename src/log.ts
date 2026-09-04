export type LogFields = Readonly<Record<string, boolean | number | string | null>>;

export function log(event: string, fields: LogFields = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`
  );
}

export function safeReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160);
  }
  return "unknown_error";
}
