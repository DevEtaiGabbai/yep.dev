import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { Terminal as XTermTerminal } from '@xterm/xterm'; // Renamed to XTermTerminal to avoid conflict
import { atom } from 'nanostores';

// Safer browser detection that doesn't cause SSR issues
const isBrowser = (() => {
  try {
    return typeof window !== 'undefined' && typeof self !== 'undefined';
  } catch {
    return false;
  }
})();

// Helper function to create a promise with externally accessible resolve/reject
function withResolvers<T>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

export async function newShellProcess(webcontainer: WebContainer, terminal: XTermTerminal) { // Use XTermTerminal type
  const args: string[] = [];

  const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
    terminal: {
      cols: terminal.cols ?? 80,
      rows: terminal.rows ?? 15,
    },
  });

  const input = process.input.getWriter();
  const output = process.output;

  const jshReady = withResolvers<void>();

  let isInteractive = false;
  output.pipeTo(
    new WritableStream({
      write(data) {
        if (!isInteractive) {
          const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];
          if (osc === 'interactive') {
            isInteractive = true;
            jshReady.resolve();
          }
        }
        terminal.write(data);
      },
    }),
  );

  terminal.onData((data) => {
    if (isInteractive) {
      input.write(data);
    }
  });

  await jshReady.promise;
  return process;
}

export type ExecutionResult = { output: string; exitCode: number } | undefined;

export class BoltShell {
  private _terminal: XTermTerminal | null = null; // Use XTermTerminal type
  private _process: WebContainerProcess | null = null;
  private _webcontainer: WebContainer | null = null;
  executionState = atom<
    { sessionId: string; active: boolean; executionPrms?: Promise<any>; abort?: () => void } | undefined
  >();
  private outputStream: ReadableStreamDefaultReader<string> | undefined;
  private shellInputStream: WritableStreamDefaultWriter<string> | undefined;
  private initialized = false;
  private isInteractive = false;
  private dataListenerDisposable: { dispose: () => void } | null = null;

  constructor() { }

  get terminal(): XTermTerminal | null { // Use XTermTerminal type
    return this._terminal;
  }

  get process(): WebContainerProcess | null {
    return this._process;
  }

  getProcess(): WebContainerProcess | null {
    return this._process;
  }

  // Modified init to accept XTermTerminal instance
  private _commandStreamReader: ReadableStreamDefaultReader<string> | undefined;

  get isInitialized(): boolean {
    return this.initialized && this._process !== null;
  }

  async init(webcontainer: WebContainer, xtermInstance: XTermTerminal): Promise<void> {
    if (this._process) {
      console.log('BoltShell: Already initialized');
      return;
    }

    this._webcontainer = webcontainer;
    this._terminal = xtermInstance;

    try {
      this._process = await this._webcontainer.spawn('/bin/jsh', ['--osc'], {
        terminal: {
          cols: xtermInstance.cols ?? 80,
          rows: xtermInstance.rows ?? 15,
        },
      });

      const inputWriter = this._process.input.getWriter();
      this.shellInputStream = inputWriter;

      const [terminalStream, commandStreamForParsing] = this._process.output.tee();

      // Enhanced terminal stream processing
      terminalStream.pipeTo(new WritableStream({
        write: (data) => {
          this._terminal?.write(data);
        },
      })).catch(e => console.error("BoltShell UI pipe error:", e));

      this._commandStreamReader = commandStreamForParsing.getReader();

      // Dispose of any existing data listener
      if (this.dataListenerDisposable) {
        this.dataListenerDisposable.dispose();
      }

      this.dataListenerDisposable = this._terminal.onData((data) => {
        if (this.isInteractive) {
          inputWriter.write(data).catch(e => console.error("BoltShell input error:", e));
        }
      });

      // Wait for the shell to be ready
      await this.waitTillOscCode('interactive');
      this.isInteractive = true;
      this.initialized = true;
    } catch (error) {
      console.error('BoltShell: Failed to initialize:', error);
      this.cleanup();
      throw error;
    }
  }

