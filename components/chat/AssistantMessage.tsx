'use client';

import { setSelectedFile as setSelectedWorkbenchFile, setWorkbenchView } from '@/app/lib/stores/workbenchStore';
import { Markdown } from '@/components/Markdown';
import { ProgressIndicator } from '@/lib/types/index';
import { motion } from 'framer-motion';
import { BookDashed, Brain, FileText, Loader2, MessageSquare, WrapText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const getTextContent = (content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>): string => {
  if (typeof content === 'string') {
    return content;
  }
  // For array content, extract text from text blocks
  return content
    .filter(item => item.type === 'text' && item.text)
    .map(item => item.text)
    .join(' ');
};

interface AssistantMessageProps {
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
  isStreaming?: boolean;
  activeFile?: string | null;
  completedFiles?: Set<string>;
  activeCommand?: string | null;
  completedCommands?: Set<string>;
  progress?: ProgressIndicator[];
}

// Helper function to process content with bolt artifacts and actions
const processContent = (content: string): { beforeBolt: string; afterBolt: string } => {
  const result = { beforeBolt: '', afterBolt: '' };
  let cleanContent = content.trim();

  result.beforeBolt = cleanContent;
  result.afterBolt = '';

  return result;
};

// Component to show file streaming/editing status
const FileStreamingStatus = ({
  activeFile,
  completedFiles,
  isStreaming
}: {
  activeFile?: string | null;
  completedFiles?: Set<string>;
  isStreaming?: boolean;
}) => {
  const handleFileClick = (filePath: string) => {
    setSelectedWorkbenchFile(filePath);
    setWorkbenchView('Editor');
  };

  const getDisplayPath = (filePath: string) => {
    // Remove the work directory prefix for cleaner display
    return filePath.replace('/home/project/', '').replace(/^\//, '');
  };

  if (activeFile && isStreaming) {
    return (
      <motion.div
        className="flex items-center gap-2 mb-3 p-2 bg-blue-600/10 border border-blue-500/20 rounded-lg"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
        <span className="text-sm text-blue-400">Editing</span>
        <button
          onClick={() => handleFileClick(activeFile)}
          className="text-sm text-blue-300 hover:text-blue-200 underline hover:no-underline transition-all"
        >
          {getDisplayPath(activeFile)}
        </button>
      </motion.div>
    );
  }

  if (completedFiles && completedFiles.size > 0) {
    return (
      <motion.div
        className="flex flex-col gap-1 mb-3"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {Array.from(completedFiles).map((filePath) => (
          <div key={filePath} className="flex items-center gap-2 p-2 bg-green-600/10 border border-green-500/20 rounded-lg">
            <FileText className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400">Updated</span>
            <button
              onClick={() => handleFileClick(filePath)}
              className="text-sm text-green-300 hover:text-green-200 underline hover:no-underline transition-all"
            >
              {getDisplayPath(filePath)}
            </button>
          </div>
        ))}
      </motion.div>
    );
  }

  return null;
};

const AiStreamState = ({ isStreaming, progress }: { isStreaming: boolean; progress?: ProgressIndicator[] }) => {
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Determine current state based on progress data
  const currentState = useMemo(() => {
    if (!progress || progress.length === 0) return 'summary';

    // Find the most recent in-progress item
    const inProgressItem = progress
      .filter(item => item.status === 'in-progress')
      .sort((a, b) => b.order - a.order)[0];

    if (inProgressItem) {
      return inProgressItem.label;
    }

    // If no in-progress items, find the most recent completed item
    const lastCompleted = progress
      .filter(item => item.status === 'complete')
      .sort((a, b) => b.order - a.order)[0];

    if (lastCompleted) {
      if (lastCompleted.label === 'summary') return 'context';
      if (lastCompleted.label === 'context') return 'response';
      return 'thinking';
    }

    return 'summary';
  }, [progress]);

  // Handle transitions
  useEffect(() => {
    if (!isStreaming) return;

    setIsTransitioning(true);
    const transitionTimeout = setTimeout(() => {
      setIsTransitioning(false);
    }, 300);

    return () => clearTimeout(transitionTimeout);
  }, [isStreaming, currentState]);

  let icon;
  let displayText;

  switch (currentState) {
    case 'summary':
      icon = <WrapText className="w-4 h-4 text-[#969798]" />;
      displayText = 'Creating summary';
      break;
    case 'context':
      icon = <BookDashed className="w-4 h-4 text-[#969798]" />;
      displayText = 'Selecting context';
      break;
    case 'response':
    default:
      icon = <Brain className="w-4 h-4 text-[#969798]" />;
      displayText = 'Reasoning';
  }

  // Calculate text length-based dynamic spread (similar to text-shimmer component)
  const spread = displayText.length * 2;

  return (
    <motion.div
      className={`flex items-center gap-2 mb-3 ${isTransitioning ? 'blur-sm' : 'blur-0'}`}
      animate={{ filter: isTransitioning ? 'blur(4px)' : 'blur(0px)' }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <div className={`${isTransitioning ? '' : 'animate-pulse'}`}>
        {icon}
      </div>
      <motion.span
        className="text-sm font-medium text-transparent bg-clip-text relative inline-block"
        initial={{ backgroundPosition: '100% center' }}
        animate={{ backgroundPosition: '0% center' }}
        transition={{
          repeat: Infinity,
          duration: 2,
          ease: 'linear',
          repeatType: 'loop'
        }}
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0) calc(50% - ${spread}px), #fefefe, rgba(0,0,0,0) calc(50% + ${spread}px)), linear-gradient(#969798, #969798)`,
          backgroundSize: '250% 100%, 100% 100%',
          backgroundRepeat: 'no-repeat, no-repeat',
        }}
      >
        {displayText}
      </motion.span>
    </motion.div>
  );
};

