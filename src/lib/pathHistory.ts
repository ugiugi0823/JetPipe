const KEY = "jetpipe.pathHistory.v1";
const MAX_PER_SESSION = 50;

type Store = Record<string, string[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Store;
    return {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

/** Append `path` to the front of the saved session's visit list (deduped). */
export function recordVisit(savedId: string, path: string): void {
  if (!savedId || !path) return;
  const store = read();
  const list = store[savedId] ?? [];
  const filtered = list.filter((p) => p !== path);
  filtered.unshift(path);
  store[savedId] = filtered.slice(0, MAX_PER_SESSION);
  write(store);
}

/** Most-recent-first list of paths for this saved session. */
export function getVisits(savedId: string): string[] {
  if (!savedId) return [];
  return read()[savedId] ?? [];
}

export function clearVisits(savedId: string): void {
  const store = read();
  delete store[savedId];
  write(store);
}
