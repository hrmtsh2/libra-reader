import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeTextFile, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { EpubReader } from './components/reader/EpubReader';
import { Library } from './components/library/Library';
import { EpubBook, Highlight } from './types';
import './App.css';
import JSZip from 'jszip';

// Helper function to validate EPUB file format
const validateEpubFile = async (arrayBuffer: ArrayBuffer): Promise<{isValid: boolean, errors: string[], warnings: string[], version?: string}> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let version: string | undefined;
  
  try {
    // Check if it's a valid ZIP file
    const zip = await JSZip.loadAsync(arrayBuffer);
    console.log('✅ Valid ZIP archive detected');
    
    // Check for required EPUB structure
    const requiredFiles = ['META-INF/container.xml'];
    for (const file of requiredFiles) {
      if (!zip.file(file)) {
        errors.push(`Missing required file: ${file}`);
      }
    }
    
    // Check mimetype file (EPUB standard)
    const mimetypeFile = zip.file('mimetype');
    if (mimetypeFile) {
      const mimetype = await mimetypeFile.async('text');
      if (mimetype.trim() !== 'application/epub+zip') {
        warnings.push(`Unexpected mimetype: ${mimetype.trim()}`);
      } else {
        console.log('✅ Correct EPUB mimetype found');
      }
    } else {
      warnings.push('Missing mimetype file (recommended)');
    }
    
    // Parse container.xml
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    if (!containerXml) {
      errors.push('Cannot read container.xml');
      return { isValid: false, errors, warnings };
    }
    
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'text/xml');
    
    // Check for XML parsing errors
    const parserError = containerDoc.querySelector('parsererror');
    if (parserError) {
      errors.push('Invalid XML in container.xml');
      return { isValid: false, errors, warnings };
    }
    
    const rootFileElement = containerDoc.querySelector('rootfile');
    if (!rootFileElement) {
      errors.push('No rootfile element found in container.xml');
      return { isValid: false, errors, warnings };
    }
    
    const opfPath = rootFileElement.getAttribute('full-path');
    const mediaType = rootFileElement.getAttribute('media-type');
    
    if (!opfPath) {
      errors.push('No full-path attribute in rootfile');
      return { isValid: false, errors, warnings };
    }
    
    if (mediaType !== 'application/oebps-package+xml') {
      warnings.push(`Unexpected rootfile media-type: ${mediaType}`);
    }
    
    // Parse OPF file
    const opfContent = await zip.file(opfPath)?.async('text');
    if (!opfContent) {
      errors.push(`OPF file not found: ${opfPath}`);
      return { isValid: false, errors, warnings };
    }
    
    const opfDoc = parser.parseFromString(opfContent, 'text/xml');
    
    // Check for XML parsing errors in OPF
    const opfParserError = opfDoc.querySelector('parsererror');
    if (opfParserError) {
      errors.push('Invalid XML in OPF file');
      return { isValid: false, errors, warnings };
    }
    
    // Extract and validate EPUB version
    const packageElement = opfDoc.querySelector('package');
    if (packageElement) {
      version = packageElement.getAttribute('version') || undefined;
      if (version) {
        console.log(`📚 EPUB Version: ${version}`);
        if (version.startsWith('2.')) {
          console.log('✅ EPUB 2.x format - Supported');
        } else if (version.startsWith('3.')) {
          console.log('✅ EPUB 3.x format - Supported');
        } else {
          warnings.push(`Unknown EPUB version: ${version}`);
        }
      } else {
        warnings.push('No version attribute in package element');
      }
    } else {
      errors.push('No package element found in OPF');
      return { isValid: false, errors, warnings };
    }
    
    // Check for required OPF sections
    const metadata = opfDoc.querySelector('metadata');
    const manifest = opfDoc.querySelector('manifest');
    const spine = opfDoc.querySelector('spine');
    
    if (!metadata) errors.push('Missing metadata section in OPF');
    if (!manifest) errors.push('Missing manifest section in OPF');
    if (!spine) errors.push('Missing spine section in OPF');
    
    // Check for basic metadata
    const title = opfDoc.querySelector('metadata title')?.textContent?.trim();
    if (!title) warnings.push('No title found in metadata');
    
    // Check manifest items exist
    const manifestItems = opfDoc.querySelectorAll('manifest item');
    const missingFiles: string[] = [];
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    
    for (const item of manifestItems) {
      const href = item.getAttribute('href');
      if (href) {
        const fullPath = opfDir + href;
        if (!zip.file(fullPath)) {
          missingFiles.push(fullPath);
        }
      }
    }
    
    if (missingFiles.length > 0) {
      warnings.push(`Missing manifest files: ${missingFiles.slice(0, 5).join(', ')}${missingFiles.length > 5 ? '...' : ''}`);
    }
    
    // Check spine references
    const spineItems = opfDoc.querySelectorAll('spine itemref');
    if (spineItems.length === 0) {
      warnings.push('No spine items found - book may be empty');
    }
    
    console.log(`✅ EPUB validation completed - ${errors.length} errors, ${warnings.length} warnings`);
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      version
    };
    
  } catch (error) {
    console.error('EPUB validation failed:', error);
    if (error instanceof Error) {
      if (error.message.includes('zip')) {
        errors.push('File is not a valid ZIP archive');
      } else if (error.message.includes('corrupt')) {
        errors.push('File appears to be corrupted');
      } else {
        errors.push(`Validation error: ${error.message}`);
      }
    } else {
      errors.push('Unknown validation error occurred');
    }
    
    return { isValid: false, errors, warnings };
  }
};

