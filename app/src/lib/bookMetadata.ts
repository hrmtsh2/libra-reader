import { Note, TextChunk, ReaderSettings, Highlight } from '../types';

export interface BookMetadata {
  bookId: string;
  title: string;
  author: string;
  // reading progress
  currentLocation: string;
  progress: number;
  lastRead: Date;
  // text chunks
  textChunks: TextChunk[];
  chunksLastBuilt: Date;
  // page mappings for different settings combinations
  pageMappings: {
    [settingsHash: string]: {
      chunkToPageMap: Map<number, string>;
      pageToChunkMap: Map<string, number[]>;
      totalPages: number;
      settings: ReaderSettings;
      createdAt: Date;
    };
  };
  // user annotations
  notes: Note[];
  highlights: Highlight[];
  bookmarks: {
    id: string;
    location: string;
    label: string;
    createdAt: Date;
  }[];
  // reading statistics
  readingTime: number; // in minutes
  sessionsCount: number;
  averageReadingSpeed: number; // words per minute
  // search history
  searchHistory: {
    query: string;
    timestamp: Date;
    resultCount: number;
  }[];
  // preferences specific to a book
  customSettings?: Partial<ReaderSettings>;
  // metadata timestamps
  createdAt: Date;
  updatedAt: Date;
}

