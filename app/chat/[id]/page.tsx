"use client";

import { UpgradeDialog } from "@/app/components/UpgradeDialog";
import {
  $workbench,
  addDirectoryToWorkbench,
  setActivePreview,
  setSelectedFile as setSelectedWorkbenchFile,
  setWorkbenchView,
  updateFileInWorkbench,
} from "@/app/lib/stores/workbenchStore";
import { Workbench } from "@/components/chat/Workbench";
import { ChatPanel } from "@/components/ChatPanel";
import { ErrorNotificationModal } from "@/components/ErrorNotificationModal";
import { AuthenticatedLayout } from "@/components/layouts/AuthenticatedLayout";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { TerminalRef } from "@/components/Terminal";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAIChat } from "@/hooks/useAIChat";
import { useCloudFrontTemplate } from "@/hooks/useCloudFrontTemplate";
import { useWebContainer } from "@/hooks/useWebContainer";
import { DEFAULT_TEMPLATE, STARTER_TEMPLATES } from "@/lib/constants";
import { Message } from "@/lib/services/conversationService";
import { getTerminalStore } from "@/stores/terminal";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Module-level guard to track project creation attempts
const projectCreationAttemptedForConversation = new Set<string>();

function Workspace() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const params = useParams();
  // const searchParams = useSearchParams();
  const conversationId = typeof params.id === "string" ? params.id : "";

  // Initialize with defaults - will be updated when conversation loads
  const [templateName, setTemplateName] = useState(DEFAULT_TEMPLATE.name);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [sendFirst, setSendFirst] = useState(false);

  // Support legacy URL parameters for backward compatibility
  // const templateNameFromUrl = searchParams.get("template");
  // const initialPromptFromUrl = searchParams.get("prompt");
  // const sendFirstFromUrl = searchParams.get("sendFirst") === "true";
  // const modelFromUrl = searchParams.get("model");

  const template =
    STARTER_TEMPLATES.find((t) => t.name === templateName) ||
    DEFAULT_TEMPLATE;

  const [conversationMessages, setConversationMessages] = useState<Message[]>([]);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [installSequenceTriggered, setInstallSequenceTriggered] =
    useState(false);
  const [promptSubmitted, setPromptSubmitted] = useState(false);
  const [templateFallbackUsed, setTemplateFallbackUsed] = useState(false);
  const [isSubmittingInitialPrompt, setIsSubmittingInitialPrompt] =
    useState(false);
  const [initialStreamCompleted, setInitialStreamCompleted] = useState(false);
  const [showErrorNotification, setShowErrorNotification] = useState(false);
  const [errorNotificationDetails, setErrorNotificationDetails] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [shouldLoadTemplate, setShouldLoadTemplate] = useState(false);

  const initialPromptSentRef = useRef(false);
  const projectInitializationDoneRef = useRef(false);
  const conversationDataFetchedRef = useRef(false);

  const terminalStoreManager = getTerminalStore();
  const mainTerminalRef = useRef<TerminalRef | null>(null);
  const workbenchState = $workbench.get();

  const projectFilesLoadedRef = useRef(false);
  const lastLoadedProjectIdRef = useRef<string | null>(null);
  const [projectFilesLoaded, setProjectFilesLoaded] = useState(false);
  const {
    files: filesFromStore,
    selectedFile: currentSelectedFileInStore,
    isProcessingArtifact,
  } = workbenchState;

  const {
    webContainerInstance,
    isInstallingDeps,
    isStartingDevServer,
    initializationError,
    runTerminalCommand,
    runNpmInstall,
    startDevServer,
  } = useWebContainer(mainTerminalRef);

  const {
    files: templateFiles,
    selectedFile: selectedTemplateFile,
    templateError,
  } = useCloudFrontTemplate(
    webContainerInstance,
    shouldLoadTemplate ? template.cloudFrontUrl : undefined
  );

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
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Load conversation
  useEffect(() => {
    async function loadConversation() {
      if (!conversationId || status !== "authenticated" || conversationDataFetchedRef.current) return;

      conversationDataFetchedRef.current = true;
      try {
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setShouldLoadTemplate(true);
          } else {
            setErrorNotificationDetails(
              `Failed to load conversation: ${response.statusText}`
            );
            setShowErrorNotification(true);
          }
          setConversationLoaded(true);
          return;
        }
        const data = await response.json();
        if (data.conversation && data.conversation.messages) {
          // Store the original messages as-is from the database
          // The database should now contain clean narrative content with "Updated filename" messages
          setConversationMessages(data.conversation.messages);

          const assistantMessages = data.conversation.messages.filter(
            (m: Message) => m.role === "assistant"
          );
          if (assistantMessages.length > 0) {
            console.log(`Loaded ${assistantMessages.length} assistant messages from conversation`);
          }

          // Extract metadata from conversation
          const conversation = data.conversation;

          // Use conversation metadata, fallback to URL params for backward compatibility
          setTemplateName(conversation.templateName || DEFAULT_TEMPLATE.name);
          setSendFirst(conversation.sendFirst);

          // Extract initial prompt from first user message if available
          if (conversation.messages.length > 0) {
            const firstMessage = conversation.messages[0];
            if (firstMessage.role === "user") {
              const promptText = typeof firstMessage.content === "string"
                ? firstMessage.content
                : firstMessage.content.find(c => c.type === "text")?.text;
              if (promptText) {
                setInitialPrompt(promptText);
              }
            }
          }

          // Check if this is a new conversation with no messages
          if (conversation.messages.length === 0) {
            setShouldLoadTemplate(true);
          }

        } else {
          setShouldLoadTemplate(true);
        }
        setConversationLoaded(true);
      } catch (error) {
        console.error("Error loading conversation:", error);
        setShouldLoadTemplate(true);
        setErrorNotificationDetails(
          `Error loading conversation: ${error instanceof Error ? error.message : String(error)
          }`
        );
        setShowErrorNotification(true);
        setConversationLoaded(true);
      }
    }
    if (status === "authenticated") loadConversation();
  }, [conversationId, status]);

  // If sendFirst is false, it means we are loading an existing conversation
  // or have already processed the initial prompt. In this context,
  // the "initial prompt submission" step is considered complete for this page load.
  // For existing conversations with messages, we should also set promptSubmitted to true.
  useEffect(() => {
    if (conversationLoaded) {
      // Set promptSubmitted to true if:
      // 1. sendFirst is false (explicitly indicates not to send first message), OR
      // 2. We have existing messages in the conversation (indicating it's not a new conversation)
      if (!sendFirst || conversationMessages.length > 0) {
        setPromptSubmitted(true);
      } else {
        setPromptSubmitted(false);
      }
    }
  }, [sendFirst, conversationLoaded, conversationMessages.length]);

  // Get or create project for this conversation
  useEffect(() => {
    const getOrCreateProject = async () => {
      if (!session?.user?.id || !conversationId) {
        return;
      }

      setIsCreatingProject(true);
      try {
        // First try to get existing project for this conversation
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.conversation?.projectId) {
            setProjectId(data.conversation.projectId);
            projectInitializationDoneRef.current = true;
            return;
          }
        } else {
          // If fetching conversation fails, we can't proceed reliably.
          console.error("Failed to fetch conversation details, cannot proceed with project creation check.", await response.text());
          return;
        }

        // Check module-level guard before attempting to create a new project
        if (projectCreationAttemptedForConversation.has(conversationId)) {
          console.warn(`Project creation for conversation ${conversationId} already attempted in this session. Skipping.`);
          return;
        }
        projectCreationAttemptedForConversation.add(conversationId); // Mark as attempted

        // If no project exists, create one
        const createResponse = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `Project_${conversationId.slice(0, 8)}` }),
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          const newProjectId = createData.project.id;
          setProjectId(newProjectId);

          // Link the project to the conversation
          await fetch(`/api/conversations/${conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: newProjectId }),
          });
          projectInitializationDoneRef.current = true;
          // Do NOT remove from projectCreationAttemptedForConversation on success for this session
        } else {
          const errorData = await createResponse.json();
          if (errorData.requiresUpgrade) {
            setShowUpgradeDialog(true);
            projectCreationAttemptedForConversation.delete(conversationId); // Allow retry after upgrade
            return;
          }
          console.error("Failed to create project:", errorData.error || 'Unknown error');
          projectCreationAttemptedForConversation.delete(conversationId); // Allow retry on failure
        }
      } catch (error) {
        console.error("Error getting or creating project:", error);
        projectCreationAttemptedForConversation.delete(conversationId); // Allow retry on error
      } finally {
        setIsCreatingProject(false);
      }
    };

    if (!projectId && !projectInitializationDoneRef.current && !isCreatingProject) {
      if (session?.user?.id && conversationId) {
        getOrCreateProject();
      }
    } else if (projectId && projectInitializationDoneRef.current && isCreatingProject) {
      setIsCreatingProject(false);
    }

  }, [session?.user?.id, conversationId, projectId, isCreatingProject]);

  // Track if project files have been loaded to prevent reloading after AI updates
  useEffect(() => {
    if (!webContainerInstance || !conversationLoaded || !projectId) return;

    // Reset the loaded flag if we're dealing with a different project
    if (lastLoadedProjectIdRef.current !== projectId) {
      projectFilesLoadedRef.current = false;
      lastLoadedProjectIdRef.current = projectId;
      setProjectFilesLoaded(false);
    }

    if (projectFilesLoadedRef.current) return; // Prevent reloading after initial load

    const loadProjectFiles = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`);

        if (!response.ok) {
          setShouldLoadTemplate(true);
          projectFilesLoadedRef.current = true;
          setProjectFilesLoaded(true); // Mark as loaded even if no files
          return;
        }

        const projectData = await response.json();
        if (projectData.project?.files && projectData.project.files.length > 0) {
          let firstFileToSelect = null;
          let filesLoadedCount = 0;

          for (const file of projectData.project.files) {
            try {
              const normalizedPath = file.path.startsWith('/') ? file.path : `/${file.path}`;
              const fullPath = normalizedPath.startsWith('/home/project/')
                ? normalizedPath
                : `/home/project/${normalizedPath.replace(/^\//, '')}`;

              if (file.content) {
                await updateFileInWorkbench(fullPath, file.content, webContainerInstance);
                filesLoadedCount++;

                // Prefer app files for selection
                if (
                  fullPath.includes('index.tsx') ||
                  fullPath.includes('main.tsx') ||
                  fullPath.includes('App.tsx')
                ) {
                  firstFileToSelect = fullPath;
                }
              }
            } catch (error) {
              console.error(`❌ Error loading file ${file.path}:`, error);
            }
          }

          if (firstFileToSelect) {
            setTimeout(() => {
              setSelectedWorkbenchFile(firstFileToSelect);
              setWorkbenchView("Editor");
            }, 100); // Small delay to ensure store is updated
          }


          // Files loaded from database, don't need CloudFront template
          setShouldLoadTemplate(false);
        } else {
          console.log("No project files found in database, will load CloudFront template");
          setShouldLoadTemplate(true);
        }

        projectFilesLoadedRef.current = true; // Mark as loaded
        setProjectFilesLoaded(true);
      } catch (error) {
        console.error("Error loading project files:", error);
        setShouldLoadTemplate(true);
        projectFilesLoadedRef.current = true;
        setProjectFilesLoaded(true);
      }
    };

    // Add a small delay to ensure WebContainer is fully ready
    const timeoutId = setTimeout(loadProjectFiles, 500);
    return () => clearTimeout(timeoutId);
  }, [webContainerInstance, conversationLoaded, projectId]);


  // Handle Template Errors and Template Fallback
  useEffect(() => {
    if (templateError) {
      if (template.name !== DEFAULT_TEMPLATE.name && !templateFallbackUsed) {
        console.warn(
          `Template error with template ${template.name}, falling back to default: ${templateError}`
        );
        setTemplateFallbackUsed(true);
        setTemplateName(DEFAULT_TEMPLATE.name); // Update template state instead of URL
      } else if (!templateFallbackUsed) {
        // Error occurred on default template or after fallback
        console.error(
          `Template error (not falling back or already on default): ${templateError}`
        );
        setErrorNotificationDetails(templateError);
        setShowErrorNotification(true);
      }
    }
  }, [
    templateError,
    template.name,
    templateFallbackUsed,
    conversationId,
  ]);

  // Handle WebContainer Initialization Errors (e.g., dev server failed)
  useEffect(() => {
    if (initializationError) {
      console.error(
        `WebContainer initialization error: ${initializationError}`
      );
      setErrorNotificationDetails(initializationError);
      setShowErrorNotification(true);
    }
  }, [initializationError]);

  // --- Other existing useEffects and Callbacks (no changes needed for them, ensure they are present) ---
  useEffect(() => {
    if (
      Object.keys(templateFiles).length > 0 &&
      Object.keys(filesFromStore).length === 0 &&
      shouldLoadTemplate
    ) {
      $workbench.setKey("files", templateFiles);
      if (selectedTemplateFile && !currentSelectedFileInStore) {
        setSelectedWorkbenchFile(selectedTemplateFile);
      }
    }
  }, [
    templateFiles,
    selectedTemplateFile,
    filesFromStore,
    currentSelectedFileInStore,
    shouldLoadTemplate,
  ]);

  const handleAIFileActions = useCallback(
    async (filePath: string, content: string) => {
      if (!webContainerInstance) {
        console.error(
          "Cannot create/update file: webContainerInstance is null"
        );
        return;
      }
      try {
        await updateFileInWorkbench(filePath, content, webContainerInstance);
        if ($workbench.get().currentView !== "Editor") {
          setWorkbenchView("Editor");
        }
        setSelectedWorkbenchFile(filePath);
      } catch (err) {
        console.error(
          `Page: Error updating file "${filePath}" in workbench:`,
          err
        );
      }
    },
    [webContainerInstance]
  );

  const handleAIDirectoryActions = useCallback(
    async (dirPath: string) => {
      await addDirectoryToWorkbench(dirPath, webContainerInstance);
    },
    [webContainerInstance]
  );

  const handleAITerminalActions = useCallback(
    async (command: string) => {
      if (runTerminalCommand && terminalStoreManager?.actions) {
        const devServerCommands = [
          "npm run dev", "npm start", "npm run start",
          "yarn dev", "yarn start",
          "pnpm dev", "pnpm start",
          "vite", "next dev", "ng serve", "astro dev"
        ];
        const isDevServerCommand = devServerCommands.some(devCmd => command.startsWith(devCmd));

        // Helper to show skip message in terminal
        const showSkipMessageInTerminal = (reason: string) => {
          terminalStoreManager.actions.setTerminalRunning("bolt", true, command); // Show the command that was attempted
          if (mainTerminalRef.current) {
            // Using ANSI escape codes for yellow text
            mainTerminalRef.current.writeToTerminal(`
[33mSystem: ${reason} Command "${command}" skipped.[0m
❯ `);
          }
          terminalStoreManager.actions.setTerminalRunning("bolt", false); // Mark as not running
        };

        if (isDevServerCommand) {
          const currentWorkbenchState = $workbench.get();
          const currentPreviews = currentWorkbenchState.previews;
          const uiIsStartingInitialServer = isStartingDevServer; // Flag from useWebContainer for initial setup

          console.log('[DevServerCheck] Attempting command:', command);
          console.log('[DevServerCheck] isStartingDevServer (UI initial):', uiIsStartingInitialServer);
          console.log('[DevServerCheck] Current Previews:', JSON.stringify(currentPreviews));

          // Check 1: Is any server already registered and fully ready in previews?
          const anyServerReadyInPreviews = currentPreviews.some(p => p.ready);
          if (anyServerReadyInPreviews) {
            const readyPreview = currentPreviews.find(p => p.ready); // For logging
            const reason = `A development server is already active${readyPreview ? ` on port ${readyPreview.port}` : ''}.`;
            console.log(`[DevServerCheck] Skipping: ${reason}`);
            showSkipMessageInTerminal(reason);
            return;
          }

          // Check 2: Is the UI currently in the process of the *initial* server startup sequence?
          if (uiIsStartingInitialServer) {
            const reason = 'The initial development server is currently starting.';
            console.log(`[DevServerCheck] Skipping: ${reason} (isStartingDevServer is true).`);
            showSkipMessageInTerminal(reason);
            return;
          }

          // Check 3: Is the Bolt terminal itself already running a dev command?
          // This catches rapid AI commands for the same dev task before previews update.
          const boltTerminalSession = terminalStoreManager.$store.get().sessions.bolt;
          if (boltTerminalSession?.isRunningCommand &&
            devServerCommands.some(devCmd => boltTerminalSession.currentCommand?.startsWith(devCmd))) {
            const reason = `The terminal is already executing a development server command ('${boltTerminalSession.currentCommand}').`;
            console.log(`[DevServerCheck] Skipping: ${reason}`);
            showSkipMessageInTerminal(reason);
            return;
          }
          console.log('[DevServerCheck] No active/starting server detected by guards. Proceeding with command.');
        }

        // Proceed with command execution if no guards prevented it
        terminalStoreManager.actions.setTerminalRunning("bolt", true, command);
        try {
          await runTerminalCommand(command, "bolt");
        } catch (error) {
          console.error(`❌ Command failed: ${command}`, error);
          if (mainTerminalRef.current) {
            mainTerminalRef.current.writeToTerminal(`
[31mError executing command "${command}": ${error instanceof Error ? error.message : String(error)}[0m
❯ `);
          }
        } finally {
          terminalStoreManager.actions.setTerminalRunning("bolt", false);
        }
      } else {
        console.error(`❌ Cannot execute command - missing dependencies. Command: ${command}`, {
          runTerminalCommand: !!runTerminalCommand,
          terminalStoreManager: !!terminalStoreManager,
          terminalActions: !!terminalStoreManager?.actions,
        });
        if (mainTerminalRef.current) {
          mainTerminalRef.current.writeToTerminal(`
[31mSystem: Cannot execute command "${command}" due to missing internal dependencies.[0m
❯ `);
        }
      }
    },
    [runTerminalCommand, terminalStoreManager, isStartingDevServer]
  );

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
    setTerminalActionsCallback,
  ]);

  useEffect(() => {
    const previewsFromStore = $workbench.get().previews;
    if (previewsFromStore && previewsFromStore.length > 0) {
      const mainPreview =
        previewsFromStore.find((p) => [3000, 5173, 8080].includes(p.port)) ||
        previewsFromStore[0];
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
      Object.keys(filesFromStore).length > 0 &&
      !installSequenceTriggered &&
      !isInstallingDeps &&
      !initializationError &&
      !templateError
    ) {
      setInstallSequenceTriggered(true);
      const runInstallAndStart = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const installSuccess = await runNpmInstall();
        if (installSuccess) {
          await startDevServer();

          // Force refresh preview after starting dev server
          setTimeout(() => {
            const previews = $workbench.get().previews;
            if (previews.length > 0) {
              const mainPreview =
                previews.find((p) => [3000, 5173, 8080].includes(p.port)) ||
                previews[0];
              if (mainPreview) {
                setActivePreview(mainPreview.port, mainPreview.baseUrl);
              }
            }
          }, 1000); // Wait a bit for the server to fully start
        } else {
          console.error(
            "Failed to install dependencies after multiple attempts"
          );
        }
      };
      runInstallAndStart();
    }
  }, [
    webContainerInstance,
    // isLoadingTemplate,
    filesFromStore,
    installSequenceTriggered,
    runNpmInstall,
    startDevServer,
    isInstallingDeps,
    initializationError,
    templateError,
  ]);

  useEffect(() => {
    if (
      initialPrompt &&
      sendFirst &&
      !initialPromptSentRef.current &&
      !isSubmittingInitialPrompt &&
      Object.keys(templateFiles).length > 0 &&
      conversationLoaded &&
      sendCurrentMessagesToLLM
    ) {
      initialPromptSentRef.current = true;

      // Check if the initial prompt was already sent (prevent duplicates)
      const userMessageIndex = conversationMessages.findIndex(
        (msg) =>
          msg.role === "user" &&
          (typeof msg.content === "string"
            ? msg.content.trim() === initialPrompt.trim()
            : msg.content.some(
              (part) =>
                part.type === "text" &&
                part.text?.trim() === initialPrompt.trim()
            ))
      );

      const hasUserMessage = userMessageIndex !== -1;
      const hasAssistantResponse =
        hasUserMessage &&
        userMessageIndex < conversationMessages.length - 1 &&
        conversationMessages[userMessageIndex + 1].role === "assistant";

      if (hasUserMessage && hasAssistantResponse) {
        setPromptSubmitted(true);
        setIsSubmittingInitialPrompt(false);
        return;
      } else if (hasUserMessage && !hasAssistantResponse) {
        setPromptSubmitted(true);
        setIsSubmittingInitialPrompt(true);

        // Add a small delay to ensure all state updates are processed
        setTimeout(() => {
          sendCurrentMessagesToLLM()
            .then((success) => {
              if (success && $workbench.get().currentView !== "Editor") {
                setWorkbenchView("Editor");
              }
            })
            .catch((error) =>
              console.error("Error processing existing prompt:", error)
            )
            .finally(() => {
              setIsSubmittingInitialPrompt(false);
              setInput("");
            });
        }, 100);
        return;
      }
      setPromptSubmitted(true);
      setIsSubmittingInitialPrompt(true);

      // Check if the conversation has an initial message with images
      let imagesToSend:
        | Array<{
          url: string;
          signUrl: string;
          filename: string;
          size: number;
          type: string;
        }>
        | undefined;

      if (conversationMessages.length > 0) {
        const firstMessage = conversationMessages[0];

        if (
          firstMessage.role === "user" &&
          typeof firstMessage.content !== "string"
        ) {
          // Extract images from the mixed content array
          const imageContent = firstMessage.content.filter(
            (item) => item.type === "image_url" && item.image_url?.url
          );

          if (imageContent.length > 0) {
            imagesToSend = imageContent.map((item) => {
              // The database contains signed URLs, so use them directly
              const signedUrl = item.image_url!.url;

              try {
                // Create local proxy URL for preview
                const urlObj = new URL(signedUrl);
                const pathParts = urlObj.pathname.split("/");
                const key = pathParts.slice(2).join("/"); // Remove bucket name from path
                const localProxyUrl = `/api/images/${encodeURIComponent(key)}`;

                return {
                  url: localProxyUrl, // Local proxy URL for preview
                  signUrl: signedUrl, // Original signed URL for AI API calls
                  filename: "uploaded-image.png",
                  size: 0,
                  type: "image/png",
                };
              } catch (error) {
                console.error(
                  "Error processing signed URL from database:",
                  signedUrl,
                  error
                );
                // If URL processing fails, use the URL as-is
                return {
                  url: signedUrl,
                  signUrl: signedUrl,
                  filename: "uploaded-image.png",
                  size: 0,
                  type: "image/png",
                };
              }
            });
          }
        }
      }

      sendMessageToAI(initialPrompt.trim(), imagesToSend)
        .then((success) => {
          if (success && $workbench.get().currentView !== "Editor") {
            setWorkbenchView("Editor");
          }
        })
        .catch((error) => console.error("Error sending initial prompt:", error))
        .finally(() => {
          setIsSubmittingInitialPrompt(false);
          setInput("");
        });
    }
  }, [
    initialPrompt,
    sendFirst,
    isSubmittingInitialPrompt,
    templateFiles ? Object.keys(templateFiles).length > 0 : false,
    conversationLoaded,
    sendMessageToAI,
    sendCurrentMessagesToLLM,
    setInput,
    conversationMessages,
    messages,
  ]);

  useEffect(() => {
    if (openRouterError && initialPrompt && !promptSubmitted) {
      setPromptSubmitted(true);
    }
  }, [openRouterError, initialPrompt, promptSubmitted]);

  // Add a more comprehensive error handling effect
  useEffect(() => {
    // If there's an error and we're stuck in submission state, force the prompt as submitted
    if (openRouterError && !promptSubmitted) {
      console.log('OpenRouter error detected, setting promptSubmitted to true:', openRouterError);
      setPromptSubmitted(true);
      setIsSubmittingInitialPrompt(false);
    }
  }, [openRouterError, promptSubmitted]);

  // Also handle the case where streaming fails but no explicit error is set
  useEffect(() => {
    // If we've been submitting initial prompt for too long (>30 seconds), force completion
    let timeoutId: NodeJS.Timeout;

    if (isSubmittingInitialPrompt) {
      timeoutId = setTimeout(() => {
        console.log('Initial prompt submission timeout, forcing completion');
        setIsSubmittingInitialPrompt(false);
        setPromptSubmitted(true);
      }, 30000); // 30 second timeout
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isSubmittingInitialPrompt]);

  // Listen for custom events to force preview refresh
  //consider
  useEffect(() => {
    const handleForcePreviewRefresh = (event: CustomEvent) => {
      setTimeout(() => {
        const previews = $workbench.get().previews;
        if (previews.length > 0) {
          const mainPreview =
            previews.find((p) => [3000, 5173, 8080].includes(p.port)) ||
            previews[0];
          if (mainPreview) {
            // Force reload by adding a timestamp
            const refreshedUrl = mainPreview.baseUrl + "?t=" + Date.now();
            setActivePreview(mainPreview.port, refreshedUrl);
          }
        } else {
        }
      }, 1000);
    };

    const handleRequestDevServer = async (event: CustomEvent) => {
      const reason = event.detail?.reason || 'manual_request';
      console.log(`[RequestDevServer] Request received: ${reason}`);

      // Check if we have files but no preview server
      const currentPreviews = $workbench.get().previews;
      const hasNoActiveServer = !currentPreviews.some(p => p.ready);

      if (hasNoActiveServer && webContainerInstance && Object.keys(filesFromStore).length > 0) {
        console.log('[RequestDevServer] No active server found, attempting to start dev server');

        // Try to start the dev server manually
        if (runTerminalCommand && terminalStoreManager?.actions) {
          try {
            terminalStoreManager.actions.setTerminalRunning("bolt", true, "npm run dev");
            await runTerminalCommand("npm run dev", "bolt");
          } catch (error) {
            console.error('[RequestDevServer] Failed to start dev server:', error);
            if (mainTerminalRef.current) {
              mainTerminalRef.current.writeToTerminal(`
[31mError starting dev server: ${error instanceof Error ? error.message : String(error)}[0m
❯ `);
            }
          } finally {
            terminalStoreManager.actions.setTerminalRunning("bolt", false);
          }
        }
      }
    };

    window.addEventListener("forcePreviewRefresh", handleForcePreviewRefresh);
    window.addEventListener("requestDevServer", handleRequestDevServer);

    return () => {
      window.removeEventListener("forcePreviewRefresh", handleForcePreviewRefresh);
      window.removeEventListener("requestDevServer", handleRequestDevServer);
    };
  }, [webContainerInstance, filesFromStore, runTerminalCommand, terminalStoreManager, mainTerminalRef]);

  useEffect(() => {
    if (
      streamingComplete &&
      initialPrompt &&
      sendFirst &&
      !initialStreamCompleted &&
      messages.length > 1
    ) {
      setInitialStreamCompleted(true);
    }
  }, [
    streamingComplete,
    initialPrompt,
    sendFirst,
    initialStreamCompleted,
    messages.length,
  ]);

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
  }, []);

  if (status === "loading") {
    return <LoadingOverlay error={null} />;
  }

  const shouldShowLoadingOverlay = (
    Object.keys(filesFromStore).length === 0 &&
    !showErrorNotification &&
    !conversationLoaded &&
    !projectId
  );

  if (shouldShowLoadingOverlay) {
    return <LoadingOverlay error={null} />;
  }

  if (!promptSubmitted && !openRouterError && !showErrorNotification) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8 bg-[#101012]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-white">Yep Chat Bot</h1>
          <p className="text-gray-500">Processing message...</p>
          {/* Add debug info for troubleshooting */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-4 text-xs text-gray-600">
              <p>promptSubmitted: {String(promptSubmitted)}</p>
              <p>openRouterError: {openRouterError ? 'YES' : 'NO'}</p>
              <p>showErrorNotification: {String(showErrorNotification)}</p>
              <p>messages.length: {messages.length}</p>
              <p>sendFirst: {String(sendFirst)}</p>
            </div>
          )}
        </div>
      </div>
    );
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
            isProcessing={
              isProcessingArtifact ||
              (!streamingComplete &&
                messages.length > 0 &&
                messages[messages.length - 1].role === "assistant")
            }
            streamingComplete={streamingComplete}
            activeFile={aiActiveFile}
            completedFiles={aiCompletedFiles}
            activeCommand={aiActiveCommand}
            completedCommands={aiCompletedCommands}
            isInstallingDeps={isInstallingDeps}
            isStartingDevServer={isStartingDevServer}
            progress={streamingData?.progressUpdates}
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
            projectId={projectId}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <ErrorNotificationModal
        isOpen={showErrorNotification}
        error={errorNotificationDetails}
        onClose={() => {
          setShowErrorNotification(false);
          setErrorNotificationDetails(null);
        }}
      />

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
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