// Helper function to extract EPUB metadata
const extractEpubMetadata = async (arrayBuffer: ArrayBuffer): Promise<{title: string, author: string, pageCount: number, coverImage?: string}> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Find container.xml
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    if (!containerXml) throw new Error('No container.xml found');
    
    // Parse container.xml to find OPF file
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'text/xml');
    const rootFileElement = containerDoc.querySelector('rootfile');
    if (!rootFileElement) throw new Error('No rootfile found');
    
    const opfPath = rootFileElement.getAttribute('full-path');
    if (!opfPath) throw new Error('No OPF path found');
    
    // Get OPF directory for relative paths
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    
    // Parse OPF file
    const opfContent = await zip.file(opfPath)?.async('text');
    if (!opfContent) throw new Error('OPF file not found');
    
    const opfDoc = parser.parseFromString(opfContent, 'text/xml');
    
    // Extract metadata
    const title = opfDoc.querySelector('metadata title')?.textContent?.trim() || 'Unknown Title';
    const author = opfDoc.querySelector('metadata creator')?.textContent?.trim() || 'Unknown Author';
    
    // Extract cover image
    let coverImage: string | undefined;
    
    // Method 1: Look for cover in metadata
    const coverMeta = opfDoc.querySelector('metadata meta[name="cover"]');
    if (coverMeta) {
      const coverId = coverMeta.getAttribute('content');
      if (coverId) {
        const coverItem = opfDoc.querySelector(`manifest item[id="${coverId}"]`);
        if (coverItem) {
          const coverHref = coverItem.getAttribute('href');
          if (coverHref) {
            const coverPath = opfDir + coverHref;
            const coverFile = zip.file(coverPath);
            if (coverFile) {
              const coverData = await coverFile.async('blob');
              coverImage = URL.createObjectURL(coverData);
            }
          }
        }
      }
    }
    
    // Method 2: Look for cover in manifest by properties
    if (!coverImage) {
      const coverManifestItem = opfDoc.querySelector('manifest item[properties*="cover-image"]');
      if (coverManifestItem) {
        const coverHref = coverManifestItem.getAttribute('href');
        if (coverHref) {
          const coverPath = opfDir + coverHref;
          const coverFile = zip.file(coverPath);
          if (coverFile) {
            const coverData = await coverFile.async('blob');
            coverImage = URL.createObjectURL(coverData);
          }
        }
      }
    }
    
    // Method 3: Search for common cover file names
    if (!coverImage) {
      const commonCoverNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'Cover.jpg', 'Cover.jpeg', 'Cover.png'];
      for (const coverName of commonCoverNames) {
        const possiblePaths = [
          coverName,
          opfDir + coverName,
          'images/' + coverName,
          'Images/' + coverName,
          'OEBPS/images/' + coverName,
          'OEBPS/Images/' + coverName
        ];
        
        for (const path of possiblePaths) {
          const coverFile = zip.file(path);
          if (coverFile) {
            const coverData = await coverFile.async('blob');
            coverImage = URL.createObjectURL(coverData);
            break;
          }
        }
        if (coverImage) break;
      }
    }
    
    // Count spine items for page count (be less aggressive with filtering)
    const spineItems = opfDoc.querySelectorAll('spine itemref');
    const manifestItems = new Map();
    opfDoc.querySelectorAll('manifest item').forEach(item => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) {
        manifestItems.set(id, href);
      }
    });
    
    let contentFileCount = 0;
    spineItems.forEach(item => {
      const spineId = item.getAttribute('idref');
      if (spineId && manifestItems.has(spineId)) {
        const href = manifestItems.get(spineId).toLowerCase();
        // Only exclude obvious non-content files
        const isNonContent = href.includes('toc.') || 
                           href.includes('nav.') ||
                           href.includes('copyright.') ||
                           href === 'titlepage.html' ||
                           href === 'titlepage.xhtml';
        if (!isNonContent) {
          contentFileCount++;
        }
      }
    });
    
    const pageCount = contentFileCount > 0 ? contentFileCount : spineItems.length;
    
    return { title, author, pageCount, coverImage };
  } catch (error) {
    console.warn('Failed to extract EPUB metadata:', error);
    return { title: 'Unknown Title', author: 'Unknown Author', pageCount: 0 };
  }
};