export class BookMetadataManager {
  private static readonly METADATA_KEY = 'libra-book-metadata';
  // get matches for a specific book
  static getMetadata(bookId: string): BookMetadata | null {
    try {
      const allMetadata = this.getAllMetadata();
      return allMetadata[bookId] || null;
    } catch (error) {
      console.error('Error getting book metadata:', error);
      return null;
    }
  }
  // save metadata for a specific book
  static saveMetadata(metadata: BookMetadata): void {
    try {
      const allMetadata = this.getAllMetadata();
      allMetadata[metadata.bookId] = {
        ...metadata,
        updatedAt: new Date()
      };      
      // convert maps to objects for json serialisation
      const serializedMetadata = {
        ...allMetadata[metadata.bookId],
        pageMappings: Object.fromEntries(
          Object.entries(allMetadata[metadata.bookId].pageMappings).map(([key, value]) => {
            const mappingValue = value as any;
            return [
              key,
              {
                chunkToPageMap: Object.fromEntries(mappingValue.chunkToPageMap || new Map()),
                pageToChunkMap: Object.fromEntries(mappingValue.pageToChunkMap || new Map()),
                totalPages: mappingValue.totalPages,
                settings: mappingValue.settings,
                createdAt: mappingValue.createdAt
              }
            ];
          })
        )
      };      
      allMetadata[metadata.bookId] = serializedMetadata;
      localStorage.setItem(this.METADATA_KEY, JSON.stringify(allMetadata));
    } catch (error) {
      console.error(error);
    }
  }
  // get all book metadata
  static getAllMetadata(): Record<string, any> {
    try {
      const stored = localStorage.getItem(this.METADATA_KEY);
      if (!stored) return {};
      
      const parsed = JSON.parse(stored);
      
      // convert objects back to maps for pageMappings and fix dates
      Object.values(parsed).forEach((metadata: any) => {
        if (metadata.createdAt && typeof metadata.createdAt === 'string') {
          metadata.createdAt = new Date(metadata.createdAt);
        }
        if (metadata.updatedAt && typeof metadata.updatedAt === 'string') {
          metadata.updatedAt = new Date(metadata.updatedAt);
        }
        if (metadata.chunksLastBuilt && typeof metadata.chunksLastBuilt === 'string') {
          metadata.chunksLastBuilt = new Date(metadata.chunksLastBuilt);
        }
        if (metadata.lastRead && typeof metadata.lastRead === 'string') {
          metadata.lastRead = new Date(metadata.lastRead);
        }
        if (metadata.notes && Array.isArray(metadata.notes)) {
          metadata.notes.forEach((note: any) => {
            if (note.createdAt && typeof note.createdAt === 'string') {
              note.createdAt = new Date(note.createdAt);
            }
            if (note.updatedAt && typeof note.updatedAt === 'string') {
              note.updatedAt = new Date(note.updatedAt);
            }
          });
        }
        if (metadata.bookmarks && Array.isArray(metadata.bookmarks)) {
          metadata.bookmarks.forEach((bookmark: any) => {
            if (bookmark.createdAt && typeof bookmark.createdAt === 'string') {
              bookmark.createdAt = new Date(bookmark.createdAt);
            }
          });
        }
        // convert objects back to maps for pageMappings
        if (metadata.pageMappings) {
          metadata.pageMappings = Object.fromEntries(
            Object.entries(metadata.pageMappings).map(([key, value]: [string, any]) => [
              key,
              {
                ...value,
                createdAt: value.createdAt ? new Date(value.createdAt) : new Date(),
                chunkToPageMap: new Map(Object.entries(value.chunkToPageMap || {})),
                pageToChunkMap: new Map(Object.entries(value.pageToChunkMap || {}).map(([k, v]) => [k, v]))
              }
            ])
          );
        }
      });
      
      return parsed;
    } catch (error) {
      return {};
    }
  }
  // create initial metadata for new book
  static createInitialMetadata(bookId: string, title: string, author: string): BookMetadata {
    return {
      bookId,
      title,
      author,
      currentLocation: '',
      progress: 0,
      lastRead: new Date(),
      textChunks: [],
      chunksLastBuilt: new Date(0), // forcing rebuild
      pageMappings: {},
      notes: [],
      highlights: [],
      bookmarks: [],
      readingTime: 0,
      sessionsCount: 0,
      averageReadingSpeed: 0,
      searchHistory: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
  // update reading progress
  static updateProgress(bookId: string, location: string, progress: number): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.currentLocation = location;
      metadata.progress = progress;
      metadata.lastRead = new Date();
      this.saveMetadata(metadata);
    }
  }
  // add a note
  static addNote(bookId: string, note: Note): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.notes.push(note);
      this.saveMetadata(metadata);
    }
  }
  // remove a note
  static removeNote(bookId: string, noteId: string): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.notes = metadata.notes.filter(n => n.id !== noteId);
      this.saveMetadata(metadata);
    }
  }
  // add a highlight
  static addHighlight(bookId: string, highlight: Highlight): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.highlights.push(highlight);
      this.saveMetadata(metadata);
    }
  }
  // remove highlight
  static removeHighlight(bookId: string, highlightId: string): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.highlights = metadata.highlights.filter(h => h.id !== highlightId);
      this.saveMetadata(metadata);
    }
  }
  // update highlight
  static updateHighlight(bookId: string, highlightId: string, updates: Partial<Highlight>): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      const index = metadata.highlights.findIndex(h => h.id === highlightId);
      if (index !== -1) {
        metadata.highlights[index] = { ...metadata.highlights[index], ...updates, updatedAt: new Date() };
        this.saveMetadata(metadata);
      }
    }
  }
  // save text chunks from a book
  static saveTextChunks(bookId: string, chunks: TextChunk[]): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      metadata.textChunks = chunks;
      metadata.chunksLastBuilt = new Date();
      this.saveMetadata(metadata);
    }
  }
  // compact and easy to spot when changed
  static generateSettingsHash(settings: ReaderSettings): string {
    return btoa(JSON.stringify({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      columns: settings.columns,
      theme: settings.theme
    }));
  }
  // save page mapping for specific settings
  static savePageMapping(
    bookId: string,
    settings: ReaderSettings,
    chunkToPageMap: Map<number, string>,
    pageToChunkMap: Map<string, number[]>,
    totalPages: number
  ): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      const settingsHash = this.generateSettingsHash(settings);
      metadata.pageMappings[settingsHash] = {
        chunkToPageMap,
        pageToChunkMap,
        totalPages,
        settings,
        createdAt: new Date()
      };
      this.saveMetadata(metadata);
    }
  }
  // get page mapping for specific settings
  static getPageMapping(bookId: string, settings: ReaderSettings) {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      const settingsHash = this.generateSettingsHash(settings);
      return metadata.pageMappings[settingsHash] || null;
    }
    return null;
  }
  // check if text chunks need rebuilding (e.g. after book updates)
  static shouldRebuildChunks(bookId: string, maxAge: number = 7 * 24 * 60 * 60 * 1000): boolean {
    const metadata = this.getMetadata(bookId);
    if (!metadata || !metadata.textChunks || metadata.textChunks.length === 0) return true;
    // if chunksLastBuilt is invalid or not set
    if (!metadata.chunksLastBuilt || !(metadata.chunksLastBuilt instanceof Date)) {
      return true;
    }
    const age = Date.now() - metadata.chunksLastBuilt.getTime();
    return age > maxAge;
  }
  // clean up old mappingsto save space
  static cleanupOldMappings(bookId: string, maxMappings: number = 3): void {
    const metadata = this.getMetadata(bookId);
    if (metadata) {
      const mappings = Object.entries(metadata.pageMappings)
        .sort(([, a], [, b]) => b.createdAt.getTime() - a.createdAt.getTime());
      
      if (mappings.length > maxMappings) {
        const toKeep = mappings.slice(0, maxMappings);
        metadata.pageMappings = Object.fromEntries(toKeep);
        this.saveMetadata(metadata);
      }
    }
  }
  // delete all metadata for a book
  static deleteMetadata(bookId: string): void {
    try {
      const allMetadata = this.getAllMetadata();
      delete allMetadata[bookId];
      localStorage.setItem(this.METADATA_KEY, JSON.stringify(allMetadata));
    } catch (error) {
      console.error(error);
    }
  }
}
