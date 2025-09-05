import React from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { StickyNote, X } from 'lucide-react';
import { Highlight } from '../../types';

interface HighlightToolbarProps {
  selectedText: string;
  onHighlight: (colour: Highlight['colour']) => void;
  onAddNote: () => void;
  onClose: () => void;
  position: { x: number; y: number };
  isVisible: boolean;
}

export const HighlightToolbar: React.FC<HighlightToolbarProps> = ({
  selectedText,
  onHighlight,
  onAddNote,
  onClose,
  position,
  isVisible
}) => {
  console.log('HighlightToolbar render:', { selectedText, position, isVisible });
  
  if (!isVisible || !selectedText) return null;

  const colours: { colour: Highlight['colour']; label: string; bgColour: string }[] = [
    { colour: 'yellow', label: 'Yellow', bgColour: 'bg-yellow-200' },
  ];

  return (
    <div 
      className="fixed z-50 transform -translate-x-1/2"
      style={{
        left: Math.min(Math.max(position.x, 100), window.innerWidth - 100),
        top: Math.max(position.y - 60, 10)
      }}
    >
      <Card className="p-2 shadow-lg bg-white border border-gray-200">
        <div className="flex items-center space-x-2">
          {colours.map(({ colour, label, bgColour }) => (
            <Button
              key={colour}
              variant="outline"
              size="sm"
              className={`w-8 h-8 p-0 ${bgColour} hover:${bgColour} hover:opacity-80 border-2 border-gray-300`}
              onClick={() => onHighlight(colour)}
              title={`Highlight in ${label}`}
            >
              <div className="w-4 h-4 rounded-sm opacity-80" />
            </Button>
          ))}
          
          <div className="w-px h-6 bg-gray-300" />
          
          <Button
            variant="outline"
            size="sm"
            onClick={onAddNote}
            title="Add Note"
            className="flex items-center space-x-1"
          >
            <StickyNote className="w-4 h-4" />
            <span className="text-xs">Note</span>
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="w-6 h-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </Card>
    </div>
  );
};
