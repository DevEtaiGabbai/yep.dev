// hooks/useWebContainer.ts
'use client';

import { $workbench, addPreview, removePreview, updateFileInWorkbench } from '@/app/lib/stores/workbenchStore'; // Import workbench store and actions
import { TerminalRef } from '@/components/Terminal';
import { loadFilesIntoWorkbench, startFileSystemWatcher } from '@/lib/fileSync';
import { webContainerManager } from '@/lib/WebContainerManager';
import { terminalActions } from '@/stores/terminal';
import { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';

// Safer browser detection that doesn't cause SSR issues
const isBrowser = (() => {
  try {
    return typeof window !== 'undefined' && typeof self !== 'undefined';
  } catch {
    return false;
  }
})();

export const useWebContainer = (terminalRef: MutableRefObject<TerminalRef | null>) => {
  const [webContainerInstance, setWebContainerInstance] = useState<WebContainer | null>(null);
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [isStartingDevServer, setIsStartingDevServer] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [devServerProcess, setDevServerProcess] = useState<WebContainerProcess | null>(null);

  const initAttemptedRef = useRef(false);
  const npmInstallAttemptsRef = useRef(0);
  // const persistentShell = webContainerManager.getPersistentShell();
  const persistentShell = isBrowser ? webContainerManager.getPersistentShell() : null;
  const fileWatcherCleanupRef = useRef<(() => void) | null>(null);

  const commandQueueRef = useRef<{ command: string; terminalId: string; resolve: (result: { exitCode: number }) => void }[]>([]);

  const flushCommandQueue = useCallback(() => {
    if (persistentShell?.isInitialized() && commandQueueRef.current.length > 0) {
      const queue = [...commandQueueRef.current];
      commandQueueRef.current = [];
      queue.forEach(async ({ command, terminalId, resolve }) => {
        const result = await persistentShell.executeCommand(command, [], terminalId);
        resolve(result);
      });
    }
  }, [persistentShell]);

  // ... (pipeProcessOutputToTerminal, runTerminalCommand, runNpmInstall, startDevServer, stopDevServer, initializeShell from your existing hook)
  const pipeProcessOutputToTerminal = useCallback((process: WebContainerProcess) => {
    process.output.pipeTo(
      new WritableStream({
        write: (data) => {
          terminalRef?.current?.writeToTerminal(data);
        },
        abort: (reason) => console.error('Output stream aborted for process:', reason),
      })
    ).catch(error => console.error('Error piping output for terminal:', error));
  }, [terminalRef]);

  const runTerminalCommand = useCallback(async (command: string, terminalId: string) => {
    if (!webContainerInstance) { return { exitCode: 1 }; }
    if (terminalId === 'bolt' && !persistentShell?.isInitialized()) {
      // Queue the command and return a promise that resolves when shell is ready
      return new Promise<{ exitCode: number }>(resolve => {
        commandQueueRef.current.push({ command, terminalId, resolve });
      });
    }
    if (!command.trim()) {
      terminalRef?.current?.writeToTerminal('\r\n❯ ');
      return { exitCode: 0 };
    }
    if (terminalId === 'bolt' && !persistentShell?.isInitialized()) {
      const errorMsg = `Bolt Terminal's shell is not initialized. Command "${command}" cannot be executed.`;
      console.warn(errorMsg);
      terminalRef?.current?.writeToTerminal(`\r\n\u001b[31m${errorMsg}\u001b[0m\r\n`);
      if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
      if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
      return { exitCode: 1 };
    }

    try {
      let result: { exitCode: number };

      if (terminalId === 'bolt' && persistentShell) {
        const executionResult = await persistentShell.executeCommand(command, [], 'main');
        result = { exitCode: executionResult?.exitCode ?? 0 };
      } else {
        const process = await webContainerInstance.spawn('sh', ['-c', command], {
          terminal: { cols: 80, rows: 24 }
        });
        pipeProcessOutputToTerminal(process);
        result = { exitCode: await process.exit };
      }

      // Refresh workbench files after successful commands that might modify files
      // Improved package-modifying command detection
      const isPackageModifyingCommand = result.exitCode === 0 && (
        // npm install variations
        /^npm\s+(install|i)(\s+|$)/.test(command) ||
        /^npm\s+i\s+/.test(command) ||
        command === 'npm i' ||
        command === 'npm install' ||
        // yarn, pnpm, bun
        /^yarn\s+add\s+/.test(command) ||
        /^pnpm\s+(add|install)\s+/.test(command) ||
        /^bun\s+(add|install)\s+/.test(command) ||
        // npm uninstall variations
        /^npm\s+(uninstall|remove|rm)\s+/.test(command)
      );


      if (isPackageModifyingCommand) {
        setTimeout(async () => {
          try {
            const packageJsonContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');
            await updateFileInWorkbench('/home/project/package.json', packageJsonContent, webContainerInstance);

            // Also update package-lock.json if it exists
            try {
              const packageLockContent = await webContainerInstance.fs.readFile('package-lock.json', 'utf-8');
              await updateFileInWorkbench('/home/project/package-lock.json', packageLockContent, webContainerInstance);
            } catch (lockError) {
            }

            // Show success message in terminal
            // terminalRef.current?.writeToTerminal('\r\n\x1b[32m📦 Package.json refreshed in editor\x1b[0m\r\n');

          } catch (error) {
            console.error('[useWebContainer] ❌ Failed to refresh package.json:', error);
            terminalRef.current?.writeToTerminal('\r\n\x1b[31m❌ Failed to refresh package.json in editor\x1b[0m\r\n');
          }
        }, 1500);
      }
      return result;
    } catch (error) {
      console.error('[useWebContainer] Error executing command:', error);
      return { exitCode: 1 };
    }
  }, [webContainerInstance, persistentShell, pipeProcessOutputToTerminal, terminalRef]);

  // Add a new function for fallback package-by-package installation
  const installDependenciesOneByOne = useCallback(async () => {
    if (!webContainerInstance) return false;
    const terminalId = 'bolt';

    terminalRef.current?.writeToTerminal('\r\n\u001b[33mTrying fallback installation method: installing packages one by one...\u001b[0m\r\n');

    try {
      let packageJson;
      try {
        const packageJsonContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');
        packageJson = JSON.parse(packageJsonContent);
      } catch (error) {
        terminalRef.current?.writeToTerminal('\r\n\u001b[31mFailed to read package.json. Cannot proceed with installation.\u001b[0m\r\n');
        return false;
      }

      const dependencies = { ...packageJson.dependencies || {} };
      const devDependencies = { ...packageJson.devDependencies || {} };

      if (Object.keys(dependencies).length === 0 && Object.keys(devDependencies).length === 0) {
        terminalRef.current?.writeToTerminal('\r\n\u001b[33mNo dependencies found in package.json.\u001b[0m\r\n');
        return true;
      }

      // Install production dependencies first
      let allSuccessful = true;

      for (const [pkg, version] of Object.entries(dependencies)) {
        terminalRef.current?.writeToTerminal(`\r\n\u001b[34mInstalling ${pkg}@${version}...\u001b[0m\r\n`);

        const dims = terminalRef?.current?.getDimensions() || { cols: 80, rows: 24 };
        const process = await webContainerInstance.spawn('npm', ['install', `${pkg}@${version}`, '--no-fund', '--no-audit'], {
          output: true,
          terminal: dims,
        });

        const exitCode = await process.exit;
        if (exitCode !== 0) {
          terminalRef.current?.writeToTerminal(`\r\n\u001b[31mFailed to install ${pkg}. Continuing with other packages...\u001b[0m\r\n`);
          allSuccessful = false;
        }
      }

      // Then install dev dependencies
      for (const [pkg, version] of Object.entries(devDependencies)) {
        terminalRef.current?.writeToTerminal(`\r\n\u001b[34mInstalling dev dependency ${pkg}@${version}...\u001b[0m\r\n`);

        const dims = terminalRef?.current?.getDimensions() || { cols: 80, rows: 24 };
        const process = await webContainerInstance.spawn('npm', ['install', `${pkg}@${version}`, '--save-dev', '--no-fund', '--no-audit'], {
          output: true,
          terminal: dims,
        });

        const exitCode = await process.exit;
        if (exitCode !== 0) {
          terminalRef.current?.writeToTerminal(`\r\n\u001b[31mFailed to install dev dependency ${pkg}. Continuing with other packages...\u001b[0m\r\n`);
          allSuccessful = false;
        }
      }

      if (!allSuccessful) {
        terminalRef.current?.writeToTerminal('\r\n\u001b[33mSome packages failed to install, but we can continue with what we have.\u001b[0m\r\n');
      } else {
        terminalRef.current?.writeToTerminal('\r\n\u001b[32mAll packages installed successfully using the fallback method.\u001b[0m\r\n');
      }

      return true;
    } catch (error: any) {
      console.error('Error in fallback installation:', error);
      terminalRef.current?.writeToTerminal(`\r\n\u001b[31mError in fallback installation: ${error.message}\u001b[0m\r\n`);
      return false;
    } finally {
      if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
      if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
    }
  }, [webContainerInstance, terminalRef, terminalActions]);

  // Modify the runNpmInstall function to use the fallback method if regular npm install fails
  const runNpmInstall = useCallback(async () => {
    const terminalId = 'bolt';
    if (!webContainerInstance) {
      console.warn("Skipping npm install: WC not ready or already installing.");
      return false;
    }
    if (isInstallingDeps) {
      console.warn("Skipping npm install: Already installing.");
      return false;
    }

    const MAX_ATTEMPTS = 3;
    npmInstallAttemptsRef.current++;
    const currentAttempt = npmInstallAttemptsRef.current;

    if (currentAttempt > 1) {
      terminalRef.current?.writeToTerminal(`\r\n\u001b[33mAttempt ${currentAttempt}/${MAX_ATTEMPTS} for npm install...\u001b[0m\r\n`);
      // Add delay between retries
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    setIsInstallingDeps(true);
    setInitializationError(null);
    if (terminalActions) terminalActions.setTerminalRunning(terminalId, true, 'npm install');
    if (terminalActions) terminalActions.setTerminalInteractive(terminalId, false);

    // Give WebContainer a moment to fully initialize network connections
    if (currentAttempt === 1) {
      terminalRef.current?.writeToTerminal('\r\n\u001b[33mPreparing environment for npm install...\u001b[0m\r\n');

      // Create a .npmrc file with longer timeout and registry settings
      try {
        await webContainerInstance.fs.writeFile('/.npmrc',
          'network-timeout=100000\n' +
          'fetch-retry-maxtimeout=60000\n' +
          'fetch-timeout=60000\n' +
          'registry=https://registry.npmjs.org/\n'
        );
        terminalRef.current?.writeToTerminal('\r\n\u001b[32mCreated .npmrc with optimized network settings\u001b[0m\r\n');
      } catch (e) {
        console.warn('Failed to create .npmrc file:', e);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    terminalRef.current?.writeToTerminal('\r\n\u001b[1;34m$ npm install\u001b[0m\r\n');

    try {
      const dims = terminalRef?.current?.getDimensions() || { cols: 80, rows: 24 };

      // First try npm config set to increase timeouts directly
      try {
        const configProcess = await webContainerInstance.spawn('npm', ['config', 'set', 'fetch-timeout', '60000']);
        await configProcess.exit;
      } catch (e) {
        console.warn('Failed to set npm config:', e);
      }

      const process = await webContainerInstance.spawn('npm', ['install', '--no-fund', '--no-audit', '--prefer-offline'], {
        output: true,
        terminal: dims,
      });
      pipeProcessOutputToTerminal(process);
      const exitCode = await process.exit;

      if (exitCode !== 0) {
        const errorMsg = `Failed to install dependencies (exit code ${exitCode}). Check terminal.`;
        terminalRef.current?.writeToTerminal(`\r\n\u001b[31m${errorMsg}\u001b[0m\r\n`);

        // Retry logic
        if (currentAttempt < MAX_ATTEMPTS) {
          terminalRef.current?.writeToTerminal(`\r\n\u001b[33mWill retry npm install shortly...\u001b[0m\r\n`);
          setIsInstallingDeps(false);
          if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
          if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
          return runNpmInstall(); // Recursive retry with incremented attempt counter
        }

        // If all regular attempts failed, try the fallback method
        terminalRef.current?.writeToTerminal('\r\n\u001b[33mRegular npm install failed after multiple attempts. Trying fallback method...\u001b[0m\r\n');
        const fallbackSuccess = await installDependenciesOneByOne();

        if (fallbackSuccess) {
          npmInstallAttemptsRef.current = 0;
          setInitializationError(null);
          terminalRef.current?.writeToTerminal(`\r\n\u001b[32mDependencies installed using fallback method.\u001b[0m\r\n`);
          return true;
        }

        setInitializationError(errorMsg);
        if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
        if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
        terminalRef.current?.writeToTerminal(`\r\n❯ `);
        return false;
      }

      npmInstallAttemptsRef.current = 0; // Reset attempts counter on success
      terminalRef.current?.writeToTerminal(`\r\n\u001b[32mDependencies installed successfully.\u001b[0m\r\n`);
      return true;
    } catch (error: any) {
      console.error('npm install error:', error);
      const errorMsg = `Failed to install dependencies: ${error.message}`;
      terminalRef.current?.writeToTerminal(`\r\n\u001b[31mError running npm install: ${error.message}\u001b[0m\r\n`);

      // Retry logic for errors
      if (currentAttempt < MAX_ATTEMPTS) {
        terminalRef.current?.writeToTerminal(`\r\n\u001b[33mWill retry npm install shortly...\u001b[0m\r\n`);
        setIsInstallingDeps(false);
        if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
        if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
        return runNpmInstall(); // Recursive retry with incremented attempt counter
      }

      // If all regular attempts failed with errors, try the fallback method
      terminalRef.current?.writeToTerminal('\r\n\u001b[33mRegular npm install failed after multiple attempts. Trying fallback method...\u001b[0m\r\n');
      const fallbackSuccess = await installDependenciesOneByOne();

      if (fallbackSuccess) {
        npmInstallAttemptsRef.current = 0;
        setInitializationError(null);
        terminalRef.current?.writeToTerminal(`\r\n\u001b[32mDependencies installed using fallback method.\u001b[0m\r\n`);
        return true;
      }

      setInitializationError(errorMsg);
      if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
      if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
      terminalRef.current?.writeToTerminal(`\r\n❯ `);
      return false;
    } finally {
      if (currentAttempt >= MAX_ATTEMPTS || npmInstallAttemptsRef.current === 0) {
        setIsInstallingDeps(false); // Only set to false if we're not going to retry
      }
    }
  }, [webContainerInstance, isInstallingDeps, terminalRef, pipeProcessOutputToTerminal, terminalActions, installDependenciesOneByOne]);

  const startDevServer = useCallback(async () => {
    const terminalId = 'bolt';
    if (!webContainerInstance) {
      console.warn("Skipping dev server start: WC not ready.");
      return;
    }
    if (isStartingDevServer || devServerProcess) {
      console.warn("Skipping dev server start: Already starting or running.");
      return;
    }

    setIsStartingDevServer(true);
    // setWebContainerURL(null); // Remove this, URL managed by $workbench
    setInitializationError(null);
    if (terminalActions) terminalActions.setTerminalRunning(terminalId, true, 'npm run dev');
    if (terminalActions) terminalActions.setTerminalInteractive(terminalId, false);
    terminalRef.current?.writeToTerminal(`\r\n\u001b[1;34m$ npm run dev\u001b[0m\r\n`);

    try {
      const dims = terminalRef?.current?.getDimensions() || { cols: 80, rows: 24 };
      const process = await webContainerInstance.spawn('npm', ['run', 'dev'], {
        terminal: dims,
        output: true,
      });
      setDevServerProcess(process);
      pipeProcessOutputToTerminal(process);

      // Server ready listener will now update the $workbench store
      // This is a critical change for the preview functionality.

      process.exit.then(exitCode => {
        setDevServerProcess(null);
        setIsStartingDevServer(false);
        if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
        if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
        terminalRef.current?.writeToTerminal(`\r\n❯ `);
        if (exitCode !== 0 && exitCode !== null) {
          setInitializationError(`Development server exited with error code ${exitCode}. Check terminal.`);
        }
      }).catch(error => {
        console.error('Error handling dev server exit:', error);
        setDevServerProcess(null);
        setIsStartingDevServer(false);
        if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
        if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
        terminalRef.current?.writeToTerminal(`\r\n❯ `);
      });

    } catch (error: any) {
      setIsStartingDevServer(false);
      setDevServerProcess(null);
      const errorMsg = `Error starting development server: ${error.message}`;
      setInitializationError(errorMsg);
      terminalRef.current?.writeToTerminal(`\r\n\u001b[31m${errorMsg}\u001b[0m\r\n`);
      if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
      if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
      terminalRef.current?.writeToTerminal(`\r\n❯ `);
    }
  }, [webContainerInstance, isStartingDevServer, devServerProcess, terminalRef, pipeProcessOutputToTerminal, terminalActions]);

  const stopDevServer = useCallback(async () => {
    const terminalId = 'bolt';
    if (devServerProcess) {
      terminalRef.current?.writeToTerminal('\r\n\u001b[33mStopping dev server...\u001b[0m\r\n');
      if (terminalActions) terminalActions.setTerminalInteractive(terminalId, false);
      if (terminalActions) terminalActions.setTerminalRunning(terminalId, true, 'Stopping server...');

      try {
        await devServerProcess.kill();
      } catch (error) {
        console.error('Error stopping dev server process:', error);
        terminalRef.current?.writeToTerminal(`\r\n\u001b[31mError stopping dev server: ${error instanceof Error ? error.message : String(error)}\u001b[0m\r\n`);
      } finally {
        setDevServerProcess(null);
        setIsStartingDevServer(false);
        if (terminalActions) terminalActions.setTerminalRunning(terminalId, false);
        if (terminalActions) terminalActions.setTerminalInteractive(terminalId, true);
        terminalRef.current?.writeToTerminal(`\r\n\u001b[32mDev server stopped.\u001b[0m\r\n`);
        terminalRef.current?.writeToTerminal(`\r\n❯ `);
      }
    }
  }, [devServerProcess, terminalRef, terminalActions]);

  // Manual refresh function for package.json
  const refreshPackageJson = useCallback(async () => {
    if (!webContainerInstance) {
      console.warn('[useWebContainer] Cannot refresh package.json: WebContainer not available');
      return false;
    }

    try {
      const packageJsonContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');

      await updateFileInWorkbench('/home/project/package.json', packageJsonContent, webContainerInstance);

      terminalRef.current?.writeToTerminal('\r\n\u001b[32mPackage.json refreshed in editor\u001b[0m\r\n');
      return true;
    } catch (error) {
      console.error('[useWebContainer] ❌ Failed to manually refresh package.json:', error);
      terminalRef.current?.writeToTerminal(`\r\n\u001b[31mFailed to refresh package.json: ${error instanceof Error ? error.message : String(error)}\u001b[0m\r\n`);
      return false;
    }
  }, [webContainerInstance, terminalRef]);

  // Add global error handler for WebSocket token errors
  useEffect(() => {
    const originalError = window.onerror;
    const originalUnhandledRejection = window.onunhandledrejection;

    const errorHandler: OnErrorEventHandler = (message, source, lineno, colno, error) => {
      const messageStr = String(message);
      if (messageStr.includes('__WS_TOKEN__') || messageStr.includes('WS_TOKEN')) {
        console.warn('Filtered non-critical Vite WebSocket error:', messageStr);
        terminalRef?.current?.writeToTerminal(`\r\n\u001b[33m[Filtered] Vite WebSocket warning: ${messageStr}\u001b[0m\r\n`);
        return true; // Prevent default error handling
      }
      return originalError ? originalError.call(window, message, source, lineno, colno, error) : false;
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const message = String(event.reason);
      if (message.includes('__WS_TOKEN__') || message.includes('WS_TOKEN')) {
        console.warn('Filtered non-critical Vite WebSocket rejection:', message);
        terminalRef?.current?.writeToTerminal(`\r\n\u001b[33m[Filtered] Vite WebSocket rejection: ${message}\u001b[0m\r\n`);
        event.preventDefault();
        return;
      }
      return originalUnhandledRejection ? originalUnhandledRejection.call(window, event) : undefined;
    };

    window.onerror = errorHandler;
    window.onunhandledrejection = rejectionHandler;

    return () => {
      window.onerror = originalError;
      window.onunhandledrejection = originalUnhandledRejection;
    };
  }, [terminalRef]);

  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    setInitializationError(null);

    webContainerManager.getWebContainer()
      .then(wc => {
        setWebContainerInstance(wc);
        if (terminalRef?.current) {
          terminalRef.current.writeToTerminal('\r\n\u001b[32mWebContainer booted successfully\u001b[0m\r\n');
        }

        const disposeServerReady = wc.on('server-ready', (port, url) => {
          addPreview(port, url); // This updates the $workbench store
          setIsStartingDevServer(false);
        });

        const disposePortEvent = wc.on('port', (port, type, url) => {
          if (type === 'open' && url) {
            addPreview(port, url);
          } else if (type === 'close') {
            removePreview(port);
          }
        });

        const disposeError = wc.on('error', (errorEvent: { message: string } | any) => {
          console.error('WebContainer error:', errorEvent);
          const errorMessage = typeof errorEvent.message === 'string' ? errorEvent.message : String(errorEvent);

          // Filter out common non-critical WebSocket errors from Vite dev servers
          if (errorMessage.includes('__WS_TOKEN__') || errorMessage.includes('WS_TOKEN') ||
            errorMessage.includes('net::ERR_ABORTED 500') && errorMessage.includes('webcontainer-api.io')) {
            console.warn('Non-critical Vite WebSocket error filtered:', errorMessage);
            terminalRef?.current?.writeToTerminal(`\r\n\u001b[33mVite WebSocket warning (non-critical): ${errorMessage}\u001b[0m\r\n`);
            return;
          }

          setInitializationError(`WebContainer error: ${errorMessage}`);
          terminalRef?.current?.writeToTerminal(`\r\n\u001b[31mWebContainer Error: ${errorMessage}\u001b[0m\r\n`);
          setIsInstallingDeps(false);
          if (isStartingDevServer) {
            setIsStartingDevServer(false);
            setDevServerProcess(null);
            if (terminalActions) terminalActions.setTerminalRunning('main', false);
            if (terminalActions) terminalActions.setTerminalInteractive('main', true);
          }
        });

        // Start file system watcher for auto-refresh
        const initializeFileWatcher = async () => {
          try {
            // Initial load of files into workbench
            await loadFilesIntoWorkbench(wc, 'initial');

            // Start auto-refresh every 500ms
            const cleanup = startFileSystemWatcher(wc, 500);
            fileWatcherCleanupRef.current = cleanup;
          } catch (error) {
            console.warn('Failed to start file system watcher:', error);
          }
        };

        // Run file watcher initialization asynchronously
        initializeFileWatcher();

        // Return cleanup function for listeners
        return () => {
          disposeServerReady();
          disposePortEvent();
          disposeError();

          // Cleanup file watcher
          if (fileWatcherCleanupRef.current) {
            fileWatcherCleanupRef.current();
            fileWatcherCleanupRef.current = null;
          }
        };
      })
      .catch(error => {
        console.error('WebContainer initialization failed:', error);
        const errorMsg = `Failed to initialize WebContainer: ${error instanceof Error ? error.message : String(error)}`;
        setInitializationError(errorMsg);
        if (terminalRef?.current) {
          terminalRef.current.writeToTerminal(`\r\n\u001b[31mWebContainer Boot Error: ${errorMsg}\u001b[0m\r\n`);
        }
      });

    // Cleanup for WebContainerManager (if it manages a global instance)
    return () => {
      // webContainerManager.tearDown().catch(console.error); // If your manager needs explicit teardown
    };
  }, [terminalRef, terminalActions]); // Added terminalActions as dependency

  useEffect(() => {
    const initShell = async () => {
      if (!webContainerInstance || !terminalRef?.current?.terminal || persistentShell.isInitialized()) return;

      try {
        await webContainerManager.initializeShell(terminalRef.current);
        flushCommandQueue();
      } catch (error) {
        console.error('Failed to initialize shell via WebContainerManager:', error);
        if (terminalRef.current) {
          terminalRef.current.writeToTerminal(`\r\n\u001b[31mFailed to initialize terminal: ${error instanceof Error ? error.message : String(error)}\u001b[0m\r\n`);
        }
      }
    };
    if (webContainerInstance && terminalRef?.current?.terminal) {
      initShell();
    }
  }, [webContainerInstance, terminalRef, persistentShell, flushCommandQueue]);

  useEffect(() => {
    if (!webContainerInstance) return;

    let lastPackageJsonContent = '';
    let isMonitoring = true;

    const checkPackageJsonChanges = async () => {
      if (!isMonitoring || !webContainerInstance) return;

      try {
        const currentContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');

        if (lastPackageJsonContent && currentContent !== lastPackageJsonContent) {
          await updateFileInWorkbench('/home/project/package.json', currentContent, webContainerInstance);

          // Show success message in terminal
          terminalRef.current?.writeToTerminal('\r\n\x1b[32m📦 Package.json automatically refreshed in editor\x1b[0m\r\n');
        }

        lastPackageJsonContent = currentContent;
      } catch (error) {
        // File might not exist yet, that's okay
        if (!(error as any).message?.includes('ENOENT')) {
          console.warn('[useWebContainer] Error checking package.json changes:', error);
        }
      }
    };

    checkPackageJsonChanges();

    // Check every 2 seconds for changes
    const interval = setInterval(checkPackageJsonChanges, 2000);

    return () => {
      isMonitoring = false;
      clearInterval(interval);
    };
  }, [webContainerInstance, terminalRef]);

  return {
    webContainerInstance,
    previews: $workbench.get().previews,
    isInstallingDeps,
    isStartingDevServer,
    initializationError,
    runTerminalCommand,
    runNpmInstall,
    startDevServer,
    stopDevServer,
    devServerProcess,
    refreshPackageJson,
  };
};
