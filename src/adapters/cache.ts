interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface TTLCacheOptions {
  maxSize?: number;
  sweepIntervalMs?: number;
}

export class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TTLCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 200;
    const sweepMs = options.sweepIntervalMs ?? 60_000;
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer.unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxSize) {
      this.evict();
    }
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.store.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private evict(): void {
    // Remove oldest entries (Map iteration order = insertion order)
    const toRemove = this.store.size - this.maxSize;
    let removed = 0;
    for (const key of this.store.keys()) {
      if (removed >= toRemove) break;
      this.store.delete(key);
      removed++;
    }
  }
}

export const cache = new TTLCache();
