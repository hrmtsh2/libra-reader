export interface EpubBook {
  id: string;
  title: string;
  author: string;
  cover?: string;
  filePath: string;
  lastRead?: Date;
  currentLocation?: string;
  progress?: number;
  totalPages?: number;
}

export interface ReaderSettings {
  fontSize: number;
  fontFamily: string;
  theme: 'light' | 'dark' | 'sepia';
  columns: 1 | 2;
  lineHeight: number;
  margin: number;
}

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  subitems?: NavigationItem[];
}

export interface SearchResult {
  cfi: string;
  excerpt: string;
  terms: string[];
  href?: string;
  spineIndex?: number;
  textOffset?: number;
  textPosition?: number;
  chunkIndex?: number;
}

export interface BookLocation {
  start: {
    cfi: string;
    displayed?: {
      page: number;
      total: number;
    };
    href: string;
    index: number;
    percentage: number;
  };
  end: {
    cfi: string;
    displayed?: {
      page: number;
      total: number;
    };
    href: string;
    index: number;
    percentage: number;
  };
}

export interface Note {
  id: string;
  bookId: string;
  cfiRange: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Highlight {
  id: string;
  bookId: string;
  cfi: string;
  text: string;
  colour: 'yellow';
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReaderState {
  isLoading: boolean;
  currentLocation: string;
  totalPages: number;
  currentPage: number;
  progress: number;
  toc: NavigationItem[];
  searchResults: SearchResult[];
  notes: Note[];
  highlights: Highlight[];
}

export interface TextChunk {
  id: string;
  text: string;
  href: string;
  spineIndex: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  pageLocation?: string; // cfi or page identifier where this chunk is rendered
}

export interface ChunkSummary {
  chunkId: string;
  spineIndex: number;
  href: string;
  summary: string;
  createdAt: Date;
  tokenCount?: number;
}

export interface BookSummaryCache {
  bookId: string;
  chunkSummaries: Map<string, ChunkSummary>;
  lastUpdated: Date;
}
