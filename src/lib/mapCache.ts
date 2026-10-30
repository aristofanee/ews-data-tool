// Cache map responses with a bounded die budget. Other plots have their own
// byte-estimate budget so they cannot evict the map galleries. Failed requests are
// retriable, concurrent identical queries share a promise, and dataset/label
// changes invalidate both results and pending responses.
let generation = 0;
const results = new Map<string, { value: unknown; weight: number }>();
const pending = new Map<string, Promise<unknown>>();
let weight = 0;
const MAX_DICE = 600_000;
const plots = new Map<string, { value: unknown; bytes: number }>();
let plotBytes = 0;
const MAX_PLOT_BYTES = 48 * 1024 * 1024;

export function mapGeneration() { return generation; }
export function invalidateMaps() {
  generation++;
  results.clear(); pending.clear(); weight = 0;
  plots.clear(); plotBytes = 0;
}

function queryKey(kind: string, req: unknown) {
  return JSON.stringify([generation, kind, req], (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value);
}

export function cachedPlot<T>(kind: string, req: unknown, load: () => Promise<T>, size: (value: T) => number): Promise<T> {
  const key = queryKey(`plot:${kind}`, req);
  const cached = plots.get(key);
  if (cached) { plots.delete(key); plots.set(key, cached); return Promise.resolve(cached.value as T); }
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const current = generation;
  const promise = load().then((value) => {
    const bytes = Math.max(1024, size(value));
    if (generation === current && bytes <= MAX_PLOT_BYTES) {
      while (plotBytes + bytes > MAX_PLOT_BYTES && plots.size) {
        const oldest = plots.keys().next().value!;
        plotBytes -= plots.get(oldest)!.bytes; plots.delete(oldest);
      }
      plots.set(key, { value, bytes }); plotBytes += bytes;
    }
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function cachedMap<T>(kind: string, req: unknown, load: () => Promise<T>, size: (value: T) => number): Promise<T> {
  const key = queryKey(kind, req);
  const cached = results.get(key);
  if (cached) {
    results.delete(key); results.set(key, cached);
    return Promise.resolve(cached.value as T);
  }
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const current = generation;
  const promise = load().then((value) => {
    const n = size(value);
    if (current === generation && n <= MAX_DICE) {
      while (weight + n > MAX_DICE && results.size) {
        const oldest = results.keys().next().value!;
        weight -= results.get(oldest)!.weight; results.delete(oldest);
      }
      results.set(key, { value, weight: n }); weight += n;
    }
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

const selections = new Map<string, { key: string; index: number | null }>();
export function rememberedMap(kind: string, key: string): number | null {
  if (selections.get(kind)?.key !== key) selections.set(kind, { key, index: null });
  return selections.get(kind)!.index;
}
export function rememberMap(kind: string, key: string, index: number | null) {
  selections.set(kind, { key, index });
}