  async waitTillOscCode(code: string): Promise<ExecutionResult> {
    if (!this._commandStreamReader) {
      throw new Error('Command stream reader not available');
    }

    let output = '';
    let exitCode: number | undefined;

    try {
      while (true) {
        const { done, value } = await this._commandStreamReader.read();

        if (done) {
          break;
        }

        output += value;

        // Look for OSC codes
        const oscMatch = value.match(/\x1b\]654;([^\x07]+)\x07/);
        if (oscMatch) {
          const [, oscData] = oscMatch;

          if (oscData === code) {
            break;
          }

          if (oscData.startsWith('exit:')) {
            exitCode = parseInt(oscData.split(':')[1], 10);
            if (code === 'exit') {
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error waiting for OSC code ${code}:`, error);
    }

    return { output, exitCode };
  }

  async executeCommand(command: string, sessionId: string = 'main'): Promise<ExecutionResult> {
    if (!this._process || !this._terminal || !this.isInteractive) {
      console.warn("BoltShell: executeCommand called but shell not ready");
      throw new Error('Shell not ready for command execution');
    }

    try {
      // Send the command
      if (this.shellInputStream) {
        await this.shellInputStream.write(command.trim() + '\n');
      }

      // Wait for command completion
      const result = await this.waitTillOscCode('exit');

      // Wait for prompt to be ready again
      await this.waitTillOscCode('prompt');

      return result;
    } catch (error) {
      console.error('BoltShell: Error executing command:', error);
      throw error;
    }
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (this._process) {
      try {
        await this._process.resize({ cols, rows });
      } catch (error) {
        console.warn('BoltShell: Error resizing:', error);
      }
    }
  }

  async restore(xtermInstance: XTermTerminal): Promise<void> {
    console.log('BoltShell: Restoring with new XTerm instance');
    this._terminal = xtermInstance;

    if (this._process && this.isInteractive) {
      console.log('BoltShell: Reconnecting terminal to existing process');
      try {
        // Dispose of any existing data listener
        if (this.dataListenerDisposable) {
          this.dataListenerDisposable.dispose();
        }

        // Set up new data listener for the new terminal instance
        this.dataListenerDisposable = this._terminal.onData((data) => {
          if (this.isInteractive && this.shellInputStream) {
            this.shellInputStream.write(data).catch(e => console.error("BoltShell restore input error:", e));
          }
        });

        console.log('BoltShell: Terminal restored successfully');
      } catch (error) {
        console.error('BoltShell: Error during restore:', error);
        throw error;
      }
    } else {
      console.warn('BoltShell: Cannot restore - no active process or not interactive');
    }
  }

  cleanup(): void {
    console.log('BoltShell: Cleaning up...');

    try {
      if (this.dataListenerDisposable) {
        this.dataListenerDisposable.dispose();
        this.dataListenerDisposable = null;
      }
    } catch (e) {
      console.warn('BoltShell: Error disposing data listener:', e);
    }

    try {
      if (this._commandStreamReader) {
        this._commandStreamReader.releaseLock();
        this._commandStreamReader = undefined;
      }
    } catch (e) {
      console.warn('BoltShell: Error releasing command stream reader:', e);
    }

    try {
      if (this.shellInputStream) {
        this.shellInputStream.releaseLock();
        this.shellInputStream = undefined;
      }
    } catch (e) {
      console.warn('BoltShell: Error releasing shell input stream:', e);
    }

    try {
      if (this._process) {
        this._process.kill();
        this._process = null;
      }
    } catch (e) {
      console.warn('BoltShell: Error killing process:', e);
    }

    this._terminal = null;
    this._webcontainer = null;
    this.initialized = false;
    this.isInteractive = false;
  }

  onQRCodeDetected?: (qrCode: string) => void;
}

export function cleanTerminalOutput(input: string): string {
  const removeOsc = input
    .replace(/\x1b\](\d+;[^\x07\x1b]*|\d+[^\x07\x1b]*)\x07/g, '')
    .replace(/\](\d+;[^\n]*|\d+[^\n]*)/g, '');
  const removeAnsi = removeOsc
    .replace(/\u001b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\u001b/g, '')
    .replace(/\x1b/g, '');
  const cleanNewlines = removeAnsi
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const formatOutput = cleanNewlines
    .replace(/^([~\/][^\n❯]+)❯/m, '$1\n❯')
    .replace(/(?<!^|\n)>/g, '\n>')
    .replace(/(?<!^|\n|\w)(error|failed|warning|Error|Failed|Warning):/g, '\n$1:')
    .replace(/(?<!^|\n|\/)(at\s+(?!async|sync))/g, '\nat ')
    .replace(/\bat\s+async/g, 'at async')
    .replace(/(?<!^|\n)(npm ERR!)/g, '\n$1');
  const cleanSpaces = formatOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return cleanSpaces
    .replace(/\n{3,}/g, '\n\n')
    .replace(/:\s+/g, ': ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\u0000/g, '');
}

export function newBoltShellProcess(): BoltShell {
  return new BoltShell();
}

export class PersistentShell {
  private shell: BoltShell;
  private initialized = false;
  private xtermInstance: XTermTerminal | null = null; // Store XTerm instance

  constructor() {
    this.shell = new BoltShell();
  }

  isInitialized(): boolean {
    return this.initialized && this.shell.isInitialized;
  }

  // Modified init to accept XTermTerminal instance
  async init(webcontainer: WebContainer, xtermInstance: XTermTerminal): Promise<void> {
    console.log("PersistentShell: Init called.");
    if (!xtermInstance) {
      console.error('PersistentShell: XTerm instance is not available for init.');
      throw new Error('XTerm instance is not available for init.');
    }
    this.xtermInstance = xtermInstance;

    if (this.initialized) {
      console.log("PersistentShell: Already initialized.");
      return;
    }

    try {
      console.log('PersistentShell: Initializing BoltShell with XTerm instance', {
        cols: this.xtermInstance.cols || 80,
        rows: this.xtermInstance.rows || 24
      });
      await this.shell.init(webcontainer, this.xtermInstance);
      this.initialized = true;
      console.log("PersistentShell: BoltShell initialization successful.");
    } catch (error) {
      console.error('PersistentShell: Failed to initialize persistent shell:', error);
      this.initialized = false; // Ensure state reflects failure
      throw error;
    }
  }

  // Modified restore to accept XTermTerminal instance
  async restore(xtermInstance: XTermTerminal): Promise<void> {
    console.log("PersistentShell: Restore called.");
    if (!xtermInstance) {
      console.error('PersistentShell: XTerm instance is not available for restore.');
      return;
    }
    this.xtermInstance = xtermInstance;
    if (this.initialized && this.shell.getProcess) { // Check if shell and its process exist
      console.log("PersistentShell: Restoring BoltShell with new XTerm instance.");
      await this.shell.restore(this.xtermInstance);
    } else {
      console.warn("PersistentShell: Cannot restore, shell not initialized or process missing.");
    }
  }


  getDimensions() {
    if (this.xtermInstance) {
      return { cols: this.xtermInstance.cols || 80, rows: this.xtermInstance.rows || 24 };
    }
    return { cols: 80, rows: 24 };
  }

  async executeCommand(command: string, args: string[] = [], sessionId: string = 'main'): Promise<ExecutionResult> {
    console.log('[PersistentShell] executeCommand called:', { command, args, sessionId, initialized: this.initialized });
    if (!this.initialized) {
      console.warn('PersistentShell: Attempting to execute command on uninitialized shell');
      this.xtermInstance?.write('\r\n\x1b[31mShell not initialized. Please wait.\x1b[0m\r\n');
      return { output: '', exitCode: 1 };
    }
    console.log(`[PersistentShell] Executing command in terminal ${sessionId}: ${command}`);
    try {
      const result = await this.shell.executeCommand(command, sessionId);
      console.log(`[PersistentShell] Command executed. Exit code: ${result?.exitCode}`);
      return result;
    } catch (error) {
      console.error('[PersistentShell] Error executing command:', error);
      this.xtermInstance?.write(`\r\n\x1b[31mError executing command: ${error}\x1b[0m\r\n`);
      return { output: '', exitCode: 1 };
    }
  }

  dispose(preserveState: boolean = true): void {
    console.log(`PersistentShell: Disposing. Preserve state: ${preserveState}`);
    this.initialized = false;
    if (!preserveState) {
      this.xtermInstance = null;
    }
    // Further cleanup of BoltShell if necessary
  }
}

export function createPersistentShell(): PersistentShell {
  // Only create the shell instance if we're in a browser environment
  if (!isBrowser) {
    // Return a stub implementation for SSR
    const stubShell = new PersistentShell();
    // Override methods to do nothing if needed
    (stubShell as any).initialized = false;
    (stubShell as any).xtermInstance = null;
    (stubShell as any).shell = {
      terminal: null,
      process: null,
      executionState: atom(undefined),
      init: async () => { },
      restore: async () => { },
      executeCommand: async () => ({ output: '', exitCode: 1 }),
    };

    return stubShell;
  }

  return new PersistentShell();
}
