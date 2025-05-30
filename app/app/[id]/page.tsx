// app/app/[id]/page.tsx
'use client';

import {
  $workbench,
  addDirectoryToWorkbench,
  setActivePreview,
  setSelectedFile as setSelectedWorkbenchFile,
  setWorkbenchView,
  updateFileInWorkbench
} from '@/app/lib/stores/workbenchStore';
import { Workbench } from '@/components/chat/Workbench';
import { ChatPanel } from '@/components/ChatPanel';
import { ErrorNotificationModal } from '@/components/ErrorNotificationModal';
import { AuthenticatedLayout } from '@/components/layouts/AuthenticatedLayout';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { TerminalRef } from '@/components/Terminal';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useAIChat } from '@/hooks/useAIChat';
import { useBoltActionDetector } from '@/hooks/useBoltActionDetector';
import { useGitHubFiles } from '@/hooks/useGitHubFiles';
import { useWebContainer } from '@/hooks/useWebContainer';
import { DEFAULT_TEMPLATE, STARTER_TEMPLATES } from '@/lib/constants';
import { WORK_DIR } from '@/lib/prompt';
import { Message } from '@/lib/services/conversationService';
import { getTerminalStore } from '@/stores/terminal';
import he from 'he';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

function Workspace() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // URL Parameters
  const params = useParams();
  const searchParams = useSearchParams();
  const conversationId = typeof params.id === 'string' ? params.id : '';
  const templateNameFromUrl = searchParams.get('template') || DEFAULT_TEMPLATE.name;
  const initialPrompt = searchParams.get('prompt');
  const sendFirst = searchParams.get('sendFirst') === 'true';
  const modelFromUrl = searchParams.get('model');
  const template = STARTER_TEMPLATES.find(t => t.name === templateNameFromUrl) || DEFAULT_TEMPLATE;

  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [installSequenceTriggered, setInstallSequenceTriggered] = useState(false);
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const [templateFallbackUsed, setTemplateFallbackUsed] = useState(false);
  const [isSubmittingInitialPrompt, setIsSubmittingInitialPrompt] = useState(false);
  const [initialStreamCompleted, setInitialStreamCompleted] = useState(false);
  const [showErrorNotification, setShowErrorNotification] = useState(false);
  const [errorNotificationDetails, setErrorNotificationDetails] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(modelFromUrl);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const terminalStoreManager = getTerminalStore();
  const mainTerminalRef = useRef<TerminalRef | null>(null);
  const workbenchState = $workbench.get();
  const {
    currentView,
    files: filesFromStore,
    selectedFile: currentSelectedFileInStore,
    isProcessingArtifact,
  } = workbenchState;

  const {
    webContainerInstance,
    isInitializingWebContainer,
    isInstallingDeps,
    isStartingDevServer,
    initializationError,
    runTerminalCommand,
    runNpmInstall,
    startDevServer,
  } = useWebContainer(mainTerminalRef);

  const {
    files: githubFiles,
    selectedFile: selectedGithubFile,
    isLoadingGitHubFiles,
    gitHubError,
    rateLimit,
    loadFileContent,
    refreshRepository
  } = useGitHubFiles(webContainerInstance, template.githubRepo);

  // Action detector
  const { processedActions } = useBoltActionDetector(webContainerInstance, runTerminalCommand);

  // AI Chat (existing logic)
  const {
    messages,
    input,
    setInput,
    openRouterError,
    sendMessageToAI,
    sendCurrentMessagesToLLM,
    streamingComplete,
    activeFile: aiActiveFile,
    completedFiles: aiCompletedFiles,
    activeCommand: aiActiveCommand,
    completedCommands: aiCompletedCommands,
    streamingData,
    setFileActionsCallback,
    setDirectoryActionsCallback,
    setTerminalActionsCallback,
  } = useAIChat(
    webContainerInstance,
    currentSelectedFileInStore,
    setSelectedWorkbenchFile,
    runTerminalCommand,
    terminalStoreManager?.actions,
    conversationMessages,
    conversationId,
    selectedModel,
    projectId,
    session?.user?.id || null
  );

  // --- Effects and Callbacks ---

  // Auth redirect
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Load conversation
  useEffect(() => {
    async function loadConversation() {
      if (!conversationId || status !== 'authenticated') return;
      try {
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (!response.ok) {
          if (response.status === 404) console.error("Conversation not found");
          setErrorNotificationDetails(`Failed to load conversation: ${response.statusText}`);
          setShowErrorNotification(true);
          return;
        }
        const data = await response.json();
        if (data.conversation && data.conversation.messages) {
          // Store the original messages as-is from the database
          // The database already contains the correct signed URLs
          setConversationMessages(data.conversation.messages);

          const assistantMessages = data.conversation.messages.filter((m: Message) => m.role === 'assistant');
          if (assistantMessages.length > 0) {
          }
        }
        setConversationLoaded(true);
      } catch (error) {
        console.error("Error loading conversation:", error);
        setErrorNotificationDetails(`Error loading conversation: ${error instanceof Error ? error.message : String(error)}`);
        setShowErrorNotification(true);
      }
    }
    if (status === 'authenticated') loadConversation();
  }, [conversationId, status]);

  // Get or create project for this conversation
  useEffect(() => {
    const getOrCreateProject = async () => {
      if (!session?.user?.id || !conversationId || isCreatingProject || projectId) return;

      setIsCreatingProject(true);
      try {
        // First try to get existing project for this conversation
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.conversation?.projectId) {
            setProjectId(data.conversation.projectId);
            return;
          }
        }

        // If no project exists, create one
        const createResponse = await fetch('/api/projects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Project_${conversationId.slice(0, 8)}`,
          }),
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          setProjectId(createData.project.id);

          // Link the project to the conversation
          await fetch(`/api/conversations/${conversationId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectId: createData.project.id,
            }),
          });
        }
      } catch (error) {
        console.error('Error getting or creating project:', error);
      } finally {
        setIsCreatingProject(false);
      }
    };

    getOrCreateProject();
  }, [session?.user?.id, conversationId, isCreatingProject, projectId]);

  // Recreate files from messages
  useEffect(() => {
    if (!webContainerInstance || !conversationLoaded || conversationMessages.length === 0) return;
    const recreateFilesFromMessages = async () => {
      try {
        const assistantMessages = conversationMessages.filter(m => m.role === 'assistant');
        if (assistantMessages.length === 0) return;
        for (const message of assistantMessages) {
          // Handle both string and array content types safely
          const messageContent = typeof message.content === 'string'
            ? message.content
            : message.content.map(part => part.type === 'text' ? part.text || '' : '').join('');

          if (!messageContent || !messageContent.includes('<boltAction')) continue;
          const fileActionRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
          let match;
          let fileCount = 0;
          while ((match = fileActionRegex.exec(messageContent)) !== null) {
            const [_, filePath, fileContent] = match;
            if (filePath && fileContent) {
              try {
                let cleanPath = filePath.trim();

                // Normalize the file path to prevent duplication of WORK_DIR
                // Remove leading slash if present for normalization
                let pathForNormalization = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;

                // Check if the path already contains the work directory structure
                if (pathForNormalization.startsWith('home/project/')) {
                  // Path already has full work dir, just add leading slash
                  cleanPath = '/' + pathForNormalization;
                } else if (pathForNormalization.startsWith('project/')) {
                  // Path has partial work dir, prepend /home/
                  cleanPath = '/home/' + pathForNormalization;
                } else {
                  // Path is relative, prepend full WORK_DIR
                  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
                  cleanPath = WORK_DIR + cleanPath;
                }

                const decodedContent = he.decode(fileContent.trim());
                await updateFileInWorkbench(cleanPath, decodedContent, webContainerInstance);
                fileCount++;
                if (fileCount === 1) {
                  setSelectedWorkbenchFile(cleanPath);
                  setWorkbenchView('Editor');
                }
              } catch (error) {
                console.error(`Error recreating file ${filePath}:`, error);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error recreating files from conversation:", error);
      }
    };
    recreateFilesFromMessages();
  }, [webContainerInstance, conversationLoaded, conversationMessages]);

  // Handle GitHub Errors and Template Fallback
  useEffect(() => {
    if (gitHubError) {
      if (template.name !== DEFAULT_TEMPLATE.name && !templateFallbackUsed) {
        console.warn(`GitHub error with template ${template.name}, falling back to default: ${gitHubError}`);
        setTemplateFallbackUsed(true);
        const fallbackQueryString = `template=${DEFAULT_TEMPLATE.name}${initialPrompt ? `&prompt=${encodeURIComponent(initialPrompt)}` : ''}&sendFirst=${sendFirst}${modelFromUrl ? `&model=${encodeURIComponent(modelFromUrl)}` : ''}`;
        router.replace(`/app/${conversationId}?${fallbackQueryString}`);
      } else if (!templateFallbackUsed) { // Error occurred on default template or after fallback
        console.error(`GitHub error (not falling back or already on default): ${gitHubError}`);
        setErrorNotificationDetails(gitHubError);
        setShowErrorNotification(true);
      }
    }
  }, [gitHubError, template.name, templateFallbackUsed, router, conversationId, initialPrompt, sendFirst, modelFromUrl]);

  // Handle WebContainer Initialization Errors (e.g., dev server failed)
  useEffect(() => {
    if (initializationError) {
      console.error(`WebContainer initialization error: ${initializationError}`);
      setErrorNotificationDetails(initializationError);
      setShowErrorNotification(true);
    }
  }, [initializationError]);


  // --- Other existing useEffects and Callbacks (no changes needed for them, ensure they are present) ---
  useEffect(() => {
    if (processedActions.length > 0) {
    }
  }, [processedActions]);

  useEffect(() => {
    if (Object.keys(githubFiles).length > 0 && Object.keys(filesFromStore).length === 0) {
      $workbench.setKey('files', githubFiles);
      if (selectedGithubFile && !currentSelectedFileInStore) {
        setSelectedWorkbenchFile(selectedGithubFile);
      }
    }
  }, [githubFiles, selectedGithubFile, filesFromStore, currentSelectedFileInStore]);

  const handleAIFileActions = useCallback(async (filePath: string, content: string) => {
    if (!webContainerInstance) {
      console.error("Cannot create/update file: webContainerInstance is null");
      return;
    }
    try {
      await updateFileInWorkbench(filePath, content, webContainerInstance);
      if ($workbench.get().currentView !== 'Editor') {
        setWorkbenchView('Editor');
      }
      setSelectedWorkbenchFile(filePath);
    } catch (err) {
      console.error(`Page: Error updating file "${filePath}" in workbench:`, err);
    }
  }, [webContainerInstance]);

  const handleAIDirectoryActions = useCallback(async (dirPath: string) => {
    await addDirectoryToWorkbench(dirPath, webContainerInstance);
  }, [webContainerInstance]);

  const handleAITerminalActions = useCallback(async (command: string) => {

    if (runTerminalCommand && terminalStoreManager?.actions) {
      terminalStoreManager.actions.setTerminalRunning('bolt', true, command);
      try {
        const result = await runTerminalCommand(command, 'bolt');
      } catch (error) {
        console.error(`❌ Command failed:`, error);
      } finally {
        terminalStoreManager.actions.setTerminalRunning('bolt', false);
      }
    } else {
      console.error(`❌ Cannot execute command - missing dependencies:`, {
        runTerminalCommand: !!runTerminalCommand,
        terminalStoreManager: !!terminalStoreManager,
        terminalActions: !!terminalStoreManager?.actions
      });
    }
  }, [runTerminalCommand, terminalStoreManager]);

  useEffect(() => {
    setFileActionsCallback(handleAIFileActions);
    setDirectoryActionsCallback(handleAIDirectoryActions);
    setTerminalActionsCallback(handleAITerminalActions);
  }, [
    handleAIFileActions,
    handleAIDirectoryActions,
    handleAITerminalActions,
    setFileActionsCallback,
    setDirectoryActionsCallback,
    setTerminalActionsCallback
  ]);

  useEffect(() => {
    const previewsFromStore = $workbench.get().previews;
    if (previewsFromStore && previewsFromStore.length > 0) {
      const mainPreview = previewsFromStore.find(p => [3000, 5173, 8080].includes(p.port)) || previewsFromStore[0];
      if (mainPreview?.baseUrl) {
        setActivePreview(mainPreview.port, mainPreview.baseUrl);
      } else {
        setActivePreview(null, null);
      }
    } else {
      setActivePreview(null, null);
    }
  }, [workbenchState.previews]);

  useEffect(() => {
    if (
      webContainerInstance &&
      !isLoadingGitHubFiles &&
      Object.keys(filesFromStore).length > 0 &&
      !installSequenceTriggered &&
      !isInstallingDeps &&
      !initializationError && // Check if no WC init error
      !gitHubError // Check if no GitHub error (or if it was handled by fallback)
    ) {
      setInstallSequenceTriggered(true);
      const runInstallAndStart = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const installSuccess = await runNpmInstall();
        if (installSuccess) {
          await startDevServer();

          // Force refresh preview after starting dev server
          //consider
          setTimeout(() => {
            const previews = $workbench.get().previews;
            if (previews.length > 0) {
              const mainPreview = previews.find(p => [3000, 5173, 8080].includes(p.port)) || previews[0];
              if (mainPreview) {
                setActivePreview(mainPreview.port, mainPreview.baseUrl);
              }
            }
          }, 3000); // Wait a bit for the server to fully start
        } else {
          console.error("Failed to install dependencies after multiple attempts");
          // Error already shown in terminal/modal
        }
      };
      runInstallAndStart();
    }
  }, [
    webContainerInstance,
    isLoadingGitHubFiles,
    filesFromStore,
    installSequenceTriggered,
    runNpmInstall,
    startDevServer,
    isInstallingDeps,
    initializationError,
    gitHubError,
  ]);

  useEffect(() => {

    if (
      initialPrompt &&
      sendFirst &&
      !promptSubmitted &&
      !isSubmittingInitialPrompt &&
      Object.keys(githubFiles).length > 0 &&
      conversationLoaded &&
      sendCurrentMessagesToLLM
    ) {
      // Check if the initial prompt was already sent (prevent duplicates)
      const userMessageIndex = conversationMessages.findIndex(msg =>
        msg.role === 'user' &&
        (typeof msg.content === 'string' ? msg.content.trim() === initialPrompt.trim() :
          msg.content.some(part => part.type === 'text' && part.text?.trim() === initialPrompt.trim()))
      );

      const hasUserMessage = userMessageIndex !== -1;
      const hasAssistantResponse = hasUserMessage &&
        userMessageIndex < conversationMessages.length - 1 &&
        conversationMessages[userMessageIndex + 1].role === 'assistant';


      if (hasUserMessage && hasAssistantResponse) {
        setPromptSubmitted(true);
        setIsSubmittingInitialPrompt(false);
        return;
      } else if (hasUserMessage && !hasAssistantResponse) {
        // Don't call sendMessageToAI here, use sendCurrentMessagesToLLM instead to avoid duplicate
        setPromptSubmitted(true);
        setIsSubmittingInitialPrompt(true);

        // Add a small delay to ensure all state updates are processed
        setTimeout(() => {
          sendCurrentMessagesToLLM()
            .then(success => {
              if (success && $workbench.get().currentView !== 'Editor') {
                setWorkbenchView('Editor');
              }
            })
            .catch(error => console.error("Error processing existing prompt:", error))
            .finally(() => {
              setIsSubmittingInitialPrompt(false);
              setInput('');
            });
        }, 100);
        return;
      } else {
      }

      setPromptSubmitted(true);
      setIsSubmittingInitialPrompt(true);

      // Check if the conversation has an initial message with images
      let imagesToSend: Array<{ url: string; signUrl: string; filename: string; size: number; type: string }> | undefined;

      if (conversationMessages.length > 0) {
        const firstMessage = conversationMessages[0];

        if (firstMessage.role === 'user' && typeof firstMessage.content !== 'string') {
          // Extract images from the mixed content array
          const imageContent = firstMessage.content.filter(item => item.type === 'image_url' && item.image_url?.url);

          if (imageContent.length > 0) {
            imagesToSend = imageContent.map(item => {
              // The database contains signed URLs, so use them directly
              const signedUrl = item.image_url!.url;

              try {
                // Create local proxy URL for preview
                const urlObj = new URL(signedUrl);
                const pathParts = urlObj.pathname.split('/');
                const key = pathParts.slice(2).join('/'); // Remove bucket name from path
                const localProxyUrl = `/api/images/${encodeURIComponent(key)}`;

                return {
                  url: localProxyUrl, // Local proxy URL for preview
                  signUrl: signedUrl, // Original signed URL for AI API calls
                  filename: 'uploaded-image.png',
                  size: 0,
                  type: 'image/png'
                };
              } catch (error) {
                console.error('Error processing signed URL from database:', signedUrl, error);
                // If URL processing fails, use the URL as-is
                return {
                  url: signedUrl,
                  signUrl: signedUrl,
                  filename: 'uploaded-image.png',
                  size: 0,
                  type: 'image/png'
                };
              }
            });
          }
        }
      }


      sendMessageToAI(initialPrompt.trim(), imagesToSend)
        .then(success => {
          if (success && $workbench.get().currentView !== 'Editor') {
            setWorkbenchView('Editor');
          }
        })
        .catch(error => console.error("Error sending initial prompt:", error))
        .finally(() => {
          setIsSubmittingInitialPrompt(false);
          setInput('');
        });
    }
  }, [
    initialPrompt, sendFirst, promptSubmitted, isSubmittingInitialPrompt,
    githubFiles ? Object.keys(githubFiles).length > 0 : false,
    conversationLoaded, sendMessageToAI, sendCurrentMessagesToLLM, setInput, conversationMessages, messages
  ]);

  useEffect(() => {
    if (openRouterError && initialPrompt && !promptSubmitted) {
      setPromptSubmitted(true);
    }
  }, [openRouterError, initialPrompt, promptSubmitted]);

  const handleRefreshRepository = useCallback(async () => {
    if (refreshRepository) {
      try {
        await refreshRepository();
        if (initialPrompt && !promptSubmitted) {
          setInput(initialPrompt);
          sendMessageToAI(initialPrompt.trim());
          setPromptSubmitted(true);
        }
      } catch (error) {
        console.error("Error refreshing repository:", error);
      }
    }
  }, [refreshRepository, initialPrompt, promptSubmitted, setInput, sendMessageToAI]);

  useEffect(() => {
    if (streamingComplete && aiCompletedFiles && aiCompletedFiles.size > 0) {
      const timer = setTimeout(() => {
        const completedFilesArray = Array.from(aiCompletedFiles);
        if (completedFilesArray.length > 0) {
          const firstFile = completedFilesArray[0];
          if (currentSelectedFileInStore !== firstFile) {
            setSelectedWorkbenchFile(firstFile);
          }

          // Force refresh the preview after AI completes files
          setTimeout(() => {
            const previews = $workbench.get().previews;
            if (previews.length > 0) {
              const mainPreview = previews.find(p => [3000, 5173, 8080].includes(p.port)) || previews[0];
              if (mainPreview) {
                // Force reload by adding a timestamp
                const refreshedUrl = mainPreview.baseUrl + '?t=' + Date.now();
                setActivePreview(mainPreview.port, refreshedUrl);
              }
            }
          }, 1000);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [streamingComplete, aiCompletedFiles, currentSelectedFileInStore]);

  // Listen for custom events to force preview refresh
  //consider
  useEffect(() => {
    const handleForcePreviewRefresh = (event: CustomEvent) => {

      setTimeout(() => {
        const previews = $workbench.get().previews;
        if (previews.length > 0) {
          const mainPreview = previews.find(p => [3000, 5173, 8080].includes(p.port)) || previews[0];
          if (mainPreview) {
            // Force reload by adding a timestamp
            const refreshedUrl = mainPreview.baseUrl + '?t=' + Date.now();
            setActivePreview(mainPreview.port, refreshedUrl);
          }
        } else {
        }
      }, 1000);
    };

    window.addEventListener('forcePreviewRefresh', handleForcePreviewRefresh);

    return () => {
      window.removeEventListener('forcePreviewRefresh', handleForcePreviewRefresh);
    };
  }, []);

  useEffect(() => {
    if (streamingComplete && initialPrompt && sendFirst && !initialStreamCompleted && messages.length > 1) {
      const url = new URL(window.location.href);
      url.searchParams.set('sendFirst', 'false');
      window.history.replaceState({}, '', url.toString());
      setInitialStreamCompleted(true);
    }
  }, [streamingComplete, initialPrompt, sendFirst, initialStreamCompleted, messages.length]);

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
  }, []);

  if (status === 'loading') {
    return <LoadingOverlay error={null} />; // Auth loading
  }

  if (isLoadingGitHubFiles && Object.keys(filesFromStore).length === 0 && !showErrorNotification) {
    return <LoadingOverlay error={null} />;
  }

  return (
    <div className="flex h-screen bg-[#101012] text-sm relative overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={40} minSize={25}>
          <ChatPanel
            messages={messages}
            input={input}
            setInput={setInput}
            sendMessageToAI={sendMessageToAI}
            openRouterError={openRouterError}
            isProcessing={isProcessingArtifact || (!streamingComplete && messages.length > 0 && messages[messages.length - 1].role === 'assistant')}
            streamingComplete={streamingComplete}
            activeFile={aiActiveFile}
            completedFiles={aiCompletedFiles}
            activeCommand={aiActiveCommand}
            completedCommands={aiCompletedCommands}
            isLoadingGitHubFiles={isLoadingGitHubFiles}
            isInstallingDeps={isInstallingDeps}
            isStartingDevServer={isStartingDevServer}
            progress={streamingData?.progressUpdates}
            onRefreshRepository={handleRefreshRepository}
            onModelChange={handleModelChange}
          />
        </ResizablePanel>
        <ResizableHandle className="w-[1px] bg-[#313133]" />
        <ResizablePanel defaultSize={60} minSize={30}>
          <Workbench
            mainTerminalRef={mainTerminalRef}
            isProcessingFiles={isProcessingArtifact}
            streamingComplete={streamingComplete}
            activeFileFromAI={aiActiveFile}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <ErrorNotificationModal
        isOpen={showErrorNotification}
        error={errorNotificationDetails}
        isGitHubRateLimited={gitHubError?.toLowerCase().includes('rate limit')}
        rateLimitResetTime={rateLimit?.resetTime ? new Date(+rateLimit.resetTime * 1000).toLocaleTimeString() : undefined}
        onClose={() => {
          setShowErrorNotification(false);
          setErrorNotificationDetails(null);
        }}
      />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <AuthenticatedLayout>
      <Workspace />
    </AuthenticatedLayout>
  );
}
