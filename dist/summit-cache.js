// SPDX-License-Identifier: AGPL-3.0-or-later
import { validLocator } from './converter.js';

export const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'sotatoadif-summit:';
export function createSummitLookup(fetchSummit, storage, now = Date.now) {
  const memory = new Map();
  const pending = new Map();
  function isFreshEntry(entry) {
    const age = now() - entry?.savedAt;
    return (
      Number.isFinite(age) &&
      age >= 0 &&
      age < CACHE_TTL &&
      validLocator(entry?.data?.locator || '')
    );
  }
  return async function lookup(ref) {
    ref = ref.trim().toUpperCase();
    let entry = memory.get(ref);
    if (!isFreshEntry(entry)) {
      try {
        entry = JSON.parse(storage?.getItem(CACHE_KEY_PREFIX + ref) || 'null');
        if (!isFreshEntry(entry)) {
          storage?.removeItem(CACHE_KEY_PREFIX + ref);
        }
      } catch {
        entry = null;
      }
    }
    if (isFreshEntry(entry)) {
      memory.set(ref, entry);
      return { ...entry.data };
    }
    // Concurrent callers share one request; failures are not saved as cache entries.
    if (pending.has(ref)) {
      return pending.get(ref);
    }
    const request = (async () => {
      const data = await fetchSummit(ref);
      if (!validLocator(data?.locator || '')) {
        throw new Error('No valid locator returned');
      }
      // Keep only summit information used by the converter and its UI.
      const cached = {
        locator: data.locator.toUpperCase(),
        name: typeof data.name === 'string' ? data.name : ''
      };
      const entry = { savedAt: now(), data: cached };
      memory.set(ref, entry);
      try {
        storage?.setItem(CACHE_KEY_PREFIX + ref, JSON.stringify(entry));
      } catch {
        // Storage can be unavailable or full; the in-memory cache still works.
      }
      return { ...cached };
    })();
    pending.set(ref, request);
    try {
      return await request;
    } finally {
      pending.delete(ref);
    }
  };
}
