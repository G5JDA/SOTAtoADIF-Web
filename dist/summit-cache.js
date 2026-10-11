// SPDX-License-Identifier: AGPL-3.0-or-later
import { validLocator } from './converter.js';

export const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'sotatoadif-summit:';

export function createSummitLookup(fetchSummit, storage, now = Date.now) {
  const memoryCache = new Map();
  const pendingRequests = new Map();
  function isFreshEntry(entry) {
    const ageMs = now() - entry?.savedAt;
    return (
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs < CACHE_TTL &&
      validLocator(entry?.data?.locator || '')
    );
  }
  return async function lookup(reference) {
    const summitRef = reference.trim().toUpperCase();
    let entry = memoryCache.get(summitRef);
    if (!isFreshEntry(entry)) {
      try {
        entry = JSON.parse(storage?.getItem(CACHE_KEY_PREFIX + summitRef) || 'null');
        if (!isFreshEntry(entry)) {
          storage?.removeItem(CACHE_KEY_PREFIX + summitRef);
        }
      } catch {
        entry = null;
      }
    }
    if (isFreshEntry(entry)) {
      memoryCache.set(summitRef, entry);
      return { ...entry.data };
    }
    // Concurrent callers share one request; failures are not saved as cache entries.
    if (pendingRequests.has(summitRef)) {
      return pendingRequests.get(summitRef);
    }
    const request = (async () => {
      const data = await fetchSummit(summitRef);
      if (!validLocator(data?.locator || '')) {
        throw new Error('No valid locator returned');
      }
      // Keep only summit information used by the converter and its UI.
      const summitData = {
        locator: data.locator.toUpperCase(),
        name: typeof data.name === 'string' ? data.name : ''
      };
      const savedEntry = { savedAt: now(), data: summitData };
      memoryCache.set(summitRef, savedEntry);
      try {
        storage?.setItem(CACHE_KEY_PREFIX + summitRef, JSON.stringify(savedEntry));
      } catch {
        // Storage can be unavailable or full; the in-memory cache still works.
      }
      return { ...summitData };
    })();
    pendingRequests.set(summitRef, request);
    try {
      return await request;
    } finally {
      pendingRequests.delete(summitRef);
    }
  };
}
