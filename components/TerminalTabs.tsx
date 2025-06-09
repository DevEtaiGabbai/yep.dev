'use client';

import Terminal, { TerminalRef } from '@/components/Terminal';
import { Button } from '@/components/ui/button';
import { useWebContainer } from '@/hooks/useWebContainer';
import { cn } from '@/lib/utils';
import { $terminalStore, MAX_TERMINALS, terminalActions } from '@/stores/terminal'; // Updated import
import { useStore } from '@nanostores/react';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';
import React, { createRef, useCallback, useEffect, useRef, type RefObject } from 'react';


interface TerminalTabsProps {
  className?: string;
  terminalRef?: RefObject<TerminalRef | null>;
}

const TerminalTabs: React.FC<TerminalTabsProps> = ({
  className,
  terminalRef
}) => {
  const terminalStoreState = useStore($terminalStore);
  const { sessions, activeTerminalId, terminalPanelHeight } = terminalStoreState;
  const { webContainerInstance } = useWebContainer(terminalRef);

  const terminalInitFailuresRef = useRef<Record<string, number>>({});
  const initializeTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const xtermComponentRefsRef = useRef<Record<string, React.RefObject<TerminalRef>>>({});

  const getOrCreateTerminalRef = useCallback((sessionId: string) => {
    if (sessionId === 'bolt') {
      return terminalRef;
    }

    if (!xtermComponentRefsRef.current[sessionId]) {
      xtermComponentRefsRef.current[sessionId] = createRef<TerminalRef>();
      console.log(`Created new ref for terminal: ${sessionId}`);
    }

    return xtermComponentRefsRef.current[sessionId];
  }, [terminalRef]);

  // Clean up refs for removed sessions
  useEffect(() => {
    const currentSessionIds = Object.keys(sessions);
    const refSessionIds = Object.keys(xtermComponentRefsRef.current);

    // Remove refs for sessions that no longer exist
    refSessionIds.forEach(sessionId => {
      if (!currentSessionIds.includes(sessionId)) {
        console.log(`Cleaning up ref for removed terminal: ${sessionId}`);
        delete xtermComponentRefsRef.current[sessionId];
      }
    });
  }, [sessions]);

  useEffect(() => {
    // Copy the ref value to a variable to use in cleanup
    const currentTimeouts = initializeTimeoutsRef.current;

    return () => {
      Object.values(currentTimeouts).forEach(timeout => {
        clearTimeout(timeout);
      });
    };
  }, []);

  const handleTerminalResize = useCallback((cols: number, rows: number, id: string) => {
    if (terminalActions?.updateTerminalDimensions) {
      console.log(`Terminal ${id} dimensions updated to ${cols}x${rows}`);
      terminalActions.updateTerminalDimensions(id, cols, rows);
    }
  }, []);

  const safeInitializeTerminal = useCallback((terminalId: string) => {
    if (terminalId === 'bolt') {
      return;
    }
    // Limit retries to prevent excessive attempts
    if (!terminalId || (terminalInitFailuresRef.current[terminalId] || 0) >= 3) {
      console.warn(`Terminal ${terminalId} initialization skipped after too many failures`);
      return;
    }

    // If there's a pending timeout for this terminal, clear it
    if (initializeTimeoutsRef.current[terminalId]) {
      clearTimeout(initializeTimeoutsRef.current[terminalId]);
    }

    initializeTimeoutsRef.current[terminalId] = setTimeout(() => {
      const termRef = terminalId === 'bolt' ? terminalRef : getOrCreateTerminalRef(terminalId);

      // If terminal or WebContainer isn't available, track failure and retry up to 3 times
      if (!termRef?.current || !webContainerInstance) {
        terminalInitFailuresRef.current[terminalId] = (terminalInitFailuresRef.current[terminalId] || 0) + 1;

        if (terminalInitFailuresRef.current[terminalId] < 3) {
          safeInitializeTerminal(terminalId);
        } else {
          console.error(`Terminal ${terminalId} initialization failed after multiple attempts`);
        }
        return;
      }

      delete terminalInitFailuresRef.current[terminalId];
    }, 300);
  }, [terminalRef, getOrCreateTerminalRef, webContainerInstance]);

  useEffect(() => {
    if (activeTerminalId && sessions[activeTerminalId] && activeTerminalId !== 'bolt') {
      safeInitializeTerminal(activeTerminalId);
    }
  }, [activeTerminalId, sessions, safeInitializeTerminal]);

  const handleAddNewTerminal = useCallback(async () => {
    if (Object.keys(sessions).length >= MAX_TERMINALS) {
      console.warn(`Maximum number of terminals (${MAX_TERMINALS}) reached.`);
      return;
    }

    const newTerminalId = terminalActions.createNewTerminal();
    if (newTerminalId) {
      terminalActions.setActiveTerminal(newTerminalId);

      safeInitializeTerminal(newTerminalId);
    }
  }, [sessions, safeInitializeTerminal]);

  const handleCloseTerminal = useCallback((id: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }

    if (id === 'bolt') {
      console.warn("Cannot close the main Bolt terminal.");
      return;
    }

    // Clear any pending initialization timeouts
    if (initializeTimeoutsRef.current[id]) {
      clearTimeout(initializeTimeoutsRef.current[id]);
      delete initializeTimeoutsRef.current[id];
    }

    // Clear initialization failure records
    delete terminalInitFailuresRef.current[id];

    terminalActions.closeTerminal(id);
  }, []);

  const handleClearActiveTerminal = useCallback(() => {
    const refToClear = activeTerminalId === 'bolt'
      ? terminalRef
      : getOrCreateTerminalRef(activeTerminalId);

    if (refToClear?.current) {
      refToClear.current.clearTerminal();
    }
  }, [activeTerminalId, terminalRef, getOrCreateTerminalRef]);

  const terminalSessionsArray = Object.values(sessions);

  if (terminalSessionsArray.length === 0) {
    return null;
  }

  return (
    <div
      id="terminal-container"
      className={cn(
        "border-t border-[#2a2a2c] bg-[#101012]",
        className
      )}
      style={{ height: terminalPanelHeight }}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-2 border-b border-[#2a2a2c] bg-[#161618] h-10 flex-shrink-0">
          <div className="bg-transparent h-full border-b-0 p-0 flex">
            {terminalSessionsArray.map(session => (
              <div
                key={session.id}
                className={cn(
                  "relative h-full border-r border-[#2a2a2c] last:border-r-0 border-b-2 flex items-center",
                  activeTerminalId === session.id
                    ? "bg-[#1f1f21] shadow-none text-white border-b-blue-500"
                    : "text-[#888888] border-b-transparent"
                )}
              >
                <button
                  onClick={() => {
                    if (sessions[session.id]) {
                      terminalActions.setActiveTerminal(session.id);
                    }
                  }}
                  className="flex-1 px-3 py-1 h-full text-xs text-left bg-transparent border-none outline-none hover:bg-[#313133]"
                >
                  {session.label}
                </button>
                {terminalInitFailuresRef.current[session.id] >= 3 && (
                  <span className="absolute -top-1 left-2 text-red-500">
                    <AlertCircle size={12} />
                  </span>
                )}
                {session.type === 'standard' && terminalSessionsArray.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTerminal(session.id, e)}
                    className="ml-1 mr-2 text-[#6e6e6e] hover:text-white p-0.5 hover:bg-[#313133] rounded-full flex-shrink-0"
                    aria-label={`Close ${session.label}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {terminalSessionsArray.length < MAX_TERMINALS && (
              <Button
                variant="ghost"
                size="icon"
                className="h-full w-8 text-[#888888] hover:text-white rounded-none border-r border-[#2a2a2c]"
                onClick={handleAddNewTerminal}
                aria-label="Add new terminal"
              >
                <Plus size={14} />
              </Button>
            )}
          </div>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#888888] hover:text-white hover:bg-[#313133]"
              onClick={handleClearActiveTerminal}
              aria-label="Clear active terminal"
              title="Clear Terminal"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-[#151718] relative">
          {terminalSessionsArray.map(session => {
            const isActive = activeTerminalId === session.id;

            return (
              <div
                key={session.id}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: isActive ? 'flex' : 'none'
                }}
              >
                <Terminal
                  id={session.id}
                  ref={session.id === 'bolt' ? terminalRef : getOrCreateTerminalRef(session.id)}
                  active={isActive}
                  onResize={(cols, rows) => handleTerminalResize(cols, rows, session.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Use React.memo to prevent unnecessary re-renders
export default React.memo(TerminalTabs);
