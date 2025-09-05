import { BookMetadataManager } from './bookMetadata';
import { EpubBook } from '../types';

/**
 * Migration utility to convert from old localStorage format to new metadata system
 */
export class MetadataMigration {
  /**
   * Migrate all books from old localStorage format to new metadata system
   */
  static migrateAllBooks(): void {
    try {
      const library = JSON.parse(localStorage.getItem('libra-books') || '[]') as EpubBook[];
      
      console.log(`Starting migration for ${library.length} books...`);
      
      library.forEach(book => {
        this.migrateBook(book);
      });
      
      console.log('Migration completed successfully');
      
      // Mark migration as complete
      localStorage.setItem('libra-metadata-migrated', 'true');
      
    } catch (error) {
      console.error('Error during migration:', error);
    }
  }
  
  /**
   * Migrate a single book from old format to new metadata system
   */
  static migrateBook(book: EpubBook): void {
    try {
      // Check if metadata already exists
      const existingMetadata = BookMetadataManager.getMetadata(book.id);
      if (existingMetadata) {
        console.log(`Book ${book.title} already has metadata, skipping migration`);
        return;
      }
      
      // Create initial metadata
      const metadata = BookMetadataManager.createInitialMetadata(book.id, book.title, book.author);
      
      // Migrate progress and location
      if (book.currentLocation) {
        metadata.currentLocation = book.currentLocation;
      }
      if (book.progress) {
        metadata.progress = book.progress;
      }
      if (book.lastRead) {
        metadata.lastRead = book.lastRead;
      }
      
      // Migrate highlights
      const savedHighlights = localStorage.getItem(`highlights-${book.id}`);
      if (savedHighlights) {
        try {
          const highlights = JSON.parse(savedHighlights);
          metadata.highlights = highlights;
          console.log(`Migrated ${highlights.length} highlights for ${book.title}`);
        } catch (error) {
          console.warn(`Error migrating highlights for ${book.title}:`, error);
        }
      }
      
      // Migrate notes
      const savedNotes = localStorage.getItem(`notes-${book.id}`);
      if (savedNotes) {
        try {
          const notes = JSON.parse(savedNotes);
          metadata.notes = notes;
          console.log(`Migrated ${notes.length} notes for ${book.title}`);
        } catch (error) {
          console.warn(`Error migrating notes for ${book.title}:`, error);
        }
      }
      
      // Save the metadata
      BookMetadataManager.saveMetadata(metadata);
      
      console.log(`Successfully migrated metadata for ${book.title}`);
      
    } catch (error) {
      console.error(`Error migrating book ${book.title}:`, error);
    }
  }
  
  /**
   * Check if migration is needed
   */
  static needsMigration(): boolean {
    const migrated = localStorage.getItem('libra-metadata-migrated');
    return migrated !== 'true';
  }
  
  /**
   * Clean up old localStorage entries after successful migration
   */
  static cleanupOldStorage(): void {
    try {
      const library = JSON.parse(localStorage.getItem('libra-books') || '[]') as EpubBook[];
      
      library.forEach(book => {
        // Remove old highlight and note entries
        localStorage.removeItem(`highlights-${book.id}`);
        localStorage.removeItem(`notes-${book.id}`);
      });
      
      console.log('Cleaned up old localStorage entries');
    } catch (error) {
      console.error('Error cleaning up old storage:', error);
    }
  }
  
  /**
   * Get migration statistics
   */
  static getMigrationStats(): {
    totalBooks: number;
    booksWithHighlights: number;
    booksWithNotes: number;
    totalHighlights: number;
    totalNotes: number;
  } {
    const library = JSON.parse(localStorage.getItem('libra-books') || '[]') as EpubBook[];
    
    let booksWithHighlights = 0;
    let booksWithNotes = 0;
    let totalHighlights = 0;
    let totalNotes = 0;
    
    library.forEach(book => {
      const savedHighlights = localStorage.getItem(`highlights-${book.id}`);
      const savedNotes = localStorage.getItem(`notes-${book.id}`);
      
      if (savedHighlights) {
        try {
          const highlights = JSON.parse(savedHighlights);
          if (highlights.length > 0) {
            booksWithHighlights++;
            totalHighlights += highlights.length;
          }
        } catch (error) {
          console.warn(`Error parsing highlights for ${book.title}:`, error);
        }
      }
      
      if (savedNotes) {
        try {
          const notes = JSON.parse(savedNotes);
          if (notes.length > 0) {
            booksWithNotes++;
            totalNotes += notes.length;
          }
        } catch (error) {
          console.warn(`Error parsing notes for ${book.title}:`, error);
        }
      }
    });
    
    return {
      totalBooks: library.length,
      booksWithHighlights,
      booksWithNotes,
      totalHighlights,
      totalNotes
    };
  }
}
