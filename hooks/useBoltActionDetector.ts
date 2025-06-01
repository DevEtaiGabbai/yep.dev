'use client';

import { setWorkbenchView, updateFileInWorkbench } from '@/app/lib/stores/workbenchStore';
import { terminalActions } from '@/stores/terminal';
import { WebContainer } from '@webcontainer/api';
import he from 'he';
import { useCallback, useEffect, useRef, useState } from 'react';

const extractBoltActions = (content: string) => {
  const actions: {
    type: string;
    filePath?: string;
    content: string;
  }[] = [];
  const fileActionRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
  let match;
  while ((match = fileActionRegex.exec(content)) !== null) {
    const [_, filePath, fileContent] = match;
    if (filePath && fileContent) {
      actions.push({ type: 'file', filePath: he.decode(filePath.trim()), content: he.decode(fileContent.trim()) });
    }
  }
  const shellActionRegex = /<boltAction\s+type="(shell|command)"[^>]*>([\s\S]*?)<\/boltAction>/g;
  match = null;
  while ((match = shellActionRegex.exec(content)) !== null) {
    const [_, actionType, commandContent] = match;
    if (commandContent) {
      actions.push({ type: actionType, content: he.decode(commandContent.trim()) });
    }
  }
  return actions;
};

interface PendingAction {
  type: string;
  filePath?: string;
  content: string;
  hash: string;
}