export const AssistantMessage = ({
  content,
  isStreaming,
  activeFile,
  completedFiles,
  activeCommand,
  completedCommands,
  progress = []
}: AssistantMessageProps) => {
  const displayContent = useMemo(() => {
    if (!content) return null;

    const textContent = getTextContent(content);

    let parsedCompletedFiles = completedFiles;
    let cleanedContent = textContent;

    if (!completedFiles && !isStreaming && textContent.includes('file://') || textContent.includes('file://')) {
      const fileLinks = textContent.match(/\[Updated ([^\]]+)\]\(file:\/\/([^)]+)\)/g);
      if (fileLinks) {
        const extractedFiles = fileLinks.map(link => {
          const match = link.match(/\[Updated [^\]]+\]\(file:\/\/([^)]+)\)/);
          return match ? match[1] : null;
        }).filter(Boolean) as string[];

        if (extractedFiles.length > 0) {
          parsedCompletedFiles = new Set(extractedFiles);
        }
      }
    }

    // For streaming content, just display the text directly since it's already been cleaned of boltAction tags
    if (cleanedContent.trim()) {
      return (
        <Markdown
          content={cleanedContent}
          isStreaming={isStreaming}
          activeFile={activeFile}
          completedFiles={parsedCompletedFiles}
          activeCommand={activeCommand}
          completedCommands={completedCommands}
        />
      );
    }

    return null;
  }, [content, isStreaming, activeFile, completedFiles, activeCommand, completedCommands]);

  return (
    <motion.div
      className="flex flex-col w-full mb-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex w-full items-start gap-2">
        <div className="h-6 w-6 rounded-full bg-[#2a2a2c] flex-shrink-0 flex items-center justify-center">
          <MessageSquare className="w-3.5 h-3.5 text-[#969798]" />
        </div>
        <div className="flex-1 text-[#f3f6f6] overflow-hidden break-words whitespace-pre-wrap overflow-wrap-anywhere">
          {isStreaming && !content && (
            <AiStreamState isStreaming={isStreaming} progress={progress} />
          )}

          {displayContent}

        </div>
      </div>
    </motion.div>
  );
};
