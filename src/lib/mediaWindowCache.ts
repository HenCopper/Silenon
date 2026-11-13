import { Question } from '../types/question';
import { getMediaBlob, parseIdbMediaUrl } from './mediaBlobStorage';

export interface HardwareMediaProfile {
  tier: 'low' | 'mid' | 'high';
  back: number;
  ahead: number;
  maxItems: number;
  concurrency: number;
}

export function getHardwareProfile(): HardwareMediaProfile {
  if (typeof navigator === 'undefined') {
    return { tier: 'mid', back: 2, ahead: 3, maxItems: 14, concurrency: 2 };
  }

  const deviceMemory = Number((navigator as any).deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 4);
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

  if ((deviceMemory > 0 && deviceMemory <= 2) || (isMobile && cores <= 4 && (!deviceMemory || deviceMemory <= 3))) {
    return {
      tier: 'low',
      back: 1,
      ahead: 2,
      maxItems: 8,
      concurrency: 1,
    };
  }

  if (deviceMemory >= 8 || (!isMobile && cores >= 6 && (!deviceMemory || deviceMemory >= 8))) {
    return {
      tier: 'high',
      back: 3,
      ahead: 5,
      maxItems: 24,
      concurrency: 3,
    };
  }

  if (deviceMemory > 0 && deviceMemory <= 4) {
    return {
      tier: 'mid',
      back: 2,
      ahead: 3,
      maxItems: 14,
      concurrency: 2,
    };
  }

  // Default desktop vs mobile fallback when deviceMemory is not exposed by browser
  if (!isMobile) {
    return {
      tier: 'high',
      back: 3,
      ahead: 5,
      maxItems: 24,
      concurrency: 3,
    };
  }

  return {
    tier: 'mid',
    back: 2,
    ahead: 3,
    maxItems: 14,
    concurrency: 2,
  };
}

// Active cache mapping idb-media:// URLs to live blob: ObjectURLs
const cacheMap = new Map<string, string>();
// Deduplicate concurrent loads for the same idb-media:// URL
const inFlightMap = new Map<string, Promise<string | null>>();

let currentGeneration = 0;
let pendingQueue: string[] = [];
let activeWorkers = 0;
let idleHandle: number | null = null;
let currentWindowSet = new Set<string>();

function scheduleIdleTask(cb: () => void): number {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return (window as any).requestIdleCallback(cb, { timeout: 120 });
  }
  return (typeof window !== 'undefined' ? window : globalThis).setTimeout(cb, 16) as unknown as number;
}

function cancelScheduledIdleTask(handle: number | null): void {
  if (handle === null) return;
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    (window as any).cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}

function isAudioOrVideoUrl(url: string): boolean {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  return /\.(mp3|ogg|wav|mp4|webm)$/i.test(clean);
}

function preDecodeImageUrl(objectUrl: string, originalIdbUrl: string): void {
  if (typeof Image === 'undefined' || isAudioOrVideoUrl(originalIdbUrl)) return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = objectUrl;
    img.decode?.().catch(() => {});
  } catch {
    // Ignore decode errors
  }
}

function collectQuestionIdbUrls(q: Question | undefined): string[] {
  if (!q) return [];
  const urls: string[] = [];
  const pushIfIdb = (u?: string | null) => {
    if (u && typeof u === 'string' && u.startsWith('idb-media://')) {
      urls.push(u.trim());
    }
  };

  if (Array.isArray(q.media)) {
    for (const m of q.media) {
      pushIfIdb(m?.url);
    }
  }

  if (Array.isArray(q.options)) {
    for (const opt of q.options) {
      pushIfIdb(opt?.media_url);
      if (Array.isArray(opt?.media)) {
        for (const m of opt.media) {
          pushIfIdb(m?.url);
        }
      }
    }
  }

  if (Array.isArray(q.resolution?.media)) {
    for (const m of q.resolution.media) {
      pushIfIdb(m?.url);
    }
  }

  return urls;
}

function enforceCacheLimit(maxItems: number, protectedUrls: Set<string>): void {
  // First, evict entries not in the current window if we exceed maxItems (or to keep only window + recent up to maxItems)
  for (const [idbUrl, objUrl] of cacheMap.entries()) {
    if (!protectedUrls.has(idbUrl)) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {
        // ignore
      }
      cacheMap.delete(idbUrl);
    }
  }

  // If still above maxItems, evict oldest entries in insertion order
  while (cacheMap.size > maxItems) {
    const oldestKey = cacheMap.keys().next().value;
    if (!oldestKey) break;
    const objUrl = cacheMap.get(oldestKey);
    if (objUrl) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {
        // ignore
      }
    }
    cacheMap.delete(oldestKey);
  }
}

/**
 * Returns the cached ObjectURL synchronously if available, avoiding any flicker on render.
 */
export function getCachedMediaUrlSync(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('idb-media://')) {
    return trimmed;
  }
  const hit = cacheMap.get(trimmed);
  if (hit) {
    // Refresh LRU order
    cacheMap.delete(trimmed);
    cacheMap.set(trimmed, hit);
    return hit;
  }
  return null;
}

