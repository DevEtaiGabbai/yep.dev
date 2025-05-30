'use client';

import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { ReactNode } from 'react';

interface ErrorMessageProps {
  error: string;
  children?: ReactNode;
}

export const ErrorMessage = ({ error, children }: ErrorMessageProps) => {
  return (
    <motion.div 
      className="flex flex-col w-full mb-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="bg-red-900/20 border border-red-900/30 text-red-400 p-3 rounded-md flex items-start gap-2 text-xs w-full">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="w-full">
          <p className="font-semibold">AI Error:</p>
          <p>{error}</p>
          {children}
        </div>
      </div>
    </motion.div>
  );
}; 