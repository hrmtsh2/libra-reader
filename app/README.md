# Libra Reader

A lightweight, modern e-reader application built with Tauri, React, and TypeScript. Libra Reader provides a clean, distraction-free reading experience for EPUB books with powerful features like highlighting, note-taking, and library management.

## Features

### 📚 Library Management
- Browse and organize your EPUB collection
- Recently read books tracking
- Search books by title or author
- Sorting options (title, author, recently read)

### 📖 Reading Experience
- Clean, responsive two-column layout
- Chapter navigation with table of contents
- Progress tracking with visual indicators
- Customizable reading settings (font size, theme, columns)

### 🔍 Search & Navigation
- Full-text search across open books
- Quick chapter navigation
- Bookmark and progress saving
- Keyboard shortcuts for navigation

### ✨ Highlighting & Notes
- Color-coded highlighting system (yellow, blue, green, pink)
- Add notes to highlights
- Highlight management panel
- Persistent highlight storage

### 🎨 Customization
- Multiple themes (light, dark, sepia)
- Adjustable font size and line height
- Single or two-column layout options
- Responsive design for different screen sizes

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Desktop Framework**: Tauri 2.0
- **Styling**: TailwindCSS + shadcn/ui components
- **EPUB Processing**: epub.js
- **Icons**: Lucide React
- **Build Tool**: Vite

## Prerequisites

Before running this application, make sure you have:

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd libra-reader
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run tauri dev
   ```

4. To build for production:
   ```bash
   npm run tauri build
   ```

## Usage

### Adding Books
1. Click the "Add Book" button in the library
2. Select an EPUB file from your system
3. The book will be added to your library with metadata extracted

### Reading
1. Click on any book in your library to open it
2. Use the sidebar to navigate chapters, search, view highlights, or adjust settings
3. Click and drag to select text for highlighting
4. Use arrow keys or click the navigation buttons to turn pages

### Highlighting
1. Select text while reading
2. Choose a highlight color from the popup menu
3. Optionally add notes to your highlights
4. View all highlights in the sidebar panel

### Settings
- **Font Size**: Adjust text size with +/- buttons
- **Theme**: Choose between light, dark, or sepia themes
- **Layout**: Switch between single and two-column layouts
- **Line Height**: Customize text spacing

## Project Structure

```
src/
├── components/
│   ├── ui/          # Reusable UI components (Button, Input, Card)
│   ├── library/     # Library management components
│   └── reader/      # EPUB reader components
├── types/           # TypeScript type definitions
├── lib/            # Utility functions
└── App.tsx         # Main application component
```

## Development

### Architecture
The application follows a clean component-based architecture:

- **Library Component**: Manages the book collection interface
- **EPUB Reader**: Handles book rendering and reading features
- **UI Components**: Reusable shadcn/ui-based components
- **State Management**: Local state with localStorage persistence

### Key Dependencies
- `epubjs`: EPUB file parsing and rendering
- `@tauri-apps/api`: Tauri native API access
- `tailwindcss`: Utility-first CSS framework
- `lucide-react`: Modern icon library
- `clsx` + `tailwind-merge`: Conditional CSS class handling

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [epub.js](https://github.com/futurepress/epub.js/) for EPUB parsing
- [Tauri](https://tauri.app/) for the desktop framework
- [shadcn/ui](https://ui.shadcn.com/) for the component library
- [TailwindCSS](https://tailwindcss.com/) for styling utilities