/**
 * Loads an idb-media:// URL asynchronously on demand (or shares the in-flight request),
 * stores its ObjectURL in the central window cache, and pre-decodes images.
 */
export async function acquireMediaUrl(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('idb-media://')) {
    return trimmed;
  }

  const existing = cacheMap.get(trimmed);
  if (existing) {
    cacheMap.delete(trimmed);
    cacheMap.set(trimmed, existing);
    return existing;
  }

  const inFlight = inFlightMap.get(trimmed);
  if (inFlight) {
    return inFlight;
  }

  const parsed = parseIdbMediaUrl(trimmed);
  if (!parsed) return null;

  const loadPromise = (async () => {
    try {
      const blob = await getMediaBlob(parsed.databaseId, parsed.path);
      if (!blob) return null;

      // Re-check if another call populated cacheMap in the meantime
      const raceExisting = cacheMap.get(trimmed);
      if (raceExisting) {
        return raceExisting;
      }

      const objUrl = URL.createObjectURL(blob);
      cacheMap.set(trimmed, objUrl);
      preDecodeImageUrl(objUrl, trimmed);

      const profile = getHardwareProfile();
      if (cacheMap.size > profile.maxItems) {
        // Keep currentWindowSet + the newly acquired URL protected
        const protectedSet = new Set(currentWindowSet);
        protectedSet.add(trimmed);
        enforceCacheLimit(profile.maxItems, protectedSet);
      }

      return objUrl;
    } catch {
      return null;
    } finally {
      inFlightMap.delete(trimmed);
    }
  })();

  inFlightMap.set(trimmed, loadPromise);
  return loadPromise;
}

function pumpPreloadQueue(generation: number, concurrency: number): void {
  if (generation !== currentGeneration) return;
  if (pendingQueue.length === 0) return;

  while (activeWorkers < concurrency && pendingQueue.length > 0) {
    const nextUrl = pendingQueue.shift()!;
    if (cacheMap.has(nextUrl) || inFlightMap.has(nextUrl)) {
      continue;
    }

    activeWorkers++;
    acquireMediaUrl(nextUrl).finally(() => {
      activeWorkers = Math.max(0, activeWorkers - 1);
      if (generation === currentGeneration && pendingQueue.length > 0) {
        idleHandle = scheduleIdleTask(() => {
          idleHandle = null;
          pumpPreloadQueue(generation, concurrency);
        });
      }
    });
  }
}

/**
 * Synchronizes the asymmetric sliding window around currentIndex:
 * [currentIndex - back, currentIndex + ahead]
 * Preserves already-cached URLs in the window, revokes out-of-window URLs,
 * and schedules missing URLs in a non-blocking idle queue.
 */
export function syncWindow(questions: Question[], currentIndex: number): void {
  if (!Array.isArray(questions) || questions.length === 0) return;

  const profile = getHardwareProfile();
  const safeIndex = Math.max(0, Math.min(questions.length - 1, currentIndex));
  const minIdx = Math.max(0, safeIndex - profile.back);
  const maxIdx = Math.min(questions.length - 1, safeIndex + profile.ahead);

  // Order indices starting at safeIndex, then +1, -1, +2, -2, +3...
  const orderedIndices: number[] = [safeIndex];
  const maxRadius = Math.max(profile.back, profile.ahead);
  for (let offset = 1; offset <= maxRadius; offset++) {
    const aheadIdx = safeIndex + offset;
    if (aheadIdx <= maxIdx) {
      orderedIndices.push(aheadIdx);
    }
    const backIdx = safeIndex - offset;
    if (backIdx >= minIdx) {
      orderedIndices.push(backIdx);
    }
  }

  const windowUrls: string[] = [];
  const windowSet = new Set<string>();

  for (const idx of orderedIndices) {
    const qUrls = collectQuestionIdbUrls(questions[idx]);
    for (const u of qUrls) {
      if (!windowSet.has(u) && windowUrls.length < profile.maxItems) {
        windowSet.add(u);
        windowUrls.push(u);
      }
    }
    if (windowUrls.length >= profile.maxItems) break;
  }

  currentWindowSet = windowSet;

  // Cancel any stale pending queue from previous index without touching cached items in the new window
  currentGeneration++;
  const generation = currentGeneration;
  cancelScheduledIdleTask(idleHandle);
  idleHandle = null;

  // Evict out-of-window URLs and enforce hardware cap
  enforceCacheLimit(profile.maxItems, windowSet);

  // Queue only URLs in the window that are not yet cached
  pendingQueue = windowUrls.filter((u) => !cacheMap.has(u));

  if (pendingQueue.length > 0) {
    // Load the current question's media immediately on microtask/idle, then pump the rest on idle
    idleHandle = scheduleIdleTask(() => {
      idleHandle = null;
      pumpPreloadQueue(generation, profile.concurrency);
    });
  }
}

export function clearDatabaseWindowCache(databaseId: string): void {
  if (!databaseId) return;
  const prefix = `idb-media://${databaseId}/`;
  for (const [idbUrl, objUrl] of cacheMap.entries()) {
    if (idbUrl.startsWith(prefix)) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {
        // ignore
      }
      cacheMap.delete(idbUrl);
    }
  }
}
