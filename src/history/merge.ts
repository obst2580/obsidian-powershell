import type { AgentHistoryEntry, HistoryProvider } from "./types.ts";

export interface OpenSessionRef {
  readonly provider: HistoryProvider;
  readonly id: string;
}

export interface MergedHistoryEntry extends AgentHistoryEntry {
  /** Set when a console tab already holds this session. */
  readonly open: boolean;
}

/** Newest first, with entries that match an open tab flagged rather than hidden. */
export function mergeHistory(
  lists: ReadonlyArray<readonly AgentHistoryEntry[]>,
  openSessions: readonly OpenSessionRef[]
): readonly MergedHistoryEntry[] {
  const openKeys = new Set(openSessions.map((ref) => historyKey(ref.provider, ref.id)));
  const seen = new Set<string>();
  const merged: MergedHistoryEntry[] = [];
  for (const list of lists) {
    for (const entry of list) {
      const key = historyKey(entry.provider, entry.id);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ ...entry, open: openKeys.has(key) });
    }
  }
  return [...merged].sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

export function historyKey(provider: HistoryProvider, id: string): string {
  return `${provider}:${id}`;
}

/** Case-insensitive substring match on title, for the panel's search box. */
export function filterHistory(
  entries: readonly MergedHistoryEntry[],
  query: string,
  providers: ReadonlySet<HistoryProvider> | null
): readonly MergedHistoryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (providers && !providers.has(entry.provider)) {
      return false;
    }
    return !needle || entry.title.toLocaleLowerCase().includes(needle);
  });
}
