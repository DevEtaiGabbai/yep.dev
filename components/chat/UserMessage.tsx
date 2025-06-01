'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import Image from 'next/image';

interface UserMessageProps {
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

// Helper function to render content
const renderContent = (content: UserMessageProps['content']) => {
  if (typeof content === 'string') {
    return <div className="flex-1 text-[#f2f6f6] break-words whitespace-pre-wrap overflow-wrap-anywhere pr-2 overflow-hidden">{content}</div>;
  }

  return (
    <div className="flex-1 text-[#f2f6f6] break-words whitespace-pre-wrap overflow-wrap-anywhere pr-2 overflow-hidden">
      {content.map((item, index) => {
        if (item.type === 'text' && item.text) {
          return <div key={index} className="mb-2">{item.text}</div>;
        }
        if (item.type === 'image_url' && item.image_url?.url) {
          const imageUrl = item.image_url.url;
          
          // Convert signed URLs to local proxy URLs for display to avoid CORS issues
          let displayUrl = imageUrl;
          if (imageUrl.includes('s3.') || imageUrl.includes('amazonaws.com')) {
            try {
              const urlObj = new URL(imageUrl);
              const pathParts = urlObj.pathname.split('/');
              const key = pathParts.slice(2).join('/'); // Remove bucket name from path
              displayUrl = `/api/images/${encodeURIComponent(key)}`;
              console.log('UserMessage: Converted signed URL to proxy URL for display:', displayUrl);
            } catch (error) {
              console.warn('UserMessage: Failed to convert signed URL to proxy URL:', error);
              // Use original URL as fallback
            }
          }
          
          return (
            <div key={index} className="mb-2">
              <Image 
                src={displayUrl} 
                alt="Uploaded image" 
                width={256}
                height={256}
                className="max-w-sm max-h-64 rounded-lg border border-[#313133]"
                onLoad={() => console.log('Image loaded successfully:', displayUrl)}
                onError={(e) => {
                  console.error('Image failed to load:', displayUrl, e);
                  // Try to show a placeholder or error message
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

export const UserMessage = memo(({ content }: UserMessageProps) => {
  return (
    <motion.div 
      className="flex flex-col w-full mb-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex w-full items-start gap-2">
        <div className="h-6 w-6 rounded-full bg-[#2a2a2c] flex-shrink-0 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-[#e3e6e6]" />
        </div>
        {renderContent(content)}
      </div>
    </motion.div>
  );
});

UserMessage.displayName = 'UserMessage'; 