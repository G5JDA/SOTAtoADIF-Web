// SPDX-License-Identifier: AGPL-3.0-or-later
import { validLocator } from './converter.js';

export const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'sotatoadif-summit:';

// Create a lookup with 24-hour memory/persistent caching and shared requests for concurrent callers.
// Inject the fetcher, storage and clock so cache expiry and failures can be tested without a live API.
export function createSummitLookup(fetchSummit, storage, now = Date.now) {
  const memoryCache = new Map();
  const pendingRequests = new Map();
  // Reject future-dated or malformed entries; an entry becomes stale at exactly 24 hours.
  function isFreshEntry(entry) {
    const ageMs = now() - entry?.savedAt;
    return (
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs < CACHE_TTL &&
      validLocator(entry?.data?.locator || '')
    );
  }
  // Normalize the reference, reuse fresh data, then fetch only if neither cache nor request can satisfy it.
  return async function lookup(reference) {
    const summitRef = reference.trim().toUpperCase();
    let entry = memoryCache.get(summitRef);
    // A fresh persisted entry may survive a reload even when this lookup has not seen it in memory.
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
      // Returning a copy prevents callers from modifying the saved summit data.
      return { ...entry.data };
    }
    // Concurrent callers share one request; failures are not saved as cache entries.
    if (pendingRequests.has(summitRef)) {
      return pendingRequests.get(summitRef);
    }
    // Cache only a successful, validated response; rejected requests remain retryable.
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
      // Release the shared request after success or failure so later callers can retry or use the cache.
      pendingRequests.delete(summitRef);
    }
  };
}
