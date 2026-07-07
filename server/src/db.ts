import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });

export const db = new Database(config.sqlitePath);
db.pragma("journal_mode = WAL");
