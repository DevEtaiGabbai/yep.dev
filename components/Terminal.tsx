// components/Terminal.tsx
'use client';

import { CanvasAddon } from '@xterm/addon-canvas'; // For better rendering performance
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl'; // For even better rendering performance, if available
import { ITerminalOptions, ITheme, Terminal as XTerm } from '@xterm/xterm';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useWebContainer } from '@/hooks/useWebContainer'; // To interact with WebContainer
import { cn } from '@/lib/utils';
import { terminalActions } from '@/stores/terminal';

import { WebContainer, WebContainerProcess } from '@webcontainer/api';
import '@xterm/xterm/css/xterm.css';

export interface TerminalRef {
  terminal: XTerm | null;
  writeToTerminal: (text: string) => void;
  clearTerminal: () => void;
  focus: () => void;
  getDimensions: () => { cols: number; rows: number };
  resize: () => void; // Add resize method
  sendInput: (data: string) => void; // Method to send input to the shell process
}

interface TerminalProps {
  id: string; // Unique ID for this terminal instance (e.g., 'bolt', 'terminal_1')
  active?: boolean;
  className?: string;
  onCommand?: (command: string, terminalId: string) => void; // Callback when a command is entered
  onResize?: (cols: number, rows: number) => void;
  initialOptions?: Partial<ITerminalOptions>;
  webContainerInstance?: WebContainer | null; // Pass WebContainer instance if already available
}

const defaultTheme: ITheme = {
  background: '#151718',
  foreground: '#D1D5DB',
  cursor: '#A0A0A0',
  selectionBackground: 'rgba(59, 130, 246, 0.3)', // Semi-transparent blue
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

    const { webContainerInstance } = useWebContainer(ref as React.MutableRefObject<TerminalRef | null>);

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

      // Dispose of data listener
      if (dataListenerDisposableRef.current) {
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

      // Kill shell process safely
      if (shellProcessRef.current) {
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
      shellReadyRef.current = false;
      shellErrorRef.current = false;
      shellErrorMsgShownRef.current = false;
      isSpawningRef.current = false;
      messageQueueRef.current = [];
      dataListenerSetupRef.current = false;
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
      if (!terminalElRef.current || !webContainerInstance || xtermRef.current || !isMountedRef.current) {
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
      }
    }, [id, initialOptions, webContainerInstance, onResize, cleanupTerminal]);

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
                console.log(`Terminal (${id}): Received input data: "${data}" (session: ${sessionIdRef.current})`);
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
          } else {
            console.log(`Terminal (${id}): Data listener already set up, skipping`);
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
    }, [id, webContainerInstance]);

    // Special handling for bolt terminal - use standard shell for now
    useEffect(() => {
      if (id !== 'bolt' || !xtermRef.current || !webContainerInstance ||
        shellProcessRef.current || !isMountedRef.current || isSpawningRef.current) {
        return;
      }

      isSpawningRef.current = true;
      const term = xtermRef.current;

      console.log(`Terminal (${id}): Bolt shell effect triggered. Attempting to spawn.`);
      if (terminalActions) {
        terminalActions.setTerminalInteractive(id, false);
        terminalActions.setTerminalRunning(id, true, 'Starting bolt shell...');
      }
      term.write('\r\n\x1b[36mStarting bolt shell...\x1b[0m\r\n');

      const spawnBoltShell = async () => {
        if (!isMountedRef.current || !webContainerInstance || !term) {
          isSpawningRef.current = false;
          return;
        }

        try {
          const cols = term.cols > 0 ? term.cols : 80;
          const rows = term.rows > 0 ? term.rows : 24;

          // For now, use standard jsh shell for bolt terminal too
          // TODO: Integrate with BoltShell from lib/shell.ts for advanced features
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
                console.log(`Terminal (${id}): Received input data: "${data}" (session: ${sessionIdRef.current})`);
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
          } else {
            console.log(`Terminal (${id}): Data listener already set up, skipping`);
          }

          localShellProcess.exit.then(exitCode => {
            if (isMountedRef.current && term && !signal.aborted) {
              term.write(`\r\n\x1b[33mBolt shell exited with code ${exitCode}\x1b[0m\r\n`);
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
              term.write(`\r\n\x1b[31mBolt shell error: ${err.message}\x1b[0m\r\n`);
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
          console.error(`Terminal (${id}): Failed to spawn bolt shell:`, errorMsg);
          shellErrorRef.current = true;
          shellReadyRef.current = false;
          if (term) term.write(`\r\n\x1b[31mError starting bolt shell: ${errorMsg}\x1b[0m\r\n`);
          if (terminalActions) {
            terminalActions.setTerminalInteractive(id, false);
            terminalActions.setTerminalRunning(id, false);
          }
          isSpawningRef.current = false;
        }
      };

      const spawnTimeoutId = setTimeout(spawnBoltShell, 250);

      return () => {
        clearTimeout(spawnTimeoutId);
        isSpawningRef.current = false;
      };
    }, [id, webContainerInstance]);

    // Handle active terminal focus and shell spawning
    useEffect(() => {
      if (active && xtermRef.current && isMountedRef.current) {
        xtermRef.current.focus();

        // For any terminal (including bolt), if there's no shell process and WebContainer is available, allow spawning
        if (!shellProcessRef.current && !shellSpawnAttempted && webContainerInstance && !isSpawningRef.current) {
          console.log(`Terminal (${id}): Active without shell, attempting to spawn now`);
          setShellSpawnAttempted(true);
          // The shell spawning logic is handled by the previous useEffects
        }
      } else if (!active && xtermRef.current) {
        // When terminal becomes inactive, ensure it's properly cleaned up but don't kill the shell
        console.log(`Terminal (${id}): Became inactive, removing focus`);
        try {
          xtermRef.current.blur();
        } catch (e) {
          console.warn(`Terminal (${id}): Error blurring terminal:`, e);
        }
      }
    }, [active, id, webContainerInstance, shellSpawnAttempted]);

    useImperativeHandle(ref, () => ({
      terminal: xtermRef.current,
      writeToTerminal: (text: string) => {
        if (isMountedRef.current && xtermRef.current) {
          if (shellReadyRef.current && shellProcessRef.current) {
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
        if (isMountedRef.current && shellReadyRef.current && shellProcessRef.current) {
          try {
            const writer = shellProcessRef.current.input.getWriter();
            writer.write(data).catch(e => console.error(`Terminal (${id}) sendInput error:`, e));
            writer.releaseLock();
          } catch (e) {
            console.error(`Terminal (${id}) sendInput writer error:`, e);
          }
        } else if (isMountedRef.current) {
          messageQueueRef.current.push(data);
        }
      }
    }), [id]);

    return (
      <div
        className={cn(
          "relative h-full w-full overflow-hidden",
          className
        )}
      >
        <div
          ref={terminalElRef}
          className="h-full w-full" // xterm will fill this
          style={{ padding: '4px 8px' }} // Add some padding
        />
      </div>
    );
  }
));

Terminal.displayName = 'Terminal';
export default Terminal;
