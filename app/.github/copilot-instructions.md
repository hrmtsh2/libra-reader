# Libra Reader - Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is a Tauri-based e-reader application called "Libra Reader" built with:
- **Frontend**: React + TypeScript + TailwindCSS + shadcn/ui
- **Backend**: Tauri (Rust)
- **EPUB handling**: epub.js library
- **Styling**: TailwindCSS with custom design system

## Key Features
1. **EPUB Library Management**: Browse and organize EPUB files
2. **Reading Experience**: Two-column layout with pagination, chapter navigation
3. **Text Search**: Search across open books
4. **Highlighting System**: Color-coded highlights with notes
5. **Progress Tracking**: Save reading progress and bookmarks
6. **Settings**: Customizable fonts, themes, and layout options

## Architecture
- `src/types/index.ts` - Core TypeScript interfaces
- `src/components/ui/` - Reusable UI components (Button, Input, Card)
- `src/components/library/` - Library management components
- `src/components/reader/` - EPUB reader components
- `src/lib/utils.ts` - Utility functions including cn() for class merging

## Development Guidelines
1. Use TypeScript for all components
2. Follow React functional component patterns with hooks
3. Use TailwindCSS for styling with the shadcn/ui design system
4. Maintain consistent file structure and naming conventions
5. Store application state in localStorage for persistence
6. Handle EPUB files through epub.js library
7. Use Tauri APIs for file system operations

## Code Style
- Use functional components with TypeScript
- Prefer composition over inheritance
- Use custom hooks for complex state logic
- Follow shadcn/ui component patterns
- Use semantic HTML elements
- Implement proper error handling and loading states

## Testing Notes
- Test EPUB file loading and rendering
- Verify highlight and note functionality
- Check responsive design across different screen sizes
- Test keyboard navigation and accessibility features
