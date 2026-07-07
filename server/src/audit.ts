import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

type AuditDetails = Record<string, unknown>;

export function audit(event: string, details: AuditDetails = {}): void {
  const entry = {
    time: new Date().toISOString(),
    event,
    ...details
  };

  try {
    fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
    fs.appendFileSync(config.auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("[audit] failed to write audit log", error);
  }
}
