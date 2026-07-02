type CacheEntry = { value: unknown; expiresAt: number };

const store = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function getCachedRecommendations<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCachedRecommendations(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
