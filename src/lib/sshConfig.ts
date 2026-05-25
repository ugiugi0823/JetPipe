import { homeDir } from "@tauri-apps/api/path";
import type { SavedSession } from "../types";

export interface ParsedHost {
  /** First alias becomes the session label; we collapse multi-pattern Host lines. */
  alias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile?: string;
  /** Raw options for advanced UI (display only). */
  raw: Record<string, string>;
}

/**
 * Parse an OpenSSH client config block. Supports:
 *  - `Host` blocks with one or more patterns (wildcards are filtered out)
 *  - `Key Value` and `Key=Value` lines
 *  - `#` comments, blank lines
 *  - Case-insensitive keys (canonicalized to lowercase)
 *
 * Returns one entry per concrete (non-wildcard) host alias.
 */
export function parseSshConfig(text: string): ParsedHost[] {
  type Block = { aliases: string[]; opts: Record<string, string> };
  const blocks: Block[] = [];
  let current: Block | null = null;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const stripped = raw.replace(/#.*$/, "").trim();
    if (!stripped) continue;

    const eqIdx = stripped.indexOf("=");
    const spIdx = stripped.search(/\s/);
    let key: string;
    let value: string;
    if (eqIdx > 0 && (spIdx < 0 || eqIdx < spIdx)) {
      key = stripped.slice(0, eqIdx).trim();
      value = stripped.slice(eqIdx + 1).trim();
    } else if (spIdx > 0) {
      key = stripped.slice(0, spIdx).trim();
      value = stripped.slice(spIdx + 1).trim();
    } else {
      continue;
    }

    // Strip surrounding quotes on value
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

    const k = key.toLowerCase();

    if (k === "host") {
      if (current) blocks.push(current);
      const aliases = value
        .split(/\s+/)
        .map((a) => a.trim())
        .filter((a) => a && !a.includes("*") && !a.includes("?") && !a.startsWith("!"));
      current = { aliases, opts: {} };
    } else if (k === "match") {
      // Match blocks aren't full Host blocks; commit current and skip until next Host.
      if (current) blocks.push(current);
      current = null;
    } else if (current) {
      current.opts[k] = value;
    }
  }
  if (current) blocks.push(current);

  const hosts: ParsedHost[] = [];
  for (const b of blocks) {
    for (const alias of b.aliases) {
      const opts = b.opts;
      hosts.push({
        alias,
        hostName: opts.hostname ?? alias,
        user: opts.user ?? "",
        port: opts.port ? Number(opts.port) || 22 : 22,
        identityFile: opts.identityfile,
        raw: opts,
      });
    }
  }
  return hosts;
}

let cachedHome: string | null = null;
export async function expandHome(p: string): Promise<string> {
  if (!p) return p;
  if (!p.startsWith("~")) return p;
  if (!cachedHome) cachedHome = (await homeDir()).replace(/\/$/, "");
  // ~/foo  → $HOME/foo   |   ~user/foo → leave (rare; we don't resolve other users)
  if (p.length === 1 || p[1] === "/") return cachedHome + p.slice(1);
  return p;
}

export async function toSavedSession(h: ParsedHost): Promise<SavedSession> {
  const credential: SavedSession["credential"] = h.identityFile
    ? {
        kind: "key",
        privateKeyPath: await expandHome(h.identityFile),
      }
    : { kind: "password", password: "" };

  return {
    id: crypto.randomUUID(),
    label: h.alias,
    host: h.hostName,
    port: h.port,
    username: h.user,
    credential,
  };
}
