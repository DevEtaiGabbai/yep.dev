'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useGitHubFiles } from '@/hooks/useGitHubFiles';
import { useAIChat } from '@/hooks/useAIChat';
import { ChatPanel } from '@/components/ChatPanel';
import { EditorPanel } from '@/components/EditorPanel';
import { PreviewPanel } from '@/components/PreviewPanel';
import  TerminalRef from '@/components/Terminal';
import  TerminalTabs  from '@/components/TerminalTabs';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { STARTER_TEMPLATES, DEFAULT_TEMPLATE } from '@/lib/constants';
import { FileEntry } from '@/types';
import { useParams, useSearchParams } from 'next/navigation';
import { 
  CodePreviewTab, 
  CodePreviewTabList, 
  CodePreviewTabTrigger, 
  CodePreviewTabContent 
} from '@/components/ui/code-preview-tab';
import { getTerminalStore } from '@/stores/terminal';
import type { Terminal as XTerm } from '@xterm/xterm'; // Import the actual XTerm type

type Tab = 'Editor' | 'Preview';

// Simple interface for editor rate limit type
interface EditorRateLimit {
  resetTime?: Date;
}

const Workspace = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const templateId = typeof params.id === 'string' ? params.id : '';
  const initialPrompt = searchParams.get('prompt');
  
  // Find the template based on the URL parameter or use the default
  const template = STARTER_TEMPLATES.find(t => t.name === templateId) || DEFAULT_TEMPLATE;
  
  const [activeTab, setActiveTab] = useState<Tab>('Editor');
  const terminalRef = useRef<TerminalRef>(null);
  const terminalStore = getTerminalStore();
  const [showTerminal, setShowTerminal] = useState(true);
  
  // Function to create a new terminal
  const handleCreateTerminal = useCallback(() => {
    // Create a new terminal instance
    if (terminalStore) {
      terminalStore.createNewTerminal();
    }
  }, [terminalStore]);

  // Function to toggle terminal visibility
  const toggleTerminal = useCallback((value?: boolean) => {
    setShowTerminal(value !== undefined ? value : !showTerminal);
  }, [showTerminal]);
  const [installSequenceTriggered, setInstallSequenceTriggered] = useState(false);
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const [templateFallbackUsed, setTemplateFallbackUsed] = useState(false);
  
  // Add a ref to track the last active file to prevent infinite loops
  const lastActiveFileRef = useRef<string | null>(null);
  
  // Initialize WebContainer
  const {
    webContainerInstance,
    webContainerURL,
    isInitializingWebContainer,
    isInstallingDeps,
    isStartingDevServer,
    initializationError,
    runTerminalCommand,
    runNpmInstall,
    startDevServer,
    previews,
  } = useWebContainer(terminalRef);

  // Load and manage files from GitHub
  const {
    files,
    setFiles,
    selectedFile,
    setSelectedFile,
    isLoadingGitHubFiles,
    gitHubError,
    rateLimit,
    loadFileContent
  } = useGitHubFiles(webContainerInstance, template.githubRepo);

  // Try to fall back to default template if the selected template has an error
  useEffect(() => {
    if (gitHubError && template.name !== DEFAULT_TEMPLATE.name && !templateFallbackUsed) {
      console.log(`Error loading template ${template.name}, falling back to default template`);
      setTemplateFallbackUsed(true);
      // This will trigger a re-render with the default template
      window.location.href = `/${DEFAULT_TEMPLATE.name}${initialPrompt ? `?prompt=${encodeURIComponent(initialPrompt)}` : ''}`;
    }
  }, [gitHubError, template.name, templateFallbackUsed, initialPrompt]);

  // Handle AI chat functionality
  const {
    messages,
    input,
    setInput,
    openRouterError,
    sendMessageToAI,
    processingFiles,
    streamingComplete,
    activeFile,
    completedFiles,
    activeCommand,
    completedCommands,
    streamingData
  } = useAIChat(
    files, 
    setFiles, 
    webContainerInstance, 
    selectedFile, 
    setSelectedFile, 
    runTerminalCommand
  );

  // Run npm install and start dev server after files are loaded
  useEffect(() => {
    if (
      webContainerInstance && 
      !isLoadingGitHubFiles && 
      !installSequenceTriggered && 
      !isInstallingDeps &&
      !initializationError &&
      !gitHubError
    ) {
      console.log("Conditions met, triggering install and start sequence.");
      setInstallSequenceTriggered(true);

      const runInstallAndStart = async () => {
        const installSuccess = await runNpmInstall();
        if (installSuccess) {
          await startDevServer();
        }
      };

      runInstallAndStart();
    }
  }, [
    webContainerInstance, 
    isLoadingGitHubFiles, 
    installSequenceTriggered, 
    runNpmInstall, 
    startDevServer,
    isInstallingDeps,
    initializationError,
    gitHubError
  ]);

  // Submit initial prompt from URL if present
  useEffect(() => {
    if (
      initialPrompt && 
      !promptSubmitted && 
      webContainerInstance && 
      !isLoadingGitHubFiles && 
      !isInitializingWebContainer &&
      !isInstallingDeps &&
      !processingFiles
    ) {
      // Set a small delay to allow the UI to fully initialize
      const timer = setTimeout(() => {
        console.log("Submitting initial prompt from URL:", initialPrompt);
        setInput(initialPrompt);
        sendMessageToAI(initialPrompt);
        setPromptSubmitted(true);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [
    initialPrompt, 
    promptSubmitted, 
    webContainerInstance, 
    isLoadingGitHubFiles, 
    isInitializingWebContainer,
    isInstallingDeps,
    processingFiles,
    sendMessageToAI,
    setInput
  ]);

  // Check if the selected file still exists in the files state
  useEffect(() => {
    if (selectedFile && !files[selectedFile]) {
      // Selected file no longer exists, reset selection
      setSelectedFile(null);
    }
  }, [files, selectedFile, setSelectedFile]);

  // Update selected file when AI is streaming into a file
  useEffect(() => {
    // Only change the selected file when AI is streaming and there's an active file
    if (processingFiles && !streamingComplete && activeFile) {
      // Check if this is a new active file compared to our saved ref
      if (activeFile !== lastActiveFileRef.current) {
        console.log(`AI is now modifying file: ${activeFile}`);
        setSelectedFile(activeFile);
        // Update the ref with the new active file
        lastActiveFileRef.current = activeFile;
      }
    }
  }, [processingFiles, streamingComplete, activeFile, setSelectedFile]);

  // Reset lastActiveFileRef when streaming starts or completes
  useEffect(() => {
    if (!processingFiles || streamingComplete) {
      lastActiveFileRef.current = null;
    }
  }, [processingFiles, streamingComplete]);

  // Force switch to editor tab during streaming
  useEffect(() => {
    if (processingFiles && !streamingComplete) {
      setActiveTab('Editor');
    }
  }, [processingFiles, streamingComplete]);

  // Handle tab changes
  const handleTabChange = (tab: Tab) => {
    // Don't allow switching to Preview tab during streaming
    if (tab === 'Preview' && processingFiles && !streamingComplete) {
      return;
    }
    setActiveTab(tab);
  };

  // Update a file in both state and WebContainer
  const handleUpdateFile = async (path: string, content: string) => {
    console.log(`Saving file: ${path}`);
    
    if (!webContainerInstance) return;
    
    try {
      // Create parent directory if needed
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      if (dirPath) {
        try {
          await webContainerInstance.fs.mkdir(dirPath, { recursive: true });
        } catch (dirError) {
          // Ignore directory error if it already exists
          console.log(`Directory already exists or could not be created: ${dirPath}`);
        }
      }
      
      // Write the file
      await webContainerInstance.fs.writeFile(path, content);
      
      // Create a new file entry
      const newFile = {
        name: path,
        content,
        type: 'file' as const
      };
      
      // Create a new files object with the new file added
      const updatedFiles = { ...files };
      updatedFiles[path] = newFile;
      
      // Update app state after successful write
      setFiles(updatedFiles);
      
      console.log(`Successfully saved file: ${path}`);
    } catch (error) {
      console.error(`Failed to save ${path}:`, error);
    }
  };

  // Stable callback for terminal readiness - Accepts XTerm instance
  const handleTerminalReady = useCallback(
    (term: XTerm) => {
      console.log('Terminal ready');
      // Add null check for terminalStore
      if (terminalStore) {
        terminalStore.initBoltTerminal(term);
      }
      // Remove redundant assignment - ref is managed in useWebContainer
      // terminalRef.current = term;
    },
    [terminalStore] // Dependency array includes terminalStore
  );

  // Stable callback for terminal resize
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    console.log(`Terminal resized to ${cols}x${rows}`);
    terminalStore?.onTerminalResize(cols, rows);
  }, [terminalStore]);

  // Only show loading overlay for initial setup
  let loadingMessage = "Initializing...";
  if (isInitializingWebContainer) {
    loadingMessage = "Booting WebContainer...";
  } else if (isLoadingGitHubFiles) {
    loadingMessage = "Loading project files...";
  } else if (isInstallingDeps) {
    loadingMessage = "Installing dependencies...";
  }

  const combinedError = gitHubError || initializationError;
  const isGitHubRateLimited = gitHubError?.toLowerCase().includes('rate limit') || false;
  
  // Format the rate limit reset time for the EditorPanel
  const formattedRateLimit: EditorRateLimit | undefined = rateLimit ? { 
    resetTime: rateLimit.resetTime ? new Date(rateLimit.resetTime) : undefined 
  } : undefined;

  return (
    <div className="flex h-screen bg-[#101012] text-sm relative overflow-hidden">
      {combinedError && <LoadingOverlay 
        error={combinedError}
        isGitHubRateLimited={isGitHubRateLimited}
        rateLimitResetTime={rateLimit?.resetTime}
      />}

      <div className="flex-shrink-0 w-96 max-w-[24rem] min-w-[20rem] overflow-x-hidden">
        <ChatPanel
          messages={messages}
          input={input}
          setInput={setInput}
          sendMessageToAI={sendMessageToAI}
          openRouterError={openRouterError}
          isProcessing={processingFiles}
          streamingComplete={streamingComplete}
          activeFile={activeFile}
          completedFiles={completedFiles}
          activeCommand={activeCommand}
          completedCommands={completedCommands}
          isLoadingGitHubFiles={isLoadingGitHubFiles}
          isInstallingDeps={isInstallingDeps}
          isStartingDevServer={isStartingDevServer}
          progress={streamingData?.progressUpdates}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 border-b border-[#313133] flex items-center px-4">
          <CodePreviewTab value={activeTab} onValueChange={(value) => handleTabChange(value as Tab)}>
            <CodePreviewTabList>
              {(['Editor', 'Preview'] as const).map((tab) => (
                <CodePreviewTabTrigger 
                  key={tab} 
                  value={tab}
                  disabled={tab === 'Preview' && processingFiles && !streamingComplete}
                  className={cn(
                    tab === 'Preview' && processingFiles && !streamingComplete
                      ? 'cursor-not-allowed'
                      : ''
                  )}
                >
                  {tab}
                  {tab === 'Preview' && (isInstallingDeps || isStartingDevServer) && (
                    <Loader2 className="w-3 h-3 animate-spin ml-1.5 inline"/>
                  )}
                </CodePreviewTabTrigger>
              ))}
            </CodePreviewTabList>
          </CodePreviewTab>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'Editor' ? (
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel defaultSize={75} minSize={30}>
                <EditorPanel
                  files={files}
                  selectedFile={selectedFile}
                  setSelectedFile={setSelectedFile}
                  onUpdateFile={handleUpdateFile}
                  loadFileContent={loadFileContent}
                  isStreaming={processingFiles && !streamingComplete}
                  isLoadingGitHubFiles={isLoadingGitHubFiles}
                  rateLimit={formattedRateLimit}
                />
              </ResizablePanel>
              
              {showTerminal && (
                <>
                  <ResizableHandle className="h-[1px] bg-[#313133]" />
                  <ResizablePanel defaultSize={25} minSize={15}>
                    <TerminalTabs />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          ) : (
            <div className="h-full bg-[#101012]">
              <PreviewPanel
                previews={previews}
                isLoading={isInstallingDeps || isStartingDevServer || isLoadingGitHubFiles || isInitializingWebContainer}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Workspace; 