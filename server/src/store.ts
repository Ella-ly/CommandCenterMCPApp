// Tiny JSON file persistence for the ADO PAT submitted via the Connect tool.
// For local-demo convenience only — PAT is stored in plaintext.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", ".secrets.json");

export interface StoredCreds {
  org: string;
  project: string;
  pat: string;
}

let cache: StoredCreds | null = null;

export function load(): void {
  try {
    if (fs.existsSync(FILE)) {
      cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
    }
  } catch {
    cache = null;
  }
}

export function get(): StoredCreds | null {
  return cache;
}

export function set(creds: StoredCreds): void {
  cache = creds;
  try {
    fs.writeFileSync(FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn("[store] could not persist .secrets.json:", e);
  }
}

export function clear(): void {
  cache = null;
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}
