import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SummaryModal } from './SummaryModal';
import { ReactReader } from 'react-reader';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import './EpubReader.css';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  BookOpen,
  Settings,
  StickyNote,
  Menu,
  X,
  Highlighter,
  FileText,
  Brain,
  MessageCircle
} from 'lucide-react';
import {
  EpubBook,
  ReaderSettings,
  SearchResult,
  Note,
  ReaderState,
  TextChunk,
  Highlight,
  ChunkSummary
} from '../../types';
import { BookMetadataManager } from '../../lib/bookMetadata';
import SummaryCacheManager from '../../utils/SummaryCacheManager';

interface EpubReaderProps {
  book: EpubBook;
  onClose: () => void;
  onChunksReady?: (chunks: TextChunk[]) => void;
}

const defaultSettings: ReaderSettings = {
  fontSize: 16,
  fontFamily: 'serif',
  theme: 'light',
  columns: 2,
  lineHeight: 1.6,
  margin: 20
};

export const EpubReader = ({ book, onClose, onChunksReady } : EpubReaderProps) => {
  const [location, setLocation] = useState<string | null>('0');
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('readerSettings');
    return saved ? JSON.parse(saved) : defaultSettings;
  });
  
  const [state, setState] = useState<ReaderState>({
    isLoading: true,
    currentLocation: '',
    totalPages: 0,
    currentPage: 1,
    progress: 0,
    toc: [],
    searchResults: [],
    notes: [],
    highlights: []
  });

  // text chunks for RAG
  const [textChunks, setTextChunks] = useState<TextChunk[]>([]);

  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<'toc' | 'search' | 'notes' | 'highlights' | 'settings' | 'summary' | 'qa'>('toc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [currentNote, setCurrentNote] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [currentSummary, setCurrentSummary] = useState('');
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  
  // qna state
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState<Array<{question: string, answer: string, timestamp: Date}>>([]);
  const [isAsking, setIsAsking] = useState(false);

  // default context for qna is 'pages_so_far'
  const [qaContextScope, setQaContextScope] = useState<'pages_so_far' | 'complete_book'>('pages_so_far');

  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const highlightsRef = useRef<Highlight[]>([]);
  const restoreTimeoutRef = useRef<number | null>(null);
  const navigationTimeoutRef = useRef<number | null>(null);
  const locationChangeTimeoutRef = useRef<number | null>(null);

  // saving settings to localStorage
  useEffect(() => {
    localStorage.setItem('readerSettings', JSON.stringify(settings));
  }, [settings]);

  // cleanup when component unmounts
  useEffect(() => {
    return () => {

      // clear any pending highlight restore timeout
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
      
      // clear any pending navigation timeout
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
      
      // clear any pending location change timeout
      if (locationChangeTimeoutRef.current) {
        clearTimeout(locationChangeTimeoutRef.current);
        locationChangeTimeoutRef.current = null;
      }
      
      // clear text chunks from memory
      setTextChunks([]);
      
      // clear search results
      setState(prev => ({ ...prev, searchResults: [] }));
      
      // clear any remaining references
      if (renditionRef.current) {
        renditionRef.current.destroy?.();
        renditionRef.current = null;
      }
      
      if (bookRef.current) {
        bookRef.current = null;
      }      
    };
  }, []);

  // load saved data for the book using a separate BookMetedataManager
  useEffect(() => {
    // get or create metadata
    let metadata = BookMetadataManager.getMetadata(book.id);
    if (!metadata) {
      console.log('Creating initial metadata for new book');
      metadata = BookMetadataManager.createInitialMetadata(book.id, book.title, book.author);
      BookMetadataManager.saveMetadata(metadata);
    }

    // update state with metadata
    setState(prev => ({
      ...prev,
      notes: metadata!.notes,
      highlights: metadata!.highlights,
      isLoading: true // Reset loading state for new book
    }));

    // Update highlights ref
    highlightsRef.current = metadata!.highlights;

    // set initial location - use saved location or start from beginning
    if (metadata.currentLocation) {
      setLocation(metadata.currentLocation);
    } else {
      // for new books, set location to 0 (beginning) instead of null
      // ReactReader handles 0 as "start from beginning"
      setLocation('0');
    }

    // Add timeout to prevent infinite loading
    const loadingTimeout = setTimeout(() => {
      setState(prev => {
        if (prev.isLoading) {
          return { ...prev, isLoading: false };
        }
        return prev;
      });
    }, 15000); // 15 second timeout

    return () => clearTimeout(loadingTimeout);
  }, [book.id, book.title, book.author]);

  // Handle non-navigation keyboard shortcuts only
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Skip if target is input/textarea or any contenteditable element
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || 
          target instanceof HTMLTextAreaElement ||
          target.contentEditable === 'true' ||
          target.closest('input') ||
          target.closest('textarea')) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          setShowSidebar(false);
          setShowNoteDialog(false);
          break;
        case 'f':
          if (e.ctrlKey) {
            e.preventDefault();
            setShowSidebar(true);
            setSidebarContent('search');
          }
          break;
        case 't':
          if (e.ctrlKey) {
            e.preventDefault();
            setShowSidebar(true);
            setSidebarContent('toc');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  const onRenditionReady = useCallback((rendition: any) => {    
    renditionRef.current = rendition;
    bookRef.current = rendition.book;
  
    // apply theme when fully ready
    // TODO: also a crude way to deal with this...look into a promises-based method
    setTimeout(() => {
      applyTheme(rendition);
    }, 100);
    
    // Handle text selection - automatically create highlight
    rendition.on('selected', (cfiRange: string, contents: any) => {
      const text = contents.window.getSelection().toString();
      if (text.trim()) {
        const highlight: Highlight = {
          id: Date.now().toString(),
          bookId: book.id,
          cfi: cfiRange,
          text: text.trim(),
          colour: 'yellow', // default colour; TODO: colour options
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // add to epub.js annotations
        try {
          renditionRef.current.annotations.add(
            'highlight',
            cfiRange,
            {
              fill: getHighlightColor('yellow'),
              fillOpacity: 0.3,
              mixBlendMode: 'multiply'
            },
            null,
            null,
            { highlightId: highlight.id }
          );
        } catch (error) {
          ;
        }

        BookMetadataManager.addHighlight(book.id, highlight);
        
        // Update local state using callback to get latest state
        setState(prev => {
          const newHighlights = [...prev.highlights, highlight];
          highlightsRef.current = newHighlights;
          return { ...prev, highlights: newHighlights };
        });

        contents.window.getSelection().removeAllRanges();
      }
    });

    // text de-selection
    rendition.on('unselected', () => {      
      setSelectedText('');
    });

    // wait for book to load before setting up navigation
    rendition.book.ready.then(() => {
      // load table of contents
      return rendition.book.loaded.navigation;
    }).then((nav: any) => {    
      const toc = nav.toc.map((item: any) => ({
        id: item.id || item.href,
        label: item.label,
        href: item.href,
        subitems: item.subitems?.map((sub: any) => ({
          id: sub.id || sub.href,
          label: sub.label,
          href: sub.href
        }))
      }));
      
      setState(prev => ({ ...prev, toc, isLoading: false }));
      
      // total (approx) pages
      const spine = rendition.book.spine;
      setState(prev => ({ ...prev, totalPages: spine.length }));
      
      // text chunking for RAG 😈 - always rebuild since we don't store them
      // MAJOR TODO: this is temporary; 
      // chunk and save chunks as and when books loaded into library
      setTimeout(() => {
        buildTextChunks();
      }, 2000);
      
    }).catch((error: any) => {
      console.error(error);
      setState(prev => ({ ...prev, isLoading: false }));
    });
    rendition.on('error', (error: any) => {
      if (error.message?.includes('No Section Found')) {        
        setLocation('0');
      }
      setState(prev => ({ ...prev, isLoading: false }));
    });

    // restore highlights when a page is rendered (debounce!)
    rendition.on('rendered', () => {
      debouncedRestoreHighlights();
    });

    // handle page relocation (debounced!)
    rendition.on('relocated', () => {
      debouncedRestoreHighlights();
    });
  }, [book.id, settings]);

  // notify parent component when chunks are ready
  useEffect(() => {
    if (textChunks.length > 0 && onChunksReady) {
      onChunksReady(textChunks);
    }
  }, [textChunks, onChunksReady]);

  const applyTheme = useCallback((rendition: any) => {
    if (!rendition || !rendition.themes) {
      console.warn('Rendition or themes not available');
      return;
    }

    try {      
      const themes = {
        light: {
          body: { 'background': '#ffffff', 'color': '#000000' },
          'p, div, span': { 'font-size': `${settings.fontSize}px !important`, 'line-height': `${settings.lineHeight} !important` },
          // Legacy DOM-based highlights
          '.highlight-yellow': { 'background-color': '#fef08a !important' },
          '.highlight-blue': { 'background-color': '#bfdbfe !important' },
          '.highlight-pink': { 'background-color': '#fbcfe8 !important' },
          // New EPUB.js annotation classes
          '.epub-highlight-yellow': { 'background-color': '#fef08a !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-blue': { 'background-color': '#bfdbfe !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-pink': { 'background-color': '#fbcfe8 !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' }
        },
        dark: {
          body: { 'background': '#1f2937', 'color': '#f9fafb' },
          'p, div, span': { 'font-size': `${settings.fontSize}px !important`, 'line-height': `${settings.lineHeight} !important` },
          // Legacy DOM-based highlights
          '.highlight-yellow': { 'background-color': '#fbbf24 !important' },
          '.highlight-blue': { 'background-color': '#3b82f6 !important' },
          '.highlight-pink': { 'background-color': '#ec4899 !important' },
          // New EPUB.js annotation classes
          '.epub-highlight-yellow': { 'background-color': '#fbbf24 !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-blue': { 'background-color': '#3b82f6 !important', 'color': '#fff !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-pink': { 'background-color': '#ec4899 !important', 'color': '#fff !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' }
        },
        sepia: {
          body: { 'background': '#f7f3e9', 'color': '#5c4a3a' },
          'p, div, span': { 'font-size': `${settings.fontSize}px !important`, 'line-height': `${settings.lineHeight} !important` },
          // Legacy DOM-based highlights
          '.highlight-yellow': { 'background-color': '#fcd34d !important' },
          '.highlight-blue': { 'background-color': '#60a5fa !important' },
          '.highlight-pink': { 'background-color': '#f472b6 !important' },
          // New EPUB.js annotation classes
          '.epub-highlight-yellow': { 'background-color': '#fcd34d !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-blue': { 'background-color': '#60a5fa !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' },
          '.epub-highlight-pink': { 'background-color': '#f472b6 !important', 'color': '#000 !important', 'padding': '1px 2px !important', 'border-radius': '2px !important' }
        }
      };

      // Apply theme with error handling
      if (rendition.themes.default) {
        rendition.themes.default(themes[settings.theme]);
      } else {
        console.warn('themes.default method not available');
      }
      
      // Apply font settings with error handling
      if (rendition.themes.fontSize) {
        rendition.themes.fontSize(`${settings.fontSize}px`);
      } else {
        console.warn('themes.fontSize method not available');
      }
      
      if (rendition.themes.font) {
        rendition.themes.font(settings.fontFamily);
      } else {
        console.warn('themes.font method not available');
      }
      
      // Apply column layout with error handling
      if (rendition.spread) {
        if (settings.columns === 2) {
          rendition.spread('always');
        } else {
          rendition.spread('none');
        }
      } else {
        console.warn('spread method not available');
      }

    } catch (error) {
      console.error('Error applying theme:', error);
    }
  }, [settings]);

  // re-apply theme when settings change
  useEffect(() => {
    if (renditionRef.current) {
      setTimeout(() => {
        applyTheme(renditionRef.current);
      }, 100);
    }
  }, [settings, applyTheme]);

  const clearSearchHighlights = () => {
    if (renditionRef.current) {
      try {
        // clear epub.js annotation highlights
        const existingAnnotations = renditionRef.current.annotations._annotations;
        Object.keys(existingAnnotations).forEach(key => {
          if (key.startsWith('search-highlight-')) {
            renditionRef.current.annotations.remove(key);
          }
        });
        
        // clear our custom DOM highlights
        const iframe = renditionRef.current.manager.container.querySelector('iframe');
        if (iframe && iframe.contentDocument) {
          const doc = iframe.contentDocument;
          const existingHighlights = doc.querySelectorAll('.search-highlight');
          existingHighlights.forEach((highlight: Element) => {
            const parent = highlight.parentNode;
            if (parent) {
              parent.replaceChild(doc.createTextNode(highlight.textContent || ''), highlight);
              parent.normalize();
            }
          });
        }        
      } catch (error) {
        ;
      }
    }
  };

  const goToChapter = (href: string) => {
    if (renditionRef.current) {
      try {
        // use rendition.display(), which will trigger locationChanged and thus update location
        renditionRef.current.display(href).then(() => {
        }).catch((error: any) => {
          console.error(error);
        });
        setShowSidebar(false);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const performSearch = async () => {
    if (!searchQuery.trim() || !bookRef.current) return;

    setIsSearching(true);
    setState(prev => ({ ...prev, searchResults: [] }));
    
    // clear existing search highlights
    clearSearchHighlights();
    
    try {
      // check if we already hav echunks built
      let chunks = textChunks;
      if (chunks.length === 0) {
        await buildTextChunks();
        chunks = textChunks;
      }
      // search through the existing chunks
      const results: SearchResult[] = [];
      // escape characters that might be treated as regex special characters
      // use 'global' and 'case-insensitive' flags
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      
      chunks.forEach((chunk, chunkIndex) => {
        let match;
        while ((match = regex.exec(chunk.text)) !== null) {
          try {
            // extract context around the match
            const contextStart = Math.max(0, match.index - 100);
            const contextEnd = Math.min(chunk.text.length, match.index + searchQuery.length + 100);
            const excerpt = chunk.text.slice(contextStart, contextEnd).trim();
            
            // calculate position within the chunk
            const chunkPosition = match.index / chunk.text.length;
            const globalOffset = chunk.startOffset + match.index;
            
            // use page location if available; fall back to offset format otherwise
            // cfi - epub canonical fragment identifier (useful for bookmarking and stuff)
            const cfi = chunk.pageLocation || `${chunk.href}#offset=${globalOffset}`;            
            results.push({
              cfi: cfi,
              excerpt: excerpt,
              terms: [searchQuery],
              href: chunk.href,
              spineIndex: chunk.spineIndex,
              textOffset: globalOffset,
              textPosition: chunkPosition,
              chunkIndex: chunkIndex
            });
          } catch (error) {
            console.error(error);
          }
        }
      });      
      setState(prev => ({ ...prev, searchResults: results }));      
    } catch (error) {
      setState(prev => ({ ...prev, searchResults: [] }));
    } finally {
      setIsSearching(false);
    }
  };

  const highlightSearchTerms = (text: string, terms: string[]) => {
    let highlightedText = text;
    terms.forEach(term => {
      const regex = new RegExp(`(${term})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
    });
    return highlightedText;
  };

  const goToSearchResult = (result: SearchResult) => {
    if (renditionRef.current) {
      // clear any existing search highlighs
      clearSearchHighlights();
      
      // If we have a chunk index, try to use the page mapping for precise navigation
      if (result.chunkIndex !== undefined && result.chunkIndex >= 0) {
        const chunk = textChunks[result.chunkIndex];
        if (chunk && chunk.pageLocation) {
          
          // navigate to the page location of the relevant chunk
          renditionRef.current.display(chunk.pageLocation).then(() => {
            // highlight the search term after navigation
            // TODO: crude way to wait for navigation to end
            // look into a promises-based approach
            setTimeout(() => {
              highlightSearchResultAtCurrentLocation(searchQuery.trim());
            }, 600);
          }).catch((error: any) => {
            console.error(error);
            // fallback to section navigation
            fallbackToSectionNavigation(result);
          });
        } else {
          // fallback to section navigation
          fallbackToSectionNavigation(result);
        }
      } else {
        // fallback to section navigation
        fallbackToSectionNavigation(result);
      }      
      // close sidebar after navigation
      setShowSidebar(false);
    }
  };

  // when unable to navigate to search result through the precise cfi
  // use a slightly hacked-together way - navigate to cfi href
  // then to attempt to scroll to the offset within that section
  const fallbackToSectionNavigation = (result: SearchResult) => {
    if (result.cfi.includes('#offset=')) {
      const [href, offsetPart] = result.cfi.split('#offset=');
      const targetOffset = parseInt(offsetPart);
      
      // navigate to the section first
      renditionRef.current.display(href).then(() => {
        // wait longer for the DOM to be ready before scrolling and highlighting
        // TODO: crude for the same reasons as before
        setTimeout(() => {
          scrollToOffsetInSection(targetOffset, result.textPosition || 0);          
          // wait a bit more before highlighting to ensure scroll is complete
          setTimeout(() => {
            highlightSearchResultAtCurrentLocation(searchQuery.trim());
          }, 300);
        }, 800);
      }).catch((error: any) => {
        console.error(error);
      });
    } else {
      // fallback to standard navigation
      renditionRef.current.display(result.href).then(() => {
        setTimeout(() => {
          highlightSearchResultAtCurrentLocation(searchQuery.trim());
        }, 800);
      }).catch((error: any) => {
        console.error(error);
      });
    }
  };
  // now that we've navigated to the section
  // find and scroll to the exact text position within it
  const scrollToOffsetInSection = (targetOffset: number, textPosition: number) => {
    try {
      const iframe = renditionRef.current.manager.container.querySelector('iframe');
      if (!iframe || !iframe.contentDocument) {
        return;
      }
      const doc = iframe.contentDocument;
      const body = doc.body;      
      if (!body) {
        return;
      }
      // get all text content and find the target position
      const allText = body.textContent || body.innerText || '';
      const targetText = allText.substring(Math.max(0, targetOffset - 50), targetOffset + 50);
      
      console.log('Searching for text at offset:', targetOffset, 'Text snippet:', targetText);
      
      // Find the text node that contains our target offset
      const walker = doc.createTreeWalker(
        body,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let currentOffset = 0;
      let targetNode = null;
      let node;
      
      while (node = walker.nextNode()) {
        const nodeText = node.textContent || '';
        const nodeLength = nodeText.length;
        
        if (currentOffset + nodeLength >= targetOffset) {
          targetNode = node;
          break;
        }
        
        currentOffset += nodeLength;
      }
      
      if (targetNode && targetNode.parentElement) {
        console.log('Found target node, scrolling to element');
        
        // Scroll the element into view
        targetNode.parentElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        
        // Additional scroll adjustment to center better
        setTimeout(() => {
          const elementRect = targetNode.parentElement!.getBoundingClientRect();
          const viewportHeight = iframe.contentWindow?.innerHeight || 600;
          const scrollAdjustment = elementRect.top - (viewportHeight / 2);
          
          if (iframe.contentWindow) {
            iframe.contentWindow.scrollBy({
              top: scrollAdjustment,
              behavior: 'smooth'
            });
          }
        }, 100);
      } else {
        console.warn('Could not find target text node, falling back to percentage-based scrolling');
        
        // Fallback to percentage-based scrolling
        const bodyHeight = body.scrollHeight;
        const viewportHeight = iframe.contentWindow?.innerHeight || 600;
        const targetScrollTop = Math.max(0, (textPosition * bodyHeight) - (viewportHeight / 2));
        
        iframe.contentWindow?.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
      }
      
    } catch (error) {
      console.error('Error scrolling to offset:', error);
    }
  };

  const highlightSearchResultAtCurrentLocation = async (searchTerm: string) => {
    if (!renditionRef.current || !searchTerm) {
      console.warn('No rendition or search term provided for highlighting');
      return;
    }
    
    console.log('Highlighting search term at current location:', searchTerm);
    
    try {
      // Get the current section iframe
      const iframe = renditionRef.current.manager.container.querySelector('iframe');
      if (!iframe || !iframe.contentDocument) {
        console.warn('No current section iframe found');
        return;
      }
      
      const doc = iframe.contentDocument;
      const body = doc.body;
      
      if (!body) {
        console.warn('No body found in iframe');
        return;
      }
      
      // Remove any existing search highlights
      const existingHighlights = body.querySelectorAll('.search-highlight');
      existingHighlights.forEach((highlight: Element) => {
        const parent = highlight.parentNode;
        if (parent) {
          parent.replaceChild(doc.createTextNode(highlight.textContent || ''), highlight);
          parent.normalize();
        }
      });
      
      // Find and highlight all instances of the search term
      const walker = doc.createTreeWalker(
        body,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      const textNodes: Node[] = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.trim().length > 0) {
          textNodes.push(node);
        }
      }
      
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let highlightCount = 0;
      let firstHighlight: Element | null = null;
      
      textNodes.forEach(textNode => {
        const text = textNode.textContent || '';
        if (regex.test(text)) {
          const parent = textNode.parentNode;
          if (parent) {
            // Create highlighted version
            const highlightedHTML = text.replace(regex, (match) => {
              highlightCount++;
              return `<span class="search-highlight" style="background-color: #fef08a; color: #000; padding: 1px 2px; border-radius: 2px; box-shadow: 0 0 3px rgba(0,0,0,0.1);">${match}</span>`;
            });
            
            // Replace the text node with highlighted content
            const wrapper = doc.createElement('span');
            wrapper.innerHTML = highlightedHTML;
            parent.replaceChild(wrapper, textNode);
            
            // Store reference to first highlight for potential scrolling
            if (!firstHighlight) {
              firstHighlight = wrapper.querySelector('.search-highlight');
            }
          }
        }
      });
      
      console.log(`Added ${highlightCount} search highlights`);
      
      // Optional: Scroll to the first highlight if it's not visible
      if (firstHighlight && iframe.contentWindow) {
        setTimeout(() => {
          const highlightRect = firstHighlight!.getBoundingClientRect();
          const viewportHeight = iframe.contentWindow!.innerHeight;
          
          // If the highlight is not in the visible area, scroll to it
          if (highlightRect.top < 0 || highlightRect.bottom > viewportHeight) {
            firstHighlight!.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }
        }, 200);
      }
      
    } catch (error) {
      console.error('Error highlighting search results:', error);
    }
  };

  // Highlight management functions
  const deleteHighlight = (highlightId: string) => {
    // Remove from epub.js annotations
    try {
      // Find the annotation with the matching highlight ID
      const existingAnnotations = renditionRef.current.annotations._annotations || {};
      Object.keys(existingAnnotations).forEach(key => {
        const annotation = existingAnnotations[key];
        if (annotation && annotation.data && annotation.data.highlightId === highlightId) {
          renditionRef.current.annotations.remove(key);
          console.log('Removed highlight annotation:', key, highlightId);
        }
      });
    } catch (error) {
      console.error('Error removing highlight annotation:', error);
    }

    // Remove from metadata
    BookMetadataManager.removeHighlight(book.id, highlightId);
    
    // Update local state
    const newHighlights = state.highlights.filter(h => h.id !== highlightId);
    setState(prev => ({ ...prev, highlights: newHighlights }));
    highlightsRef.current = newHighlights;
    
    // Force a visual refresh of the current page to immediately remove the highlight
    if (renditionRef.current) {
      try {
        const currentLocation = renditionRef.current.currentLocation();
        if (currentLocation && currentLocation.start) {
          // Re-render the current page to remove the deleted highlight visually
          renditionRef.current.display(currentLocation.start.cfi).then(() => {
            console.log('Refreshed page after highlight deletion');
            // Restore remaining highlights after the refresh
            setTimeout(() => {
              restoreHighlightsOnCurrentPage();
            }, 200);
          }).catch((error: any) => {
            console.error('Error refreshing page after highlight deletion:', error);
          });
        }
      } catch (error) {
        console.error('Error getting current location for refresh:', error);
      }
    }
  };

  // just debounce call to restoreHighlightsOnCurrentPage
  const debouncedRestoreHighlights = () => {
    // clear any existing timeout
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current);
    }
    
    // wait some time for navigation to complete before showing page highlights
    // TODO: this is a crude way of dealing with the problem
    // look into a promises-based approach
    restoreTimeoutRef.current = window.setTimeout(() => {
      restoreHighlightsOnCurrentPage();
    }, 150);
  };

  const restoreHighlightsOnCurrentPage = async () => {
    if (!renditionRef.current) return;
    
    // Get current highlights
    const highlights = highlightsRef.current;
    
    // Early exit if no highlights exist
    if (highlights.length === 0) {
      console.log('No highlights to restore');
      return;
    }
    
    // Get current location to check if any highlights are on this page
    const currentLocation = renditionRef.current.currentLocation();
    if (!currentLocation || !currentLocation.start) {
      console.log('No current location available');
      return;
    }
    
    // Filter highlights that might be on the current page
    const currentPageHighlights = highlights.filter(highlight => {
      // Simple check: if the highlight CFI starts with the same chapter path
      const highlightChapter = highlight.cfi.split('!')[0];
      const currentChapter = currentLocation.start.cfi.split('!')[0];
      return highlightChapter === currentChapter;
    });
    
    if (currentPageHighlights.length === 0) {
      console.log('No highlights on current page');
      return;
    }
    
    console.log(`Restoring ${currentPageHighlights.length} highlights on current page`);
    
    // Clear any existing search annotations first - only clear search highlights
    try {
      const existingAnnotations = renditionRef.current.annotations._annotations || {};
      Object.keys(existingAnnotations).forEach(key => {
        // Only remove search highlights, not user highlights
        if (key.startsWith('search-highlight-')) {
          renditionRef.current.annotations.remove(key);
        }
      });
      console.log('Cleared existing search annotations');
    } catch (error) {
      console.warn('Error clearing existing search annotations:', error);
    }
    
    for (const highlight of currentPageHighlights) {
      try {
        console.log('Restoring highlight:', highlight.id, highlight.cfi);
        
        // Enhanced check if this highlight is already annotated
        const existingAnnotations = renditionRef.current.annotations._annotations || {};
        const alreadyExists = Object.keys(existingAnnotations).some(key => {
          const annotation = existingAnnotations[key];
          // Check both by highlightId and by CFI to catch duplicates
          return annotation && annotation.data && annotation.data.highlightId === highlight.id;
        });
        
        // Also check if there's already an annotation at this exact CFI
        const cfiAlreadyExists = Object.keys(existingAnnotations).some(key => {
          const annotation = existingAnnotations[key];
          return annotation && annotation.cfiRange === highlight.cfi && annotation.type === 'highlight';
        });
        
        if (alreadyExists || cfiAlreadyExists) {
          console.log('Highlight already exists, skipping:', highlight.id);
          continue;
        }
        
        // Create annotation with the highlight ID as callback data
        renditionRef.current.annotations.add(
          'highlight',
          highlight.cfi,
          {
            fill: getHighlightColor(highlight.colour),
            fillOpacity: 0.3,
            mixBlendMode: 'multiply'
          },
          null,
          null,
          { highlightId: highlight.id } // Pass highlight ID as callback data
        );
        
        console.log('Added highlight annotation for:', highlight.id);
        
      } catch (error) {
        console.error('Error restoring highlight:', highlight.id, error);
      }
    }
    
    // Add click handlers for highlights
    setTimeout(() => {
      addHighlightClickHandlers();
    }, 200);
  };

  const addHighlightClickHandlers = () => {
    if (!renditionRef.current) return;
    
    const iframe = renditionRef.current.manager.container.querySelector('iframe');
    if (!iframe || !iframe.contentDocument) return;
    
    // Listen for clicks on highlighted elements
    const highlightElements = iframe.contentDocument.querySelectorAll('[data-annotation-id]');
    highlightElements.forEach((element: Element) => {
      element.addEventListener('click', (e) => {
        e.stopPropagation();
        const annotationId = element.getAttribute('data-annotation-id');
        if (annotationId) {
          // Find the annotation data
          const annotation = renditionRef.current.annotations._annotations[annotationId];
          if (annotation && annotation.data && annotation.data.highlightId) {
            const highlightId = annotation.data.highlightId;
            const highlight = state.highlights.find(h => h.id === highlightId);
            if (highlight) {
              // Show prompt to add/edit note
              const existingNote = highlight.note || '';
              const highlightPreview = highlight.text.substring(0, 100) + (highlight.text.length > 100 ? '...' : '');
              const noteText = prompt(
                `Add a note to this highlight:\n\n"${highlightPreview}"\n\nNote:`,
                existingNote
              );
              
              if (noteText !== null) { // User didn't cancel
                // Update highlight with note
                const updatedHighlight = { ...highlight, note: noteText.trim(), updatedAt: new Date() };
                
                // Update in metadata
                BookMetadataManager.updateHighlight(book.id, highlight.id, { note: noteText.trim() });
                
                // Update local state
                const updatedHighlights = state.highlights.map(h => 
                  h.id === highlightId ? updatedHighlight : h
                );
                setState(prev => ({ ...prev, highlights: updatedHighlights }));
                highlightsRef.current = updatedHighlights;
                
                console.log('Note added to highlight:', noteText.trim());
              }
            }
          }
        }
      });
    });
  };

  // TODO: more colour options
  const getHighlightColor = (color: Highlight['colour']) => {
    switch (color) {
      case 'yellow': return '#fef08a';
      default: return '#fef08a';
    }
  };

  const addNote = () => {
    if (!renditionRef.current || !selectedText || !currentNote.trim()) return;

    const selection = renditionRef.current.getRange();
    if (!selection) return;

    const note: Note = {
      id: Date.now().toString(),
      bookId: book.id,
      cfiRange: selection.toString(),
      content: currentNote,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // save using metadata manager
    BookMetadataManager.addNote(book.id, note);
    
    // update local state
    const newNotes = [...state.notes, note];
    setState(prev => ({ ...prev, notes: newNotes }));

    setCurrentNote('');
    setSelectedText('');
    setShowNoteDialog(false);
  };

  const deleteNote = (noteId: string) => {
    // remove using metadata manager
    BookMetadataManager.removeNote(book.id, noteId);
    
    // update local state
    const newNotes = state.notes.filter(n => n.id !== noteId);
    setState(prev => ({ ...prev, notes: newNotes }));
  };

  // summarise content up to current page with progressive chunk processing
  const summarizeSoFar = async () => {
    if (!textChunks.length) {
      alert('No text chunks available. Please wait for the book to load completely.');
      return;
    }

    setIsSummarizing(true);
    
    try {
      // Get current page location
      const currentLocation = renditionRef.current?.currentLocation();
      if (!currentLocation) {
        alert('Unable to determine current page location.');
        return;
      }

      const currentPageCfi = currentLocation.start.cfi;
      const currentSpineIndex = currentLocation.start.index || 0;

      // filter chunks that come before or at the current page
      const chunksUpToCurrentPage = textChunks.filter((chunk, index) => {
        // if chunk has pageLocation, compare it with current location
        if (chunk.pageLocation && renditionRef.current?.book?.locations) {
          try {
            const chunkPageIndex = renditionRef.current.book.locations.locationFromCfi(chunk.pageLocation);
            const currentPageIndex = renditionRef.current.book.locations.locationFromCfi(currentPageCfi);
            
            if (chunkPageIndex >= 0 && currentPageIndex >= 0) {
              return chunkPageIndex <= currentPageIndex;
            }
          } catch (error) {
            console.error(error);
          }
        }
        
        return chunk.spineIndex <= currentSpineIndex;
      });

      
      if (chunksUpToCurrentPage.length === 0) {
        alert('No content found up to current page.');
        return;
      }

      // group chunks by spine index (chapters/sections)
      const chunksBySpine = new Map<number, TextChunk[]>();
      chunksUpToCurrentPage.forEach(chunk => {
        if (!chunksBySpine.has(chunk.spineIndex)) {
          chunksBySpine.set(chunk.spineIndex, []);
        }
        chunksBySpine.get(chunk.spineIndex)!.push(chunk);
      });

      const spineIndices = Array.from(chunksBySpine.keys()).sort((a, b) => a - b);

      const sectionSummaries: string[] = [];
      let processedSections = 0;

      // process each section progressively
      for (const spineIndex of spineIndices) {
        const sectionChunks = chunksBySpine.get(spineIndex)!;
        const sectionId = `${book.id}_spine_${spineIndex}`;
        
        // check if this section is already summarised
        let cachedSummary = SummaryCacheManager.getCachedSummary(book.id, sectionId);
        
        if (cachedSummary) {
          sectionSummaries.push(cachedSummary.summary);
        } else {
          // combine all chunks in this section
          const sectionText = sectionChunks.map(chunk => chunk.text).join('\n\n');
          // chunk summarisation
          const response = await fetch('http://localhost:8000/summarize-chunk', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chunk_text: sectionText,
              book_title: book.title,
              chunk_id: sectionId,
              is_continuation: spineIndex > 0
            })
          });

          if (!response.ok) {
            continue;
          }

          const result = await response.json();
          const summary = result.summary;
          
          // cache the summary
          const chunkSummary: ChunkSummary = {
            chunkId: sectionId,
            spineIndex,
            href: sectionChunks[0]?.href || '',
            summary,
            createdAt: new Date(),
            tokenCount: Math.ceil(sectionText.length / 4) // Rough estimate
          };
          
          SummaryCacheManager.cacheSummary(book.id, chunkSummary);
          sectionSummaries.push(summary);
        }
        
        processedSections++;
      }

      // combine all section summaries
      const finalSummary = sectionSummaries.length > 1 
        ? sectionSummaries.join('\n\n')
        : sectionSummaries[0] || 'No summary available.';
      
      setCurrentSummary(finalSummary);
      setShowSummaryModal(true);
    } catch (error) {
      console.error(error);
      alert(`Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  // function to ask a question with book content as context
  const askQuestion = async () => {
    if (!qaQuestion.trim()) {
      alert('Please enter a question.');
      return;
    }

    if (!textChunks.length) {
      alert('No text chunks available. Please wait for the book to load completely.');
      return;
    }

    setIsAsking(true);
    
    try {
      // determine which chunks to use based on context scope
      // for RAG, we send all available chunks and let semantic search find the best ones
      const chunksToUse = textChunks;
      // generate a unique book ID using title
      // TODO: crude - relies on there being book of all unique titles in the library
      const bookId = book.title || 'unknown-book';
      
      // calculate current page for up_to_page parameter
      let upToPage: number | undefined = undefined;
      if (qaContextScope === 'pages_so_far') {
        const currentLocation = renditionRef.current?.currentLocation();
        if (currentLocation && renditionRef.current?.book?.locations) {
          try {
            const currentPageCfi = currentLocation.start.cfi;
            upToPage = renditionRef.current.book.locations.locationFromCfi(currentPageCfi);
          } catch (error) {
            console.error(error);
          }
        }
      }

      // Call the new RAG endpoint
      const response = await fetch('http://localhost:8000/qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_question: qaQuestion,
          book_id: bookId,
          chunks: chunksToUse.map(chunk => chunk.text),
          book_title: book.title,
          up_to_page: upToPage,
          top_k: 5  // number of similar chunks to retrieve. TODO: some set of super-user settings to change such params
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(errorText);
        throw new Error(`Failed to get answer: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const answer = result.answer;
      
      console.log('RAG Q&A Response:', {
        question: qaQuestion,
        answer: answer.substring(0, 100) + '...',
        chunks_used: result.chunks_used,
        book_id: result.book_id,
        up_to_page: result.up_to_page,
        similarity_scores: result.similarity_scores,
        top_similarity: result.similarity_scores?.length > 0 ? Math.max(...result.similarity_scores).toFixed(3) : 'N/A'
      });
      
      // log that RAG found relevant content despite any metadata in input
      if (result.similarity_scores?.length > 0) {
        const avgSimilarity = (result.similarity_scores.reduce((a: number, b: number) => a + b, 0) / result.similarity_scores.length).toFixed(3);
        console.log(`✅ RAG semantic search found ${result.chunks_used} relevant chunks (avg similarity: ${avgSimilarity})`);
      }
      // add to conversation history
      const newQA = {
        question: qaQuestion,
        answer: answer,
        timestamp: new Date()
      };
      
      setQaHistory(prev => [...prev, newQA]);
      setQaQuestion('');
    } catch (error) {
      alert(`Failed to get answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAsking(false);
    }
  };

  // IMP - build text chunks and map them to pages
  const buildTextChunks = async () => {
    if (!bookRef.current) return;

    try {
      await bookRef.current.ready;
      const spineItems = bookRef.current.spine.spineItems;
      
      if (!spineItems || spineItems.length === 0) {
        return;
      }

      const allChunks: TextChunk[] = [];

      // build chunks for each spine item (filter out metadata sections)
      for (let spineIndex = 0; spineIndex < spineItems.length; spineIndex++) {
        const item = spineItems[spineIndex];
        
        // skip metadata sections (table of contents, copyright, etc.)
        const href = item.href.toLowerCase();
        if (href.includes('toc') || 
            href.includes('copyright') || 
            href.includes('titlepage') || 
            href.includes('cover') ||
            href.includes('nav') ||
            href.includes('contents') ||
            href.includes('frontmatter') ||
            href.includes('backmatter')) {
          continue;
        }
        
        try {
          const section = bookRef.current.spine.get(item.href);
          if (!section) continue;

          await section.load(bookRef.current.load.bind(bookRef.current));
          const doc = section.document;
          if (!doc || !doc.body) continue;

          const textContent = doc.body.textContent || doc.body.innerText || '';
          if (!textContent || textContent.trim() === '') continue;
          
          // additional filter - skip sections with very little content (likely metadata)
          if (textContent.trim().length < 200) {
            continue;
          }
          // enhanced content-based filtering - check if content contains metadata keywords
          const contentLower = textContent.toLowerCase();
          if (contentLower.includes('table of contents') ||
              contentLower.includes('translator\'s preface') ||
              contentLower.includes('contents') && contentLower.includes('part i') ||
              contentLower.includes('project gutenberg') && textContent.length < 2000 ||
              contentLower.includes('copyright') && textContent.length < 1000 ||
              (contentLower.includes('contents') && contentLower.includes('chapter') && textContent.length < 1500)) {
            continue;
          }
          // create chunks for this section
          const sectionChunks = createChunksForSection(textContent, item.href, spineIndex);
          // add to global chunk list
          sectionChunks.forEach(chunk => {
            const globalChunkIndex = allChunks.length;
            allChunks.push({
              ...chunk,
              chunkIndex: globalChunkIndex
            });
          });
        } catch (error) {
          console.error(error);
        }
      }
      setTextChunks(allChunks);
      
      await mapChunksToPages(allChunks);
      
    } catch (error) {
      console.error(error);
    }
  };
  // create chunks for a single section
  const createChunksForSection = (textContent: string, href: string, spineIndex: number): TextChunk[] => {
    const chunks: TextChunk[] = [];
    const chunkSize = 500;
    const overlap = 50;
    // split by paragraphs first
    const paragraphs = textContent.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
    let currentChunk = '';
    let currentOffset = 0;
    let chunkIndex = 0;
    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
        // save current chunk
        chunks.push({
          id: `${href}-chunk-${chunkIndex}`,
          text: currentChunk.trim(),
          href: href,
          spineIndex: spineIndex,
          chunkIndex: chunkIndex,
          startOffset: currentOffset - currentChunk.length,
          endOffset: currentOffset
        });
        // start new chunk with overlap
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + ' ' + paragraph;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk.length > 0 ? ' ' : '') + paragraph;
      }
      currentOffset += paragraph.length + 1; // + 1 for the space/newline
    }
    // add the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: `${href}-chunk-${chunkIndex}`,
        text: currentChunk.trim(),
        href: href,
        spineIndex: spineIndex,
        chunkIndex: chunkIndex,
        startOffset: currentOffset - currentChunk.length,
        endOffset: currentOffset
      });
    }
    return chunks;
  };
  // map chunks to their actual page locations by rendering them
  const mapChunksToPages = async (chunks: TextChunk[]) => {
    if (!renditionRef.current) return;
    const pageToChunkMap = new Map<string, number[]>();
    const chunkToPageMap = new Map<number, string>();
    try {
      // ensure the book is ready and has locations
      await renditionRef.current.book.ready;
      // generate locations if they don't exist
      if (!renditionRef.current.book.locations.length()) {
        await renditionRef.current.book.locations.generate(1024);
      }
      // for each chunk, find which page/location it belongs to
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          // generate a CFI for the chunk's position
          const chunkStartCfi = await generateCfiForChunk(chunk);
          if (chunkStartCfi) {
            // find the page that contains this CFI
            const pageIndex = renditionRef.current.book.locations.locationFromCfi(chunkStartCfi);
            if (pageIndex >= 0) {
              const pageLocation = renditionRef.current.book.locations.cfiFromLocation(pageIndex);
              if (pageLocation) {
                // update chunk with page location
                chunk.pageLocation = pageLocation;
                // update mappings
                chunkToPageMap.set(i, pageLocation);
                if (!pageToChunkMap.has(pageLocation)) {
                  pageToChunkMap.set(pageLocation, []);
                }
                pageToChunkMap.get(pageLocation)!.push(i);
              }
            }
          }
        } catch (error) {
          console.error(error);
        }
      }
      setTextChunks([...chunks]);
    } catch (error) {
      console.error(error);
    }
  };
  // generate a CFI for a chunk's position within a section
  const generateCfiForChunk = async (chunk: TextChunk): Promise<string | null> => {
    try {
      const section = bookRef.current.spine.get(chunk.href);
      if (!section) return null;

      await section.load(bookRef.current.load.bind(bookRef.current));
      const doc = section.document;
      if (!doc || !doc.body) return null;
      // find the text node that containst he chunk's start position
      const walker = doc.createTreeWalker(
        doc.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let currentOffset = 0;
      let targetNode = null;
      let nodeOffset = 0;
      let node;
      
      while (node = walker.nextNode()) {
        const nodeText = node.textContent || '';
        const nodeLength = nodeText.length;
        
        if (currentOffset + nodeLength >= chunk.startOffset) {
          targetNode = node;
          nodeOffset = chunk.startOffset - currentOffset;
          break;
        }
        
        currentOffset += nodeLength;
      }
      
      if (targetNode) {
        // generate CFI for this text node position
        const range = doc.createRange();
        range.setStart(targetNode, Math.min(nodeOffset, targetNode.textContent?.length || 0));
        range.setEnd(targetNode, Math.min(nodeOffset + 10, targetNode.textContent?.length || 0));
        // use epub.js to generate the CFI
        const cfi = section.cfiFromRange(range);
        return cfi;
      }
      return null;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  return (
    <>
      <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                {sidebarContent === 'toc' && 'Table of Contents'}
                {sidebarContent === 'search' && 'Search'}
                {sidebarContent === 'notes' && 'Notes'}
                {sidebarContent === 'highlights' && 'Highlights'}
                {sidebarContent === 'settings' && 'Settings'}
                {sidebarContent === 'summary' && 'Summary'}
                {sidebarContent === 'qa' && 'Q&A'}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSidebar(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Sidebar Navigation */}
            <div className="flex space-x-1">
              <Button
                variant={sidebarContent === 'toc' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('toc')}
              >
                <BookOpen className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'search' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('search')}
              >
                <Search className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'highlights' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('highlights')}
              >
                <Highlighter className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'notes' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('notes')}
              >
                <StickyNote className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'settings' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('settings')}
              >
                <Settings className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'summary' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('summary')}
              >
                <Brain className="w-4 h-4" />
              </Button>
              <Button
                variant={sidebarContent === 'qa' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSidebarContent('qa')}
              >
                <MessageCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {sidebarContent === 'toc' && (
              <div className="space-y-2">
                {state.toc.map((item) => (
                  <div key={item.id}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-left"
                      onClick={() => goToChapter(item.href)}
                    >
                      {item.label}
                    </Button>
                    {item.subitems?.map((subitem) => (
                      <Button
                        key={subitem.id}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-left ml-4"
                        onClick={() => goToChapter(subitem.href)}
                      >
                        {subitem.label}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {sidebarContent === 'search' && (
              <div className="space-y-4">
                <div className="flex space-x-2">
                  <Input
                    placeholder="Search in book..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isSearching && !state.isLoading && performSearch()}
                    disabled={state.isLoading}
                  />
                  <Button onClick={performSearch} disabled={isSearching || state.isLoading}>
                    {isSearching ? (
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                
                <div className="space-y-2">
                  {state.isLoading && (
                    <p className="text-sm text-gray-500">Loading book...</p>
                  )}
                  {!state.isLoading && !isSearching && state.searchResults.length === 0 && searchQuery && (
                    <p className="text-sm text-gray-500">No results found for "{searchQuery}"</p>
                  )}
                  {!state.isLoading && !isSearching && state.searchResults.map((result, index) => (
                    <Card 
                      key={index} 
                      className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => goToSearchResult(result)}
                    >
                      <p 
                        className="text-sm"
                        dangerouslySetInnerHTML={{
                          __html: highlightSearchTerms(result.excerpt, result.terms)
                        }}
                      />
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {sidebarContent === 'highlights' && (
              <div className="space-y-3">
                {state.highlights.map((highlight) => (
                  <Card 
                    key={highlight.id} 
                    className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors border-l-4 ${
                      highlight.colour === 'yellow' ? 'border-yellow-400' :
                      'border-yellow-400'
                    }`}
                    onClick={() => {
                      if (renditionRef.current) {
                        renditionRef.current.display(highlight.cfi);
                        setShowSidebar(false);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800 mb-1">
                          "{highlight.text.length > 100 ? highlight.text.substring(0, 100) + '...' : highlight.text}"
                        </p>
                        {highlight.note && (
                          <p className="text-sm text-gray-600 italic mb-2">
                            {highlight.note}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          {new Date(highlight.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-1 ml-2">
                        <div className={`w-3 h-3 rounded-full ${
                          highlight.colour === 'yellow' ? 'bg-yellow-300' :                          
                          'bg-yellow-300'
                        }`} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newNote = prompt('Add a note to this highlight:', highlight.note || '');
                            if (newNote !== null) {
                              const updatedHighlights = state.highlights.map(h => 
                                h.id === highlight.id ? { ...h, note: newNote } : h
                              );
                              setState(prev => ({ ...prev, highlights: updatedHighlights }));
                              highlightsRef.current = updatedHighlights;
                              BookMetadataManager.updateHighlight(book.id, highlight.id, { note: newNote });
                            }
                          }}
                        >
                          <FileText className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHighlight(highlight.id);
                          }}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
                {state.highlights.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">
                    No highlights yet. Select text to create your first highlight.
                  </p>
                )}
              </div>
            )}

            {sidebarContent === 'notes' && (
              <div className="space-y-3">
                {state.notes.map((note) => (
                  <Card key={note.id} className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm">{note.content}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          {new Date(note.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteNote(note.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {sidebarContent === 'settings' && (
              <div className="space-y-6">
                {/* Font Size */}
                <div>
                  <label className="block text-sm font-medium mb-2">Font Size</label>
                  <Input
                    type="range"
                    min="12"
                    max="24"
                    value={settings.fontSize}
                    onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                  />
                  <span className="text-sm text-gray-600">{settings.fontSize}px</span>
                </div>

                {/* Font Family */}
                <div>
                  <label className="block text-sm font-medium mb-2">Font Family</label>
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => setSettings(prev => ({ ...prev, fontFamily: e.target.value }))}
                    className="w-full p-2 border border-gray-300 rounded-md"
                  >
                    <option value="serif">Serif</option>
                    <option value="sans-serif">Sans Serif</option>
                    <option value="monospace">Monospace</option>
                  </select>
                </div>

                {/* Theme */}
                <div>
                  <label className="block text-sm font-medium mb-2">Theme</label>
                  <div className="space-y-2">
                    {(['light', 'dark', 'sepia'] as const).map((theme) => (
                      <Button
                        key={theme}
                        variant={settings.theme === theme ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setSettings(prev => ({ ...prev, theme }))}
                      >
                        {theme.charAt(0).toUpperCase() + theme.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Columns */}
                <div>
                  <label className="block text-sm font-medium mb-2">Layout</label>
                  <div className="space-y-2">
                    <Button
                      variant={settings.columns === 1 ? 'default' : 'outline'}
                      className="w-full"
                      onClick={() => setSettings(prev => ({ ...prev, columns: 1 }))}
                    >
                      Single Column
                    </Button>
                    <Button
                      variant={settings.columns === 2 ? 'default' : 'outline'}
                      className="w-full"
                      onClick={() => setSettings(prev => ({ ...prev, columns: 2 }))}
                    >
                      Two Columns
                    </Button>
                  </div>
                </div>

                {/* Line Height */}
                <div>
                  <label className="block text-sm font-medium mb-2">Line Height</label>
                  <Input
                    type="range"
                    min="1.2"
                    max="2.0"
                    step="0.1"
                    value={settings.lineHeight}
                    onChange={(e) => setSettings(prev => ({ ...prev, lineHeight: parseFloat(e.target.value) }))}
                  />
                  <span className="text-sm text-gray-600">{settings.lineHeight}</span>
                </div>

                {/* RAG Text Chunks */}
                <div>
                  <label className="block text-sm font-medium mb-2">Text Chunks for RAG</label>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={buildTextChunks}
                    >
                      Build Text Chunks ({textChunks.length} chunks)
                    </Button>
                    <p className="text-xs text-gray-500">
                      Build text chunks for Retrieval-Augmented Generation (RAG) use
                    </p>
                  </div>
                </div>
              </div>
            )}

            {sidebarContent === 'summary' && (
              <div className="space-y-4">
                {currentSummary ? (
                  <div className="bg-gray-50 rounded-lg p-4 border">
                    <div className="text-gray-800 leading-relaxed whitespace-pre-wrap text-sm">
                      {currentSummary}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Brain className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-sm text-gray-500 mb-4">
                      No summary available yet.
                    </p>
                    <p className="text-xs text-gray-400">
                      Click "Summarise so far" in the toolbar to generate a summary of the content up to your current reading position.
                    </p>
                  </div>
                )}
              </div>
            )}

            {sidebarContent === 'qa' && (
              <div className="space-y-4">
                {/* Context Scope Selector */}
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <label className="block text-sm font-medium text-blue-900 mb-2">Context Scope</label>
                  <div className="space-y-2">
                    <Button
                      variant={qaContextScope === 'pages_so_far' ? 'default' : 'outline'}
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setQaContextScope('pages_so_far')}
                    >
                      Pages read so far
                    </Button>
                    <Button
                      variant={qaContextScope === 'complete_book' ? 'default' : 'outline'}
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setQaContextScope('complete_book')}
                    >
                      Complete book
                    </Button>
                  </div>
                </div>

                {/* Question Input */}
                <div className="space-y-2">
                  <Input
                    placeholder="Ask a question about the book..."
                    value={qaQuestion}
                    onChange={(e) => setQaQuestion(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !isAsking) {
                        askQuestion();
                      }
                    }}
                    disabled={isAsking}
                  />
                  <Button
                    onClick={askQuestion}
                    disabled={isAsking || !qaQuestion.trim() || !textChunks.length}
                    className="w-full"
                  >
                    {isAsking ? 'Asking...' : 'Ask Question'}
                  </Button>
                </div>

                {/* Conversation History */}
                <div className="space-y-3">
                  {qaHistory.length === 0 ? (
                    <div className="text-center py-8">
                      <MessageCircle className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                      <p className="text-sm text-gray-500 mb-2">
                        No questions asked yet.
                      </p>
                      <p className="text-xs text-gray-400">
                        Ask questions about the book content and get AI-powered answers based on the text.
                      </p>
                    </div>
                  ) : (
                    qaHistory.map((qa, index) => (
                      <div key={index} className="space-y-2">
                        {/* Question */}
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                          <div className="flex items-start space-x-2">
                            <MessageCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="text-sm text-blue-900 font-medium">
                              {qa.question}
                            </div>
                          </div>
                          <div className="text-xs text-blue-600 mt-1">
                            {qa.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                        
                        {/* Answer */}
                        <div className="bg-gray-50 rounded-lg p-3 border ml-4">
                          <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                            {qa.answer}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              <Menu className="w-4 h-4" />
            </Button>
            
            <div className="text-sm text-gray-600">
              <span className="font-medium">{book.title}</span>
              {book.author && <span> by {book.author}</span>}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={summarizeSoFar}
              disabled={isSummarizing || !textChunks.length}
              title="Summarize content up to current page"
            >
              <Brain className="w-4 h-4 mr-1" />
              {isSummarizing ? 'Summarizing...' : 'Summarise so far'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Reader Container */}
        <div className="flex-1 relative">
          <div 
            style={{ height: '100%', width: '100%' }} 
            tabIndex={-1}
            onKeyDown={(e: React.KeyboardEvent) => {
              const target = e.target as HTMLElement;
              if (target instanceof HTMLInputElement || 
                  target instanceof HTMLTextAreaElement ||
                  target.contentEditable === 'true' ||
                  target.closest('input') ||
                  target.closest('textarea')) {
                // if typing in an input field, prevent ReactReader from handling arrow keys
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.stopPropagation();
                }
              }
            }}
          >
            <ReactReader
              url={book.filePath}
              location={location || 0} // use 0 for beginning of book if no location set
              locationChanged={(loc: string) => {
                setLocation(loc);
                // update state with current location info
                if (renditionRef.current) {
                  const currentLocation = renditionRef.current.currentLocation();
                  if (currentLocation && currentLocation.start) {
                    const currentPage = currentLocation.start.displayed?.page || 1;
                    const progress = currentLocation.start.percentage || 0;
                    // location changed - removed logging
                    setState(prev => ({
                      ...prev,
                      currentLocation: currentLocation.start.cfi,
                      currentPage,
                      progress: Math.round(progress * 100)
                    }));
                    // save progress using metadata manager
                    BookMetadataManager.updateProgress(book.id, currentLocation.start.cfi, Math.round(progress * 100));
                    // also update the library entry for backwards compatibility
                    const updatedBook = {
                      ...book,
                      currentLocation: currentLocation.start.cfi,
                      progress: Math.round(progress * 100),
                      lastRead: new Date()
                    };
                    const library = JSON.parse(localStorage.getItem('libra-books') || '[]');
                    const index = library.findIndex((b: EpubBook) => b.id === book.id);
                    if (index !== -1) {
                      library[index] = updatedBook;
                      localStorage.setItem('libra-books', JSON.stringify(library));
                    }
                  }
                }
              }}
              epubInitOptions={{
                openAs: 'epub'
              }}
              getRendition={onRenditionReady}
              swipeable={false}
            />
          </div>
          {/* Navigation Arrows */}
          <Button
            ref={prevButtonRef}
            variant="ghost"
            size="lg"
            className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white"
            onClick={() => {
              if (renditionRef.current) {
                try {
                  const result = renditionRef.current.prev();
                  if (result && typeof result.then === 'function') {
                    result.then(() => {
                      ;
                    }).catch((error: any) => {
                      console.error(error);
                    });
                  }
                } catch (error) {
                  console.error(error);
                }
              } else {
                console.error('Previous button clicked but renditionRef.current is null');
              }
            }}
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <Button
            ref={nextButtonRef}
            variant="ghost"
            size="lg"
            className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/80 hover:bg-white"
            onClick={() => {
              if (renditionRef.current) {
                try {
                  const result = renditionRef.current.next();
                  // If next() returns a promise, handle it
                  if (result && typeof result.then === 'function') {
                    result.then(() => {
                      console.log('next() navigation completed successfully');
                    }).catch((error: any) => {
                      console.error('next() navigation failed:', error);
                    });
                  }
                } catch (error) {
                  console.error('Error calling next() from button:', error);
                }
              } else {
                console.error('Next button clicked but renditionRef.current is null');
              }
            }}
          >
            <ChevronRight className="w-6 h-6" />
          </Button>

          {/* Note Dialog */}
          {showNoteDialog && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
              <Card className="w-96 p-6">
                <h3 className="font-semibold mb-4">Add Note</h3>
                <p className="text-sm text-gray-600 mb-3">Selected text: "{selectedText}"</p>
                <textarea
                  className="w-full p-3 border border-gray-300 rounded-md resize-none"
                  rows={4}
                  placeholder="Enter your note..."
                  value={currentNote}
                  onChange={(e) => setCurrentNote(e.target.value)}
                />
                <div className="flex space-x-2 mt-4">
                  <Button onClick={addNote} disabled={!currentNote.trim()}>
                    Save Note
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowNoteDialog(false);
                      setCurrentNote('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
        {/* Bottom Progress Bar */}
        <div className="bg-white border-t border-gray-200 px-4 py-2">
          <div className="w-full bg-gray-200 rounded-full h-1">
            <div
              className="bg-blue-600 h-1 rounded-full transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
      {showSummaryModal && (
        <SummaryModal
          isOpen={showSummaryModal}
          onClose={() => setShowSummaryModal(false)}
          summary={currentSummary}
        />
      )}
    </>
  );
}
