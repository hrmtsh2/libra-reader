import React from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Edit, Trash2, X } from 'lucide-react';
import { Highlight } from '../../types';

interface HighlightTooltipProps {
  highlight: Highlight;
  position: { x: number; y: number };
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export const HighlightTooltip: React.FC<HighlightTooltipProps> = ({
  highlight,
  position,
  onEdit,
  onDelete,
  onClose
}) => {
  const getColorClass = (color: Highlight['colour']) => {
    switch (color) {
      case 'yellow': return 'bg-yellow-100 border-yellow-300';      
      default: return 'bg-gray-100 border-gray-300';
    }
  };

  return (
    <div 
      className="fixed z-50 transform -translate-x-1/2"
      style={{
        left: Math.min(Math.max(position.x, 150), window.innerWidth - 150),
        top: Math.max(position.y - 10, 10)
      }}
    >
      <Card className={`p-3 shadow-lg border-2 max-w-sm ${getColorClass(highlight.colour)}`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800 mb-1">
              "{highlight.text.length > 100 ? highlight.text.substring(0, 100) + '...' : highlight.text}"
            </p>
            {highlight.note && (
              <p className="text-sm text-gray-600 italic">
                {highlight.note}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-1 ml-2"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
        
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </p>
          
          <div className="flex space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="p-1"
              title="Edit note"
            >
              <Edit className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="p-1 hover:text-red-600"
              title="Delete highlight"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