// Utility function to check localStorage usage
const getLocalStorageUsage = () => {
  let totalSize = 0;
  const breakdown: Record<string, number> = {};
  
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      const value = localStorage[key];
      const size = new Blob([value]).size;
      totalSize += size;
      breakdown[key] = size;
    }
  }
  
  return {
    totalSize,
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    breakdown
  };
};

// Function to clean up old or corrupted localStorage data
const cleanupLocalStorage = () => {
  const keys = Object.keys(localStorage);
  const chunkKeys = keys.filter(key => key.startsWith('text-chunks-'));
  
  if (chunkKeys.length > 0) {
    console.log(`Cleaning up ${chunkKeys.length} old text-chunks entries from localStorage`);
    chunkKeys.forEach(key => {
      localStorage.removeItem(key);
    });
  }
  
  console.log('localStorage cleanup completed');
};

// Call cleanup on app initialization
cleanupLocalStorage();

// Check localStorage usage after cleanup
const usage = getLocalStorageUsage();
console.log('localStorage usage:', usage);

function App() {
  const [currentView, setCurrentView] = useState<'library' | 'reader'>('library');
  const [selectedBook, setSelectedBook] = useState<EpubBook | null>(null);
  const [books, setBooks] = useState<EpubBook[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // Load data from Tauri filesystem on startup
  useEffect(() => {
    async function loadData() {
      try {
        const savedBooks = await readTextFile('libra-books.json', { baseDir: BaseDirectory.AppData });
        if (savedBooks) {
          const parsedBooks = JSON.parse(savedBooks);
          const booksWithDates = parsedBooks.map((book: any) => ({
            ...book,
            lastRead: book.lastRead ? new Date(book.lastRead) : undefined
          }));
          setBooks(booksWithDates);
          console.log(`Loaded ${booksWithDates.length} books from storage`);
        }
      } catch (error) {
        // File doesn't exist yet (first run) - this is normal
        console.log('No existing books file found (first run)');
      }
      try {
        const savedHighlights = await readTextFile('libra-highlights.json', { baseDir: BaseDirectory.AppData });
        if (savedHighlights) {
          const parsedHighlights = JSON.parse(savedHighlights);
          const highlightsWithDates = parsedHighlights.map((highlight: any) => ({
            ...highlight,
            createdAt: new Date(highlight.createdAt)
          }));
          setHighlights(highlightsWithDates);
          console.log(`Loaded ${highlightsWithDates.length} highlights from storage`);
        }
      } catch (error) {
        // File doesn't exist yet (first run) - this is normal
        console.log('No existing highlights file found (first run)');
      }
    }
    loadData();
  }, []);

  // Save data to Tauri filesystem
  const saveBooks = async (newBooks: EpubBook[]) => {
    setBooks(newBooks);
    await writeTextFile('libra-books.json', JSON.stringify(newBooks), { baseDir: BaseDirectory.AppData });
  };

  const saveHighlights = async (newHighlights: Highlight[]) => {
    setHighlights(newHighlights);
    await writeTextFile('libra-highlights.json', JSON.stringify(newHighlights), { baseDir: BaseDirectory.AppData });
  };

  const handleAddBook = async () => {
    console.log('handleAddBook called - starting file dialog...');
    
    // Log environment details
    console.log('Current location:', window.location.href);
    console.log('User agent:', navigator.userAgent);
    console.log('Window object keys:', Object.keys(window));
    console.log('Tauri check:', typeof window !== 'undefined' && (window as any).__TAURI__);
    console.log('Tauri internals:', typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__);
    
    try {
      console.log('Attempting to open file dialog...');
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'EPUB Files',
          extensions: ['epub']
        }]
      });

      console.log('File dialog result:', selected);
      if (selected) {
        console.log('Selected file:', selected);
        
        // Read file and create blob URL (required for browser security)
        console.log('Reading file data...');
        const fileData = await readFile(selected);
        console.log('File data read, size:', fileData.length, 'bytes');
        
        // Create blob with proper MIME type
        const uint8Array = new Uint8Array(fileData);
        
        // Validate EPUB file format
        console.log('📚 Validating EPUB file...');
        const validation = await validateEpubFile(uint8Array.buffer);
        
        // Log validation results
        if (validation.version) {
          console.log(`📖 EPUB Version: ${validation.version}`);
        }
        
        if (validation.errors.length > 0) {
          console.error('❌ EPUB Validation Errors:');
          validation.errors.forEach(error => console.error(`  - ${error}`));
        }
        
        if (validation.warnings.length > 0) {
          console.warn('⚠️ EPUB Validation Warnings:');
          validation.warnings.forEach(warning => console.warn(`  - ${warning}`));
        }
        
        // Show user-friendly error if file is invalid
        if (!validation.isValid) {
          const errorMessage = `Cannot load EPUB file:\n\n${validation.errors.join('\n')}`;
          alert(errorMessage);
          console.error('❌ EPUB file validation failed, cannot load book');
          return;
        }
        
        // Show warnings but continue
        if (validation.warnings.length > 0) {
          const warningMessage = `EPUB file loaded with warnings:\n\n${validation.warnings.join('\n')}\n\nThe book may not display correctly.`;
          if (!confirm(`${warningMessage}\n\nDo you want to continue?`)) {
            return;
          }
        }
        
        console.log('✅ EPUB validation passed, proceeding with book loading');
        
        const blob = new Blob([uint8Array], { type: 'application/epub+zip' });
        const epubSource = URL.createObjectURL(blob);
        
        console.log('Blob URL created:', epubSource);
        console.log('Blob size:', blob.size, 'bytes');
        
        // Extract book metadata
        const { title, author, pageCount, coverImage } = await extractEpubMetadata(uint8Array.buffer);
        
        const newBook: EpubBook = {
          id: Date.now().toString(),
          title: title,
          author: author,
          filePath: epubSource, // Use the determined source for epub.js
          lastRead: new Date(),
          progress: 0,
          totalPages: pageCount,
          cover: coverImage
        };

        const updatedBooks = [...books, newBook];
        saveBooks(updatedBooks);
        
        console.log('Book added successfully:', newBook);
      } else {
        console.log('No file selected');
      }
    } catch (error) {
      console.error('Error adding book:', error);
      // You could add a toast notification here for better UX
      alert('Error adding book: ' + (error as Error).message);
    }
  };

  const handleSelectBook = (book: EpubBook) => {
    // Update last read time
    const updatedBooks = books.map(b => 
      b.id === book.id 
        ? { ...b, lastRead: new Date() }
        : b
    );
    saveBooks(updatedBooks);
    
    setSelectedBook(book);
    setCurrentView('reader');
  };

  const handleCloseReader = () => {
    setSelectedBook(null);
    setCurrentView('library');
  };

  const handleRemoveBook = async (bookId: string) => {
    const updatedBooks = books.filter(b => b.id !== bookId);
    await saveBooks(updatedBooks);

    // Also remove associated highlights
    const updatedHighlights = highlights.filter(h => h.bookId !== bookId);
    await saveHighlights(updatedHighlights);

    // Clean up any additional book-related data from filesystem
    try { await remove(`highlights-${bookId}.json`, { baseDir: BaseDirectory.AppData }); } catch {}
    try { await remove(`notes-${bookId}.json`, { baseDir: BaseDirectory.AppData }); } catch {}

    // Note: We no longer store text chunks in localStorage, so no need to clean them up
    // They're automatically cleaned up when the EpubReader component unmounts

    console.log(`Cleaned up data for book ${bookId}`);
  };

  if (currentView === 'reader' && selectedBook) {
    return (
      <EpubReader
        book={selectedBook}
        onClose={handleCloseReader}
      />
    );
  }

  return (
    <Library
      books={books}
      onSelectBook={handleSelectBook}
      onAddBook={handleAddBook}
      onRemoveBook={handleRemoveBook}
    />
  );
}

export default App;
