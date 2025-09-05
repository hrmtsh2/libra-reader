import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { X, Save, Trash2 } from 'lucide-react';
import { Highlight } from '../../types';

interface NoteModalProps {
  isOpen: boolean;
  selectedText: string;
  existingNote?: string;
  highlightColour?: Highlight['colour'];
  onSave: (note: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  selectedText,
  existingNote = '',
  highlightColour,
  onSave,
  onDelete,
  onClose
}) => {
  const [note, setNote] = useState(existingNote);

  useEffect(() => {
    setNote(existingNote);
  }, [existingNote]);

  const handleSave = () => {
    if (note.trim()) {
      onSave(note.trim());
      onClose();
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
      onClose();
    }
  };

  if (!isOpen) return null;

  const getColourClass = (colour: Highlight['colour']) => {
    switch (colour) {
      case 'yellow': return 'bg-yellow-100 border-yellow-300';
      default: return 'bg-gray-100 border-gray-300';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-96 max-w-[90vw] p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">
            {existingNote ? 'Edit Note' : 'Add Note'}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {selectedText && (
          <div className={`p-3 rounded-md mb-4 border-2 ${highlightColour ? getColourClass(highlightColour) : 'bg-gray-50 border-gray-200'}`}>
            <p className="text-sm text-gray-700">
              <span className="font-medium">Selected text:</span>
            </p>
            <p className="text-sm mt-1 italic">
              "{selectedText.length > 200 ? selectedText.substring(0, 200) + '...' : selectedText}"
            </p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Your note:</label>
          <textarea
            className="w-full p-3 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={4}
            placeholder="Enter your note here..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex justify-between">
          <div>
            {onDelete && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex items-center space-x-1"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </Button>
            )}
          </div>
          
          <div className="flex space-x-2">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!note.trim()}
              className="flex items-center space-x-1"
            >
              <Save className="w-4 h-4" />
              <span>Save</span>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