export function useBoltActionDetector(
  webContainerInstance: WebContainer | null,
  runTerminalCommand?: (command: string, terminalId: string) => Promise<{ exitCode: number }>, // This comes from useWebContainer
  isStreamingRef?: React.MutableRefObject<boolean>
) {
  const [lastProcessedTimestamp, setLastProcessedTimestamp] = useState<number>(0);
  const [processedActions, setProcessedActions] = useState<string[]>([]);
  const pendingActionsRef = useRef<Map<string, PendingAction>>(new Map());
  const pendingMountWrites = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);

  const internalStreamingRef = useRef<boolean>(false);
  const streamingRef = isStreamingRef || internalStreamingRef;

  const writeFilesToWebContainer = useCallback(async () => {
    if (!webContainerInstance || pendingActionsRef.current.size === 0 || isProcessingRef.current) {
      return;
    }

    isProcessingRef.current = true;
    console.log(`[BoltActionDetector] Processing ${pendingActionsRef.current.size} pending file actions`);
    pendingMountWrites.current = false;

    const fileActionsToProcess = Array.from(pendingActionsRef.current.values())
      .filter(action => action.type === 'file' && action.filePath);

    if (fileActionsToProcess.length === 0) {
      isProcessingRef.current = false;
      return;
    }

    const uniqueFileWrites = new Map<string, PendingAction>();
    for (const action of fileActionsToProcess) {
      uniqueFileWrites.set(action.filePath!, action);
    }

    const newProcessedActions: string[] = [];

    for (const action of uniqueFileWrites.values()) {
      try {
        let filePath = action.filePath!;
        // Path normalization should happen consistently, ideally before this point
        // or ensure `updateFileInWorkbench` handles it.
        // If WORK_DIR is not prepended here, ensure updateFileInWorkbench does it.
        // For consistency with your updateFileInWorkbench, let's assume it handles prepending WORK_DIR if needed.
        // filePath = filePath.startsWith(WORK_DIR) ? filePath : `${WORK_DIR}/${filePath.replace(/^\//, '')}`;


        console.log(`[BoltActionDetector] Writing file: ${filePath}`);
        await updateFileInWorkbench(filePath, action.content, webContainerInstance);
        newProcessedActions.push(`file:${filePath}`);
        console.log(`[BoltActionDetector] Successfully updated file: ${filePath}`);
      } catch (err) {
        console.error(`[BoltActionDetector] Error processing file ${action.filePath}:`, err);
      }
    }

    setProcessedActions(prev => [...prev, ...newProcessedActions]);
    pendingActionsRef.current.clear();

    if (newProcessedActions.length > 0) {
      setTimeout(() => {
        console.log('[BoltActionDetector] Switching to Editor view after file writes');
        setWorkbenchView('Editor');
      }, 300);
    }

    isProcessingRef.current = false;
  }, [webContainerInstance]);

  // Improved interval check - only process when needed and not already processing
  useEffect(() => {
    const checkStreamingInterval = setInterval(() => {
      if (!streamingRef.current && pendingMountWrites.current && !isProcessingRef.current) {
        console.log('[BoltActionDetector] Streaming complete, processing pending WebContainer writes');
        writeFilesToWebContainer();
      }
    }, 1000); // Increased interval to reduce frequency

    return () => clearInterval(checkStreamingInterval);
  }, [streamingRef, writeFilesToWebContainer]);

  useEffect(() => {
    const handleBoltActions = async (event: CustomEvent<{ content: string; timestamp: number }>) => {
      const { content, timestamp } = event.detail;
      if (timestamp <= lastProcessedTimestamp) return;

      setLastProcessedTimestamp(timestamp);
      const actions = extractBoltActions(content);
      console.log(`[BoltActionDetector] Found ${actions.length} actions to process`);

      if (!webContainerInstance && actions.some(a => a.type === 'shell' || a.type === 'command')) {
        console.error('[BoltActionDetector] Cannot process shell/command actions: WebContainer not available');
        return;
      }

      let commandQueue = Promise.resolve<{ exitCode: number } | void>(undefined);

      for (const action of actions) {
        if (action.type === 'file' && action.filePath) {
          const fileHash = `file:${action.filePath}:${action.content.length}`;
          let filePath = action.filePath;

          streamingRef.current = true;
          pendingActionsRef.current.set(fileHash, { ...action, filePath, hash: fileHash });
          pendingMountWrites.current = true;

          // Update workbench store immediately (without writing to WebContainer yet)
          await updateFileInWorkbench(filePath, action.content, null);
          console.log(`[BoltActionDetector] Queued file: ${filePath} for WebContainer update`);

        } else if ((action.type === 'shell' || action.type === 'command') && runTerminalCommand) {
          // Chain command executions
          commandQueue = commandQueue.then(async () => {
            try {
              console.log(`[BoltActionDetector] Running command: ${action.content}`);
              if (terminalActions) terminalActions.setTerminalRunning('bolt', true, action.content);

              const result = await runTerminalCommand(action.content, 'bolt');

              console.log(`[BoltActionDetector] Command result:`, result);
              if (result && result.exitCode === 0) {
                setProcessedActions(prev => [...prev, `command:${action.content}`]);
                console.log(`[BoltActionDetector] Successfully ran command: ${action.content}`);
              } else {
                console.error(`[BoltActionDetector] Command failed or shell not ready: ${action.content}, Exit Code: ${result?.exitCode}`);
              }
            } catch (err) {
              console.error(`[BoltActionDetector] Error running command:`, err);
            } finally {
              if (terminalActions) terminalActions.setTerminalRunning('bolt', false);
            }
          });
        }
      }

      await commandQueue;

      // Only trigger write if not already streaming and not processing
      if (!streamingRef.current && !isProcessingRef.current) {
        console.log('[BoltActionDetector] Streaming inactive after actions, writing files immediately');
        writeFilesToWebContainer();
      } else {
        console.log('[BoltActionDetector] Streaming active after actions, queueing file changes');
        // Reduced timeout and added check to prevent unnecessary forced completion
        setTimeout(() => {
          if (streamingRef.current && pendingMountWrites.current && !isProcessingRef.current) {
            console.log('[BoltActionDetector] Forcing streaming complete after timeout (action loop)');
            streamingRef.current = false;
          }
        }, 3000); // Reduced from 5000ms
      }
    };

    const customEventListener = (event: any) => handleBoltActions(event as CustomEvent<{ content: string; timestamp: number }>);
    window.addEventListener('boltActionsDetected', customEventListener);
    const messageListener = (event: MessageEvent) => {
      if (event.data && event.data.type === 'boltActionsDetected') {
        handleBoltActions({ detail: { content: event.data.content, timestamp: event.data.timestamp } } as any);
      }
    };
    window.addEventListener('message', messageListener);

    return () => {
      window.removeEventListener('boltActionsDetected', customEventListener);
      window.removeEventListener('message', messageListener);
    };
  }, [webContainerInstance, runTerminalCommand, lastProcessedTimestamp, writeFilesToWebContainer, streamingRef]);

  const processAllPendingActions = useCallback(async () => {
    streamingRef.current = false;
    if (!isProcessingRef.current) {
      await writeFilesToWebContainer();
    }
  }, [writeFilesToWebContainer, streamingRef]);

  const setStreamingState = useCallback((isStreaming: boolean) => {
    streamingRef.current = isStreaming;
    if (!isStreaming && pendingMountWrites.current && !isProcessingRef.current) {
      writeFilesToWebContainer();
    }
  }, [writeFilesToWebContainer, streamingRef]);

  return {
    processedActions,
    processAllPendingActions,
    setStreamingState
  };
}
