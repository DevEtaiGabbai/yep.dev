
import { TerminalRef } from '@/components/Terminal';
import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from './prompt';
import { PersistentShell, createPersistentShell } from './shell';

// Safer browser detection that doesn't cause SSR issues
const isBrowser = (() => {
  try {
    return typeof window !== 'undefined' && typeof self !== 'undefined';
  } catch {
    return false;
  }
})();

class WebContainerManager {
  private static instance: WebContainerManager | null = null;
  private webContainer: WebContainer | null = null;
  private isBooting: boolean = false;
  private bootPromise: Promise<WebContainer> | null = null;
  private persistentShell: PersistentShell
  private shellInitialized: boolean = false;
  private shellInitPromise: Promise<void> | null = null;

  private constructor() {
    this.persistentShell = isBrowser ? createPersistentShell() : {} as PersistentShell;
  }


  public static getInstance(): WebContainerManager {
    if (!WebContainerManager.instance) {
      WebContainerManager.instance = new WebContainerManager();
    }
    return WebContainerManager.instance;
  }

  public getPersistentShell(): PersistentShell {
    return this.persistentShell;
  }

  public async initializeShell(terminalComponentRef?: TerminalRef | null): Promise<void> {
    if (this.shellInitPromise) {
      return this.shellInitPromise;
    }
    if (this.shellInitialized && this.persistentShell.isInitialized()) {
      if (terminalComponentRef && this.persistentShell.isInitialized()) {
        try {

          if (terminalComponentRef.terminal) {
            await this.persistentShell.restore(terminalComponentRef.terminal);
          } else {
            console.warn("WebContainerManager: Cannot restore shell, terminalComponentRef.terminal is null.");
          }
        } catch (e) {
          console.error("WebContainerManager: Error restoring shell with new terminal ref", e);
        }
      }
      return;
    }

    const { promise, resolve, reject } = this.createPromiseWithResolvers<void>();
    this.shellInitPromise = promise;

    try {
      if (!this.webContainer) {
        await this.getWebContainer();
      }

      if (!this.webContainer) {
        this.shellInitPromise = null;
        reject(new Error('WebContainer not available after boot attempt for shell init'));
        return;
      }

      if (!terminalComponentRef?.terminal) {
        console.warn("WebContainerManager: initializeShell called but terminalComponentRef.terminal (XTerm instance) is not yet available.");
        this.shellInitPromise = null;
        reject(new Error('Terminal instance (XTerm) within TerminalRef is not available for shell initialization.'));
        return;
      }

      terminalComponentRef.writeToTerminal('\r\n\x1b[36mWebContainerManager: Connecting to shell...\x1b[0m\r\n');

      if (!this.persistentShell.isInitialized()) {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            await new Promise(resolveDelay => setTimeout(resolveDelay, 100 + (attempts * 200)));

            let dimensions = { cols: 80, rows: 24 };
            try {
              if (terminalComponentRef.terminal) { // Access XTerm instance via terminalComponentRef.terminal
                dimensions = { cols: terminalComponentRef.terminal.cols, rows: terminalComponentRef.terminal.rows };
                if (dimensions.cols <= 0 || dimensions.rows <= 0) {
                  dimensions = { cols: 80, rows: 24 };
                }

              } else {
                console.warn('WebContainerManager: terminalComponentRef.terminal not available for dimensions, using defaults.');
              }
            } catch (e) {
              console.warn('WebContainerManager: Failed to get dimensions for shell init, using defaults:', e);
            }

            terminalComponentRef.writeToTerminal('\r\n\x1b[36mWebContainerManager: Initializing shell...\x1b[0m\r\n');

            await this.persistentShell.init(this.webContainer, terminalComponentRef.terminal); // Pass XTerm instance
            this.shellInitialized = true;

            terminalComponentRef.writeToTerminal('\r\n\x1b[32mShell initialized successfully!\x1b[0m\r\n');
            resolve();
            return;
          } catch (error) {
            attempts++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`WebContainerManager: Shell initialization attempt ${attempts}/${maxAttempts} failed:`, errorMsg);
            terminalComponentRef.writeToTerminal(`\r\n\x1b[31mShell initialization attempt ${attempts}/${maxAttempts} failed: ${errorMsg}\x1b[0m\r\n`);

            if (attempts >= maxAttempts) {
              terminalComponentRef.writeToTerminal('\r\n\x1b[31mFailed to initialize shell after multiple attempts\x1b[0m\r\n');
              this.shellInitPromise = null;
              reject(error);
              return;
            }
            terminalComponentRef.writeToTerminal(`\r\n\x1b[33mRetrying in ${1 + attempts * 0.2} second...\x1b[0m\r\n`);
          }
        }
      } else if (terminalComponentRef && terminalComponentRef.terminal) {
        terminalComponentRef.writeToTerminal('\r\n\x1b[36mWebContainerManager: Restoring existing shell...\x1b[0m\r\n');
        try {
          await this.persistentShell.restore(terminalComponentRef.terminal); // Pass XTerm instance
          terminalComponentRef.writeToTerminal('\r\n\x1b[32mShell restored successfully!\x1b[0m\r\n');
          resolve();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error("WebContainerManager: Failed to restore shell:", errorMsg);
          terminalComponentRef.writeToTerminal(`\r\n\x1b[31mFailed to restore shell: ${errorMsg}\x1b[0m\r\n`);
          this.shellInitPromise = null;
          reject(error);
        }
      } else {
        // This case should ideally not be hit if the initial checks are correct
        console.warn("WebContainerManager: Cannot restore shell, terminalComponentRef or its terminal is null.");
        this.shellInitPromise = null;
        reject(new Error("Cannot restore shell, terminal instance missing."));
      }
    } catch (error) {
      console.error('WebContainerManager: Failed to initialize/restore shell outer catch:', error);
      this.shellInitialized = false;
      this.shellInitPromise = null;
      reject(error);
    }
  }

  private createPromiseWithResolvers<T>() {
    let resolveFn!: (value: T | PromiseLike<T>) => void;
    let rejectFn!: (reason?: any) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    return { promise, resolve: resolveFn, reject: rejectFn };
  }

  public async getWebContainer(): Promise<WebContainer> {
    if (this.webContainer) return this.webContainer;
    if (this.isBooting && this.bootPromise) return this.bootPromise;

    this.isBooting = true;


    this.bootPromise = new Promise<WebContainer>(async (resolve, reject) => {
      try {
        // Increased delay before booting to ensure browser is ready

        await new Promise(r => setTimeout(r, 1500));

        // Add retry logic for WebContainer boot
        let attempts = 0;
        const maxAttempts = 3;
        let lastError: any = null;

        while (attempts < maxAttempts) {
          try {

            const container = await WebContainer.boot({
              coep: 'credentialless',
              workdirName: WORK_DIR_NAME,
              forwardPreviewErrors: true,
            });

            this.webContainer = container;
            this.isBooting = false;


            // Wait longer for network to stabilize after boot
            await new Promise(r => setTimeout(r, 1500));

            resolve(container);
            return;
          } catch (error: any) {
            attempts++;
            lastError = error;
            console.warn(`WebContainerManager: Boot attempt ${attempts}/${maxAttempts} failed:`, error);

            if (attempts < maxAttempts) {

              // Incremental backoff
              await new Promise(r => setTimeout(r, attempts * 1000));
            }
          }
        }

        // If we get here, all attempts failed
        this.isBooting = false;
        this.bootPromise = null;
        console.error("WebContainerManager: All boot attempts failed", lastError);
        reject(lastError || new Error("Failed to boot WebContainer after multiple attempts"));
      } catch (error: any) {
        this.isBooting = false;
        this.bootPromise = null;
        console.error("WebContainerManager: Boot process error", error);
        reject(error);
      }
    });

    return this.bootPromise;
  }

  public async tearDown(): Promise<void> {

    this.persistentShell.dispose(false);
    this.shellInitialized = false;
    this.shellInitPromise = null;

    if (this.webContainer) {
      try {
        await this.webContainer.teardown();

      } catch (error) {
        console.error("WebContainerManager: WebContainer teardown error", error);
      }
      this.webContainer = null;
      this.bootPromise = null;
      this.isBooting = false;
      this.persistentShell = createPersistentShell();
    }
  }
}

export const webContainerManager = WebContainerManager.getInstance();
