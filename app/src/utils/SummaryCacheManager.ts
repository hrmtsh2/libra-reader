import { ChunkSummary, BookSummaryCache } from '../types';

// cache summaries for quicker retrieval and offline use
class SummaryCacheManager {
  private static readonly CACHE_KEY_PREFIX = 'libra_summary_cache_';
  private static readonly MAX_CACHE_AGE_DAYS = 30;
  // get cache key for specified book
  private static getCacheKey(bookId: string): string {
    return `${this.CACHE_KEY_PREFIX}${bookId}`;
  }
  // load summayr cache for a book from localStorage
  static loadSummaryCache(bookId: string): BookSummaryCache | null {
    try {
      const cacheKey = this.getCacheKey(bookId);
      const cacheData = localStorage.getItem(cacheKey);
      
      if (!cacheData) {
        return null;
      }

      const parsed = JSON.parse(cacheData);
      // check if cache too aged
      const lastUpdated = new Date(parsed.lastUpdated);
      const now = new Date();
      const daysDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > this.MAX_CACHE_AGE_DAYS) {
        this.clearSummaryCache(bookId);
        return null;
      }
      // convert summaries array back into Map
      const chunkSummaries = new Map<string, ChunkSummary>();
      if (parsed.chunkSummaries) {
        for (const [key, value] of parsed.chunkSummaries) {
          chunkSummaries.set(key, {
            ...value,
            createdAt: new Date(value.createdAt)
          });
        }
      }

      return {
        bookId: parsed.bookId,
        chunkSummaries,
        lastUpdated
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
  // save summary cache to localSTorage
  static saveSummaryCache(cache: BookSummaryCache): void {
    try {
      const cacheKey = this.getCacheKey(cache.bookId);
      // convert Map to array for serialisation
      const serializable = {
        bookId: cache.bookId,
        chunkSummaries: Array.from(cache.chunkSummaries.entries()),
        lastUpdated: cache.lastUpdated
      };

      localStorage.setItem(cacheKey, JSON.stringify(serializable));
    } catch (error) {
      // if localStorage is full, try to clear old caches
      this.cleanupOldCaches();
    }
  }
  // retrieve cached summary for a specific chunk
  static getCachedSummary(bookId: string, chunkId: string): ChunkSummary | null {
    const cache = this.loadSummaryCache(bookId);
    if (!cache) {
      return null;
    }

    return cache.chunkSummaries.get(chunkId) || null;
  }
  // cache a new chunk summary
  static cacheSummary(bookId: string, chunkSummary: ChunkSummary): void {
    let cache = this.loadSummaryCache(bookId);
    
    if (!cache) {
      cache = {
        bookId,
        chunkSummaries: new Map(),
        lastUpdated: new Date()
      };
    }

    cache.chunkSummaries.set(chunkSummary.chunkId, chunkSummary);
    cache.lastUpdated = new Date();

    this.saveSummaryCache(cache);
  }
  // get cached smummaries for a chunk up to a specific spine index
  static getCachedSummariesUpTo(bookId: string, maxSpineIndex: number): ChunkSummary[] {
    const cache = this.loadSummaryCache(bookId);
    if (!cache) {
      return [];
    }

    const summaries: ChunkSummary[] = [];
    for (const summary of cache.chunkSummaries.values()) {
      if (summary.spineIndex <= maxSpineIndex) {
        summaries.push(summary);
      }
    }
    // sort by spine index to maintain reading order
    return summaries.sort((a, b) => a.spineIndex - b.spineIndex);
  }
  // check if a chunk is already summarised
  static isChunkSummarized(bookId: string, chunkId: string): boolean {
    return this.getCachedSummary(bookId, chunkId) !== null;
  }
  
  // clear summary cache for a specific book
  static clearSummaryCache(bookId: string): void {
    try {
      const cacheKey = this.getCacheKey(bookId);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.error(error);
    }
  }
  // clean up old caches to free up localStorage
  // TODO: relying solely on localStorage throughout the app is not ideal
  // need to consider creating and managing files, or indexedDB
  static cleanupOldCaches(): void {
    try {
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.CACHE_KEY_PREFIX)) {
          try {
            const cacheData = localStorage.getItem(key);
            if (cacheData) {
              const parsed = JSON.parse(cacheData);
              const lastUpdated = new Date(parsed.lastUpdated);
              const now = new Date();
              const daysDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
              
              if (daysDiff > this.MAX_CACHE_AGE_DAYS) {
                keysToRemove.push(key);
              }
            }
          } catch (error) {
            // if you can't parse it, remove it
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log(`Cleaned up ${keysToRemove.length} old summary caches`);
    } catch (error) {
      console.warn('Error during cache cleanup:', error);
    }
  }
}

export default SummaryCacheManager;
