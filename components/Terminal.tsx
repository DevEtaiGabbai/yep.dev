'use client';

import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { ITerminalOptions, ITheme, Terminal as XTerm } from '@xterm/xterm';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useWebContainer } from '@/hooks/useWebContainer';
import { cn } from '@/lib/utils';
import { webContainerManager } from '@/lib/WebContainerManager';
import { terminalActions } from '@/stores/terminal';

import { WebContainer, WebContainerProcess } from '@webcontainer/api';
import '@xterm/xterm/css/xterm.css';

export interface TerminalRef {
  terminal: XTerm | null;
  writeToTerminal: (text: string) => void;
  clearTerminal: () => void;
  focus: () => void;
  getDimensions: () => { cols: number; rows: number };
  resize: () => void;
  sendInput: (data: string) => void;
}

interface TerminalProps {
  id: string;
  active?: boolean;
  className?: string;
  onCommand?: (command: string, terminalId: string) => void;
  onResize?: (cols: number, rows: number) => void;
  initialOptions?: Partial<ITerminalOptions>;
  webContainerInstance?: WebContainer | null;
}

const defaultTheme: ITheme = {
  background: '#151718',
  foreground: '#D1D5DB',
  cursor: '#A0A0A0',
  selectionBackground: 'rgba(59, 130, 246, 0.3)',
  black: '#1E1E1E',
  red: '#FF5555',
  green: '#50FA7B',
  yellow: '#F1FA8C',
  blue: '#BD93F9',
  magenta: '#FF79C6',
  cyan: '#8BE9FD',
  white: '#F8F8F2',
  brightBlack: '#6272A4',
  brightRed: '#FF6E6E',
  brightGreen: '#69FF94',
  brightYellow: '#FFFFA5',
  brightBlue: '#D6ACFF',
  brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF',
  brightWhite: '#FFFFFF'
};

