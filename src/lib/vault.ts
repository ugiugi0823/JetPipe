import type { Credential, SavedSession } from "../types";
import { keychainDelete, keychainGet, keychainSet } from "./api";

const KEY = "jetpipe.sessions.v2";

// What we actually persist to localStorage — secrets are stripped out.
// Real password/passphrase live in the OS keychain (Apple Keychain /
// Windows Credential Manager) and are only fetched at connect time.
interface StoredSession {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  credential:
    | { kind: "password" }
    | { kind: "key"; privateKeyPath: string; hasPassphrase: boolean };
  compression?: boolean;
}

function toStored(s: SavedSession): StoredSession {
  const base = {
    id: s.id,
    label: s.label,
    host: s.host,
    port: s.port,
    username: s.username,
    compression: !!s.compression,
  };
  if (s.credential.kind === "password") {
    return { ...base, credential: { kind: "password" } };
  }
  return {
    ...base,
    credential: {
      kind: "key",
      privateKeyPath: s.credential.privateKeyPath,
      hasPassphrase: !!s.credential.passphrase,
    },
  };
}

function fromStored(s: StoredSession): SavedSession {
  // Returns a session with placeholder credentials; secrets are filled in
  // on demand via `resolveCredentials`.
  const base = {
    id: s.id,
    label: s.label,
    host: s.host,
    port: s.port,
    username: s.username,
    compression: !!s.compression,
  };
  if (s.credential.kind === "password") {
    return { ...base, credential: { kind: "password", password: "" } };
  }
  return {
    ...base,
    credential: {
      kind: "key",
      privateKeyPath: s.credential.privateKeyPath,
      passphrase: s.credential.hasPassphrase ? "" : undefined,
    },
  };
}

function readStored(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredSession[];
  } catch {
    return [];
  }
}

function writeStored(items: StoredSession[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function loadVault(): SavedSession[] {
  return readStored().map(fromStored);
}

const acct = {
  password: (id: string) => `${id}:password`,
  passphrase: (id: string) => `${id}:passphrase`,
};

export async function upsertSession(s: SavedSession): Promise<SavedSession[]> {
  if (s.credential.kind === "password") {
    if (s.credential.password) {
      await keychainSet(acct.password(s.id), s.credential.password);
    }
    await keychainDelete(acct.passphrase(s.id)).catch(() => {});
  } else {
    await keychainDelete(acct.password(s.id)).catch(() => {});
    if (s.credential.passphrase) {
      await keychainSet(acct.passphrase(s.id), s.credential.passphrase);
    } else {
      await keychainDelete(acct.passphrase(s.id)).catch(() => {});
    }
  }

  const items = readStored();
  const stored = toStored(s);
  const idx = items.findIndex((x) => x.id === s.id);
  if (idx >= 0) items[idx] = stored;
  else items.push(stored);
  writeStored(items);
  return items.map(fromStored);
}

export async function deleteSession(id: string): Promise<SavedSession[]> {
  await keychainDelete(acct.password(id)).catch(() => {});
  await keychainDelete(acct.passphrase(id)).catch(() => {});
  const remaining = readStored().filter((x) => x.id !== id);
  writeStored(remaining);
  return remaining.map(fromStored);
}

export async function resolveCredentials(s: SavedSession): Promise<Credential> {
  if (s.credential.kind === "password") {
    const pw = await keychainGet(acct.password(s.id));
    return { kind: "password", password: pw ?? "" };
  }
  const pp = await keychainGet(acct.passphrase(s.id));
  return {
    kind: "key",
    privateKeyPath: s.credential.privateKeyPath,
    passphrase: pp ?? undefined,
  };
}
