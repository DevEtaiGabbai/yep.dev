//ChatPanel.tsx
'use client';

import { ModelSelector } from '@/app/components/chat/ModelSelector';
import { AssistantMessage } from '@/components/chat/AssistantMessage';
import { LoadingProgressPanel } from '@/components/chat/LoadingProgressPanel';
import { UserMessage } from '@/components/chat/UserMessage';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { UploadedImage, useImageUpload } from '@/hooks/useImageUpload';
import { usePromptEnhancer } from '@/hooks/usePromptEnhancer';
import { DEFAULT_PROVIDER } from '@/lib/provider';
import { ChatMessage, ModelInfo, ProgressIndicator } from '@/lib/types/index';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import Cookies from "js-cookie";
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  Image,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Icons } from './ui/icons';

// Helper functions to handle mixed content types
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

interface ChatPanelProps {
  messages: ChatMessage[];
  input: string;
  setInput: (input: string) => void;
  sendMessageToAI: (message: string, images?: UploadedImage[]) => void;
  openRouterError: string | null;
  isProcessing?: boolean;
  streamingComplete?: boolean;
  activeFile?: string | null;
  completedFiles?: Set<string>;
  activeCommand?: string | null;
  completedCommands?: Set<string>;
  isLoadingGitHubFiles?: boolean;
  isInstallingDeps?: boolean;
  isStartingDevServer?: boolean;
  progress?: ProgressIndicator[];
  onRefreshRepository?: () => void;
  onModelChange?: (model: string) => void;
}

// Add a function to format error details for display
const formatErrorForDisplay = (errorMessage: string) => {


  // For payment/credit errors, provide a clearer message with link
  if (errorMessage.includes('Insufficient credits') || errorMessage.includes('Payment Required')) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-red-400 font-medium">Payment Required</span>
        <p>Your OpenRouter account needs more credits to continue.</p>
        <a
          href="https://openrouter.ai/settings/credits"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline flex items-center gap-1"
        >
          <span>Add credits to your account</span>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    );
  }

  // Extract details from full API error traces if possible
  let formattedError = errorMessage;

  // If the error contains stack trace or API details, format it better
  if (errorMessage.includes('APICallError') || errorMessage.includes('statusCode:')) {
    // Try to extract the important parts like the actual error message and status code
    const errorLines = errorMessage.split('\n');
    const mainErrorLine = errorLines.find(line => line.includes('error') && line.includes('message'))?.trim();
    const statusCodeLine = errorLines.find(line => line.includes('statusCode:'))?.trim();

    if (mainErrorLine || statusCodeLine) {
      return (
        <div className="flex flex-col gap-2">
          {mainErrorLine && <p className="text-red-400 font-medium">{mainErrorLine}</p>}
          {statusCodeLine && <p>{statusCodeLine}</p>}
          <details className="mt-2">
            <summary className="text-xs cursor-pointer text-gray-400 hover:text-white">Show full error details</summary>
            <pre className="mt-2 p-2 bg-[#1a1a1c] rounded text-xs overflow-auto max-h-40">
              {errorMessage}
            </pre>
          </details>
        </div>
      );
    }
  }

  return formattedError;
};

