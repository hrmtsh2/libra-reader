import React from 'react';
import { Button } from '../ui/button';

interface SummaryModalProps {
  isOpen: boolean;
  summary: string;
  onClose: () => void;
}

export const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, summary, onClose }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6 relative">
        <h2 className="text-xl font-bold mb-4">Book Summary</h2>
        <div className="max-h-96 overflow-y-auto whitespace-pre-line text-gray-800 mb-6">
          {summary || <span className="italic text-gray-400">No summary available.</span>}
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};