export const Terminal = memo(forwardRef<TerminalRef, TerminalProps>(
  ({ id, active = false, className, onCommand, onResize, initialOptions }, ref) => {
    const terminalElRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const shellProcessRef = useRef<WebContainerProcess | null>(null);
    const [shellSpawnAttempted, setShellSpawnAttempted] = useState(false);
    const isMountedRef = useRef(false);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const messageQueueRef = useRef<string[]>([]);
    const shellReadyRef = useRef<boolean>(false);
    const shellErrorRef = useRef<boolean>(false);
    const shellErrorMsgShownRef = useRef<boolean>(false);
    const isSpawningRef = useRef<boolean>(false);
    const cleanupAbortControllerRef = useRef<AbortController | null>(null);
    const dataListenerDisposableRef = useRef<{ dispose: () => void } | null>(null);
    const sessionIdRef = useRef<string>(`${id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    const dataListenerSetupRef = useRef<boolean>(false);
    const terminalInitializedRef = useRef<boolean>(false);

    const { webContainerInstance } = useWebContainer(ref as React.MutableRefObject<TerminalRef | null>);

    // Set up the imperative handle early so ref is available for shell initialization
    useImperativeHandle(ref, () => ({
      terminal: xtermRef.current,
      writeToTerminal: (text: string) => {
        if (isMountedRef.current && xtermRef.current) {
          if (id === 'bolt') {
            // For bolt terminal, always write directly as the persistent shell handles everything
            xtermRef.current.write(text);
          } else if (shellReadyRef.current && shellProcessRef.current) {
            xtermRef.current.write(text);
          } else if (shellErrorRef.current && !shellErrorMsgShownRef.current) {
            xtermRef.current.write('\r\n\x1b[31mShell not initialized\x1b[0m\r\n');
            shellErrorMsgShownRef.current = true;
            messageQueueRef.current.push(text);
          } else if (!shellReadyRef.current && !shellErrorRef.current) {
            messageQueueRef.current.push(text);
          }
        }
      },
      clearTerminal: () => {
        if (isMountedRef.current && xtermRef.current) {
          xtermRef.current.clear();
          if (shellReadyRef.current) {
            xtermRef.current.write('❯ ');
          }
        }
      },
      focus: () => {
        if (isMountedRef.current) {
          xtermRef.current?.focus();
        }
      },
      getDimensions: () => ({
        cols: (isMountedRef.current && xtermRef.current?.cols) || 80,
        rows: (isMountedRef.current && xtermRef.current?.rows) || 24
      }),
      resize: () => {
        if (isMountedRef.current && fitAddonRef.current && terminalElRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            console.warn(`Terminal (${id}): Error during manual resize:`, e);
          }
        }
      },
      sendInput: (data: string) => {
        if (isMountedRef.current) {
          if (id === 'bolt') {
            // For bolt terminal, the BoltShell class handles input automatically via its onData listener
            // The input is already being processed, so no manual intervention needed
            console.log(`Terminal (${id}): Input handled by BoltShell onData listener: "${data}"`);
          } else if (shellReadyRef.current && shellProcessRef.current) {
            try {
              const writer = shellProcessRef.current.input.getWriter();
              writer.write(data).catch(e => console.error(`Terminal (${id}) sendInput error:`, e));
              writer.releaseLock();
            } catch (e) {
              console.error(`Terminal (${id}) sendInput writer error:`, e);
            }
          } else {
            messageQueueRef.current.push(data);
          }
        }
      }
    }), [id]);

    // Process queued messages when shell becomes ready
    const processMessageQueue = () => {
      if (shellReadyRef.current && xtermRef.current && messageQueueRef.current.length > 0) {
        const messages = [...messageQueueRef.current];
        messageQueueRef.current = [];

        messages.forEach(msg => {
          if (xtermRef.current) {
            xtermRef.current.write(msg);
          }
        });
      }
    };

    // Improved cleanup function
    const cleanupTerminal = useCallback(() => {
      console.log(`Terminal (${id}): Starting cleanup`);

      // Abort any ongoing operations
      if (cleanupAbortControllerRef.current) {
        cleanupAbortControllerRef.current.abort();
        cleanupAbortControllerRef.current = null;
      }

      // Dispose of data listener (only for non-bolt terminals)
      if (id !== 'bolt' && dataListenerDisposableRef.current) {
        try {
          dataListenerDisposableRef.current.dispose();
        } catch (e) {
          console.warn(`Terminal (${id}): Error disposing data listener:`, e);
        }
        dataListenerDisposableRef.current = null;
      }

      // Cleanup resize observer
      if (resizeObserverRef.current) {
        try {
          resizeObserverRef.current.disconnect();
        } catch (e) {
          console.warn(`Terminal (${id}): Error disconnecting resize observer:`, e);
        }
        resizeObserverRef.current = null;
      }

      // For non-bolt terminals, kill the shell process
      // For bolt terminal, preserve the persistent shell
      if (id !== 'bolt' && shellProcessRef.current) {
        try {
          shellProcessRef.current.kill();
          console.log(`Terminal (${id}): Shell process killed`);
        } catch (e) {
          console.warn(`Terminal (${id}): Error killing shell process:`, e);
        }
        shellProcessRef.current = null;
      }

      // Dispose XTerm safely
      if (xtermRef.current) {
        try {
          xtermRef.current.dispose();
          console.log(`Terminal (${id}): XTerm disposed`);
        } catch (e) {
          console.warn(`Terminal (${id}): Error disposing XTerm:`, e);
        }
        xtermRef.current = null;
      }

      // Reset all refs and states
      fitAddonRef.current = null;
      if (id !== 'bolt') {
        shellReadyRef.current = false;
      }
      shellErrorRef.current = false;
      shellErrorMsgShownRef.current = false;
      isSpawningRef.current = false;
      messageQueueRef.current = [];
      dataListenerSetupRef.current = false;
      terminalInitializedRef.current = false;
    }, [id]);

    // Track mounted state
    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
        cleanupTerminal();
      };
    }, [id, cleanupTerminal]);

    // Initialize terminal only once
    useEffect(() => {
      if (!terminalElRef.current || !webContainerInstance || xtermRef.current || !isMountedRef.current || terminalInitializedRef.current) {
        return;
      }

      console.log(`Terminal (${id}): Initializing XTerm.`);

      try {
        const term = new XTerm({
          cursorBlink: true,
          fontSize: initialOptions?.fontSize || 13,
          fontFamily: initialOptions?.fontFamily || "Menlo, Monaco, 'Courier New', monospace",
          theme: { ...defaultTheme, ...initialOptions?.theme },
          scrollback: 5000,
          convertEol: true,
          allowProposedApi: true, // Important for some addons
          ...(initialOptions || {})
        });

        // Store term reference before any potential errors occur
        xtermRef.current = term;
        terminalInitializedRef.current = true;

        const fitAddon = new FitAddon();
        fitAddonRef.current = fitAddon;
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        // Try WebGL addon for performance, fallback to Canvas, then to DOM
        try {
          const webglAddon = new WebglAddon();
          term.loadAddon(webglAddon);
          webglAddon.onContextLoss(() => { webglAddon.dispose(); }); // Handle context loss
          console.log(`Terminal (${id}): WebGL renderer enabled.`);
        } catch (e) {
          console.warn(`Terminal (${id}): WebGL renderer failed, falling back to Canvas.`, e);
          try {
            term.loadAddon(new CanvasAddon());
            console.log(`Terminal (${id}): Canvas renderer enabled.`);
          } catch (e2) {
            console.warn(`Terminal (${id}): Canvas renderer failed, falling back to DOM.`, e2);
          }
        }

        // Open terminal in the DOM element
        if (terminalElRef.current && isMountedRef.current) {
          term.open(terminalElRef.current);

          // Need to wait a bit for the terminal to be fully rendered
          setTimeout(() => {
            if (fitAddonRef.current && isMountedRef.current && terminalElRef.current) {
              try {
                fitAddonRef.current.fit();

                // Setup resize observer AFTER initial fit
                if (terminalElRef.current) {
                  const resizeObserver = new ResizeObserver(() => {
                    if (!isMountedRef.current) return;

                    try {
                      if (fitAddonRef.current && terminalElRef.current && xtermRef.current) {
                        fitAddonRef.current.fit();
                        const term = xtermRef.current;

                        if (onResize && term.cols && term.rows) {
                          onResize(term.cols, term.rows);
                        }

                        if (shellProcessRef.current && term.cols && term.rows) {
                          try {
                            shellProcessRef.current.resize({ cols: term.cols, rows: term.rows });
                          } catch (e) {
                            console.warn(`Terminal (${id}): Error resizing process:`, e);
                          }
                        }
                      }
                    } catch (e) {
                      console.error(`Error fitting terminal ${id} on resize:`, e);
                    }
                  });

                  resizeObserver.observe(terminalElRef.current);
                  resizeObserverRef.current = resizeObserver;
                }
              } catch (e) {
                console.error(`Error performing initial fit for terminal ${id}:`, e);
              }
            }
          }, 100);
        }
      } catch (e) {
        console.error(`Error initializing XTerm for terminal ${id}:`, e);
        // Clean up partial initialization
        if (xtermRef.current) {
          try {
            xtermRef.current.dispose();
          } catch (err) { }
          xtermRef.current = null;
        }
        fitAddonRef.current = null;
        terminalInitializedRef.current = false;
      }
    }, [id, initialOptions, webContainerInstance, onResize, cleanupTerminal]);

    // Initialize Bolt terminal with persistent shell
    useEffect(() => {
      if (id !== 'bolt' || !xtermRef.current || !webContainerInstance ||
        !isMountedRef.current || isSpawningRef.current || shellReadyRef.current) {
        return;
      }

      const initializeBoltShell = async () => {
        if (!isMountedRef.current || !xtermRef.current) return;

        isSpawningRef.current = true;
        const term = xtermRef.current;

        try {
          // Get the persistent shell from WebContainerManager
          const persistentShell = webContainerManager.getPersistentShell();

          if (!persistentShell.isInitialized()) {
            // Initialize the persistent shell
            term.write('\r\n\x1b[36mInitializing Bolt shell...\x1b[0m\r\n');

            // Create a TerminalRef object for the WebContainerManager
            const terminalRefForShell: TerminalRef = {
              terminal: xtermRef.current,
              writeToTerminal: (text: string) => {
                if (xtermRef.current) {
                  xtermRef.current.write(text);
                }
              },
              clearTerminal: () => {
                if (xtermRef.current) {
                  xtermRef.current.clear();
                }
              },
              focus: () => {
                if (xtermRef.current) {
                  xtermRef.current.focus();
                }
              },
              getDimensions: () => ({
                cols: xtermRef.current?.cols || 80,
                rows: xtermRef.current?.rows || 24
              }),
              resize: () => {
                if (fitAddonRef.current) {
                  fitAddonRef.current.fit();
                }
              },
              sendInput: (data: string) => {
                // Input will be handled by the shell's onData listener
              }
            };
            await webContainerManager.initializeShell(terminalRefForShell);

            if (!isMountedRef.current) {
              isSpawningRef.current = false;
              return;
            }
          } else {
            // Restore the persistent shell with this terminal
            term.write('\r\n\x1b[36mRestoring Bolt shell...\x1b[0m\r\n');

            if (persistentShell.restore && term) {
              await persistentShell.restore(term);
            }
          }

          shellReadyRef.current = true;
          shellErrorRef.current = false;

          if (terminalActions) {
            terminalActions.setTerminalInteractive(id, true);
            terminalActions.setTerminalRunning(id, false);
          }

        } catch (error) {
          if (!isMountedRef.current) return;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`Terminal (${id}): Failed to initialize Bolt shell:`, errorMsg);
          shellErrorRef.current = true;
          shellReadyRef.current = false;
          if (term) term.write(`\r\n\x1b[31mError initializing Bolt shell: ${errorMsg}\x1b[0m\r\n`);
          if (terminalActions) {
            terminalActions.setTerminalInteractive(id, false);
            terminalActions.setTerminalRunning(id, false);
          }
        } finally {
          isSpawningRef.current = false;
        }
      };

      // Small delay to ensure terminal is fully ready
      const initTimeout = setTimeout(initializeBoltShell, 500);

      return () => {
        clearTimeout(initTimeout);
        isSpawningRef.current = false;
      };
    }, [id, webContainerInstance, ref]);

    // Improved shell spawning for standard terminals (non-bolt)
    useEffect(() => {
      if (id === 'bolt' || !xtermRef.current || !webContainerInstance ||
        shellProcessRef.current || !isMountedRef.current || isSpawningRef.current) {
        return;
      }

      isSpawningRef.current = true;
      const term = xtermRef.current;

      console.log(`Terminal (${id}): Standard shell effect triggered. Attempting to spawn.`);
      if (terminalActions) {
        terminalActions.setTerminalInteractive(id, false);
        terminalActions.setTerminalRunning(id, true, 'Starting shell...');
      }
      term.write('\r\n\x1b[36mStarting shell...\x1b[0m\r\n');

      const spawnStandardShell = async () => {
        if (!isMountedRef.current || !webContainerInstance || !term) {
          isSpawningRef.current = false;
          return;
        }

        try {
          const cols = term.cols > 0 ? term.cols : 80;
          const rows = term.rows > 0 ? term.rows : 24;

          const localShellProcess = await webContainerInstance.spawn('jsh', [], {
            terminal: { cols, rows }
          });

          if (!isMountedRef.current) {
            localShellProcess.kill();
            isSpawningRef.current = false;
            return;
          }

          shellProcessRef.current = localShellProcess;
          shellReadyRef.current = true;
          shellErrorRef.current = false;

          if (terminalActions?.registerProcessForSession) {
            terminalActions.registerProcessForSession(id, localShellProcess);
          }

          // Create abort controller for this shell session
          cleanupAbortControllerRef.current = new AbortController();
          const signal = cleanupAbortControllerRef.current.signal;

          localShellProcess.output.pipeTo(new WritableStream({
            write(data) {
              if (isMountedRef.current && term && !signal.aborted) {
                term.write(data);
              }
            }
          }), { signal }).catch(err => {
            if (!signal.aborted && isMountedRef.current) {
              console.error(`Terminal (${id}) output pipe error:`, err);
              shellErrorRef.current = true;
            }
          });

          // Dispose previous data listener before setting up new one
          if (dataListenerDisposableRef.current) {
            try {
              console.log(`Terminal (${id}): Disposing previous data listener`);
              dataListenerDisposableRef.current.dispose();
            } catch (e) {
              console.warn(`Terminal (${id}): Error disposing previous data listener:`, e);
            }
            dataListenerDisposableRef.current = null;
            dataListenerSetupRef.current = false;
          }

          if (!dataListenerSetupRef.current) {
            console.log(`Terminal (${id}): Setting up new data listener for session ${sessionIdRef.current}`);
            dataListenerSetupRef.current = true;

            dataListenerDisposableRef.current = term.onData(data => {
              if (shellProcessRef.current === localShellProcess && isMountedRef.current && !signal.aborted) {
                try {
                  const writer = shellProcessRef.current.input.getWriter();
                  writer.write(data).catch(e => {
                    if (!signal.aborted) {
                      console.error(`Terminal (${id}) input write error:`, e);
                    }
                  });
                  writer.releaseLock();
                } catch (e) {
                  if (!signal.aborted) {
                    console.error(`Terminal (${id}) input writer error:`, e);
                  }
                }
              } else {
                console.warn(`Terminal (${id}): Ignoring input data for inactive/aborted session`);
              }
            });
          }

          localShellProcess.exit.then(exitCode => {
            if (isMountedRef.current && term && !signal.aborted) {
              term.write(`\r\n\x1b[33mShell for Terminal ${id} exited with code ${exitCode}\x1b[0m\r\n`);
            }
            if (terminalActions) {
              terminalActions.setTerminalInteractive(id, false);
              terminalActions.setTerminalRunning(id, false);
            }
            if (shellProcessRef.current === localShellProcess) {
              shellProcessRef.current = null;
            }
            shellReadyRef.current = false;
            isSpawningRef.current = false;
          }).catch(err => {
            if (isMountedRef.current && term && !signal.aborted) {
              term.write(`\r\n\x1b[31mShell process for Terminal ${id} error: ${err.message}\x1b[0m\r\n`);
            }
            shellErrorRef.current = true;
            shellReadyRef.current = false;
            isSpawningRef.current = false;
          });

          if (terminalActions) {
            terminalActions.setTerminalInteractive(id, true);
            terminalActions.setTerminalRunning(id, false);
          }
          term.write('❯ ');
          isSpawningRef.current = false;

        } catch (error) {
          if (!isMountedRef.current) return;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`Terminal (${id}): Failed to spawn standard shell:`, errorMsg);
          shellErrorRef.current = true;
          shellReadyRef.current = false;
          if (term) term.write(`\r\n\x1b[31mError starting shell: ${errorMsg}\x1b[0m\r\n`);
          if (terminalActions) {
            terminalActions.setTerminalInteractive(id, false);
            terminalActions.setTerminalRunning(id, false);
          }
          isSpawningRef.current = false;
        }
      };

      const spawnTimeoutId = setTimeout(spawnStandardShell, 250);

      return () => {
        clearTimeout(spawnTimeoutId);
        isSpawningRef.current = false;
      };
    }, [id, webContainerInstance, ref]);

    // Handle active terminal focus
    useEffect(() => {
      if (active && xtermRef.current && isMountedRef.current) {
        xtermRef.current.focus();

        // For bolt terminal, restore the persistent shell if needed
        if (id === 'bolt' && shellReadyRef.current) {
          const persistentShell = webContainerManager.getPersistentShell();
          if (persistentShell.isInitialized() && xtermRef.current) {
            try {
              // Restore the shell with the current terminal
              persistentShell.restore?.(xtermRef.current);
            } catch (error) {
              console.warn(`Terminal (${id}): Error restoring persistent shell on focus:`, error);
            }
          }
        }
      } else if (!active && xtermRef.current) {
        // When terminal becomes inactive, just remove focus but don't kill processes
        console.log(`Terminal (${id}): Became inactive, removing focus`);
        try {
          xtermRef.current.blur();
        } catch (e) {
          console.warn(`Terminal (${id}): Error blurring terminal:`, e);
        }
      }
    }, [active, id]);

    return (
      <div
        className={cn(
          "relative h-full w-full overflow-hidden",
          className
        )}
      >
        <div
          ref={terminalElRef}
          className="h-full w-full"
          style={{ padding: '4px 8px' }}
        />
      </div>
    );
  }
));

Terminal.displayName = 'Terminal';
export default Terminal;