export const ChatPanel = ({
  messages,
  input,
  setInput,
  sendMessageToAI,
  openRouterError,
  isProcessing = false,
  streamingComplete = true,
  activeFile,
  completedFiles,
  activeCommand,
  completedCommands,
  isLoadingGitHubFiles = false,
  isInstallingDeps = false,
  isStartingDevServer = false,
  progress = [],
  onRefreshRepository,
  onModelChange
}: ChatPanelProps) => {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { enhancingPrompt, enhancePrompt } = usePromptEnhancer();
  const { uploadImage, uploadFromClipboard, isUploading, uploadError, clearError } = useImageUpload();
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [projectHasBeenLoaded, setProjectHasBeenLoaded] = useState(false);
  const [showingError, setShowingError] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);



  const [apiKeys, setApiKeys] = useState<Record<string, string>>();
  const [modelList, setModelList] = useState<ModelInfo[]>(
    DEFAULT_PROVIDER.staticModels
  );

  const [isModelLoading, setIsModelLoading] = useState<string | undefined>(
    "all"
  );

  // const { providers, isLoading, error } = useProviders();
  const [model, setModel] = useState(() => {
    const savedModel = Cookies.get("selectedModel");
    return savedModel || "DEFAULT_MODEL";
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // let parsedApiKeys: Record<string, string> | undefined = {};

      // try {
      //   parsedApiKeys = { a: "getApiKeysFromCookies()" }
      //   setApiKeys(parsedApiKeys);
      // } catch (error) {
      //   console.error('Error loading API keys from cookies:', error);
      //   // Cookies.remove('apiKeys');
      // }

      setIsModelLoading('all');
      fetch('/api/models')
        .then((response) => response.json())
        .then((data) => {
          const typedData = data as { modelList: ModelInfo[] };
          setModelList(typedData.modelList);
        })
        .catch((error) => {
          console.error("Error fetching model list:", error);
        })
        .finally(() => {
          setIsModelLoading(undefined);
        });
    }
  }, []);

  // Log messages changes for debugging
  useEffect(() => {
    console.log(`ChatPanel: Messages updated. Count: ${messages.length}`);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const textContent = getTextContent(lastMessage.content);
      console.log(`Last message - role: ${lastMessage.role}, content length: ${textContent.length}`);
      if (textContent.length > 0) {
        console.log(`Content preview: "${textContent.substring(0, 100)}..."`);
      }
    }
  }, [messages]);

  useEffect(() => {
    if (openRouterError) {
      setShowingError(true);
    } else {
      setShowingError(false);
    }
  }, [openRouterError]);

  const hasLoadingStarted = isLoadingGitHubFiles || isInstallingDeps || isStartingDevServer || projectHasBeenLoaded;

  useEffect(() => {
    if (isLoadingGitHubFiles || isInstallingDeps || isStartingDevServer) {
      setProjectHasBeenLoaded(true);
    }
  }, [isLoadingGitHubFiles, isInstallingDeps, isStartingDevServer]);

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const scrollContainer = chatContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        setIsScrolledToBottom(true);
      }
    }
  };

  // Handle scroll events to determine if we're at the bottom
  const handleScroll = () => {
    if (chatContainerRef.current) {
      const scrollContainer = chatContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        // Consider "at bottom" if within 50px of the bottom
        setIsScrolledToBottom(scrollHeight - scrollTop - clientHeight < 50);
      }
    }
  };

  useEffect(() => {
    scrollToBottom();

    // Add scroll event listener
    const scrollContainer = chatContainerRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [messages]);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      // Reset height to auto to get the correct scrollHeight
      textareaRef.current.style.height = 'auto';

      // Calculate new height (capped at max height)
      const maxHeight = window.innerHeight * 0.3; // 30% of viewport height
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(Math.max(80, scrollHeight), maxHeight);

      textareaRef.current.style.height = `${newHeight}px`;

      // Auto scroll to the bottom of the textarea
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [input]);

  const handleSendMessage = () => {
    if (!input.trim() || isProcessing || showingError) return;

    const message = input.trim();
    sendMessageToAI(message, uploadedImages.length > 0 ? uploadedImages : undefined);
    setInput(''); // Clear input after sending
    setUploadedImages([]); // Clear uploaded images after sending
  };

  // GitHub rate limit error helper
  const isGitHubRateLimitError = openRouterError &&
    openRouterError.includes('GitHub API rate limit exceeded');

  const isPaymentRequiredError = openRouterError &&
    (openRouterError.includes('Payment required') ||
      openRouterError.includes('Insufficient credits'));

  const handleUploadImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    clearError();
    const uploadedImage = await uploadImage(file);
    console.log('Uploaded image:', uploadedImage);

    if (uploadedImage) {
      setUploadedImages(prev => [...prev, uploadedImage]);
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        clearError();

        const file = item.getAsFile();
        if (file) {
          const uploadedImage = await uploadImage(file);
          if (uploadedImage) {
            setUploadedImages(prev => [...prev, uploadedImage]);
          }
        }
        break;
      }
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    Cookies.set("selectedModel", newModel, { expires: 365 });
    if (onModelChange) {
      onModelChange(newModel);
    }
  };

  return (
    <div className="w-full flex flex-col h-full bg-[#101012] border-[#313133] shadow-lg overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="h-full bg-[#101012]" ref={chatContainerRef}>
          <div className="py-8 px-4">
            <AnimatePresence>
              <div className="flex flex-col break-words word-wrap">
                {hasLoadingStarted && (
                  <LoadingProgressPanel
                    isLoadingGitHubFiles={isLoadingGitHubFiles}
                    isInstallingDeps={isInstallingDeps}
                    isStartingDevServer={isStartingDevServer}
                  />
                )}

                {messages.map((message, index) => (
                  message.role === 'user' ? (
                    <UserMessage
                      key={`user-${index}`}
                      content={message.content}
                    />
                  ) : (
                    <AssistantMessage
                      key={`assistant-${index}`}
                      content={message.content}
                      isStreaming={!streamingComplete && index === messages.length - 1}
                      activeFile={index === messages.length - 1 ? activeFile : undefined}
                      completedFiles={index === messages.length - 1 ? completedFiles : undefined}
                      activeCommand={index === messages.length - 1 ? activeCommand : undefined}
                      completedCommands={index === messages.length - 1 ? completedCommands : undefined}
                      progress={index === messages.length - 1 ? progress : undefined}
                    />
                  )
                ))}

                {openRouterError && (
                  <div className="mt-2 px-3 text-xs text-red-400">
                    <span className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3" />
                      API Error Occurred
                    </span>
                    <div className="ml-4 mt-1">
                      {formatErrorForDisplay(openRouterError)}
                    </div>

                    {isGitHubRateLimitError && onRefreshRepository && (
                      <div className="mt-4">
                        <Button
                          onClick={onRefreshRepository}
                          variant="outline"
                          className="flex items-center gap-2 text-[#969798] hover:text-[#f3f6f6] hover:bg-[#212122] border-[#313133]"
                          disabled={isLoadingGitHubFiles}
                        >
                          {isLoadingGitHubFiles ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Use cached repository data
                        </Button>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </AnimatePresence>
          </div>
        </ScrollArea>

        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(16, 16, 18, 0) 0%, rgba(16, 16, 18, 0.8) 50%, rgba(16, 16, 18, 1) 100%)'
          }}
        />

        <AnimatePresence>
          {!isScrolledToBottom && (
            <motion.button
              className="absolute bottom-4 right-4 h-8 w-8 rounded-full bg-[#212122] text-[#f3f6f6] flex items-center justify-center shadow-md hover:bg-[#313133] transition-colors z-10"
              onClick={scrollToBottom}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileHover={{ scale: 1.05 }}
              title="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="p-3">
        {/* Image preview area */}
        {uploadedImages.length > 0 && (
          <div className="mb-3 p-3 bg-[#1a1a1c] rounded-lg border border-[#313133]">
            <div className="flex flex-wrap gap-2">
              {uploadedImages.map((image, index) => (
                <div key={index} className="relative group">
                  <img
                    src={image.url}
                    alt={image.filename}
                    className="w-20 h-20 object-cover rounded border border-[#313133]"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 rounded-b truncate">
                    {image.filename}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload error display */}
        {uploadError && (
          <div className="mb-3 p-2 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-sm">
            {uploadError}
          </div>
        )}

        <div className="relative rounded-lg border border-[#313133] bg-[#161618] overflow-hidden shadow-md">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={showingError ? "Please fix the error before continuing" : "Describe the changes you want to make"}
            className={cn(
              "flex-1 border-0 bg-[#161618] text-[#f3f6f6] placeholder:text-[#969798] resize-none text-sm p-3 pr-12 pb-12 min-h-[140px] max-h-[30vh] overflow-y-auto focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus-visible:outline-none transition-all duration-200",
              showingError && "opacity-50"
            )}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={isProcessing || enhancingPrompt || showingError}
          />

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="absolute bottom-0 left-0 right-0 flex items-center px-3 py-2 bg-[#161618]">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-[#969798] hover:text-[#f3f6f6] hover:bg-[#212122]"
                disabled={showingError || isUploading}
                onClick={handleUploadImage}
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Image className="w-4 h-4" />
                )}
              </Button>


              {/* Add a dropdown to select llm model*/}
              <div className="flex items-center gap-2">
                <Icons.sparkles className={cn(
                  "h-4 w-4",
                  enhancingPrompt && "animate-pulse"
                )} />
                <ModelSelector
                  key={model}
                  model={model}
                  setModel={handleModelChange}
                  modelList={modelList}
                  apiKeys={apiKeys}
                  modelLoading={isModelLoading}
                />
              </div>

            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="icon"
                onClick={handleSendMessage}
                className={cn(
                  "h-8 w-8 rounded-full transition-colors duration-200",
                  input.trim() && !isProcessing && !showingError
                    ? "bg-[#f3f6f6] text-[#161618] hover:bg-[#e3e6e6]"
                    : "bg-[#212122] text-[#969798]"
                )}
                disabled={isProcessing || !input.trim() || showingError}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {!openRouterError && (
          <motion.p
            className="text-xs text-[#969798] mt-2 flex items-center gap-1.5 justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
          >
            <AlertTriangle className="w-3 h-3" />
            Assistant can make mistakes
          </motion.p>
        )}
      </div>
    </div>
  );
};
