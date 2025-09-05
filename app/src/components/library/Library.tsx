import React, { useState, useEffect, SetStateAction } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { BookOpen, Plus, Search, MoreVertical, User, FileText } from 'lucide-react';
import { EpubBook } from '../../types';
import { MetadataMigration } from '../../lib/migration';

interface LibraryProps {
  books: EpubBook[];
  onSelectBook: (book: EpubBook) => void;
  onAddBook: () => void;
  onRemoveBook: (bookId: string) => void;
}

export const Library = ({
  books,
  onSelectBook,
  onAddBook,
  onRemoveBook
} : LibraryProps ) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'title' | 'author' | 'lastRead'>('lastRead');

  // Run migration on component mount
  useEffect(() => {
    if (MetadataMigration.needsMigration()) {
      console.log('Running metadata migration...');
      const stats = MetadataMigration.getMigrationStats();
      console.log('Migration stats:', stats);
      
      MetadataMigration.migrateAllBooks();
      
      // Optional: Clean up old storage after successful migration
      setTimeout(() => {
        MetadataMigration.cleanupOldStorage();
      }, 1000);
    }
  }, []);

  const filteredBooks = books
    .filter(book => 
      book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      book.author.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'author':
          return a.author.localeCompare(b.author);
        case 'lastRead':
          return (b.lastRead?.getTime() || 0) - (a.lastRead?.getTime() || 0);
        default:
          return 0;
      }
    });
    
  return (
    <div className="h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Libra Reader</h1>
            <p className="text-gray-600">Your personal e-book library</p>
          </div>
          <Button onClick={onAddBook} className="flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add Book</span>
          </Button>
        </div>

        {/* Search and Sort */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search books by title or author..."
              className="pl-10"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 bg-white rounded-md text-sm"
          >
            <option value="lastRead">Recently Read</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
        </div>
      </div>

      {/* Book Grid */}
      <div className="p-6">
        {filteredBooks.length === 0 ? (
          <div className="text-center py-12">
            {/* 'books' is the list of books in user's library */}
            {books.length === 0 ? (
              <div>
                <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-gray-900">No books in your library</h3>
                <p className="text-gray-600 mb-4">
                  Add your first EPUB book to get started
                </p>
                <Button onClick={onAddBook}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Book
                </Button>
              </div>
            ) : (
              <div>
                <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-gray-900">No books found</h3>
                <p className="text-gray-600">
                  Try adjusting your search terms
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredBooks.map((book) => (
              <Card
                key={book.id}
                className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105"
                onClick={() => onSelectBook(book)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {book.cover ? (
                        <img
                          src={book.cover}
                          alt={book.title}
                          className="w-full h-48 object-cover rounded-md mb-3"
                        />
                      ) : (
                        <div className="w-full h-48 bg-gray-100 rounded-md mb-3 flex items-center justify-center">
                          <BookOpen className="h-12 w-12 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveBook(book.id);
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardTitle className="text-lg leading-tight text-gray-900 overflow-hidden" style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const
                  }}>
                    {book.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    <div className="flex items-center text-sm text-gray-600">
                      <User className="h-3 w-3 mr-1" />
                      <span className="truncate">{book.author}</span>
                    </div>
                    
                    {book.progress !== undefined && book.progress > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Progress</span>
                          <span className="font-medium text-gray-900">{Math.round(book.progress)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div 
                            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${book.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    

                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-4">
            <span className="flex items-center">
              <FileText className="h-4 w-4 mr-1" />
              {books.length} book{books.length !== 1 ? 's' : ''}
            </span>

          </div>
          <div className="text-gray-500">
            Libra Reader v1.0.0 | Made with 🧠 (and some 🤖) by <a href="hrmtsh2.github.io">hrmtsh</a>
          </div>
        </div>
      </div>
    </div>
  );
};
