// components/TerminalTabs.tsx
'use client';

import Terminal, { TerminalRef } from '@/components/Terminal';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWebContainer } from '@/hooks/useWebContainer';
import { cn } from '@/lib/utils';
import { $terminalStore, MAX_TERMINALS, terminalActions } from '@/stores/terminal'; // Updated import
import { useStore } from '@nanostores/react';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';
import React, { createRef, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';


interface TerminalTabsProps {
  className?: string;
  terminalRef?: RefObject<TerminalRef | null>; // Main/Bolt terminal ref
}

const TerminalTabs: React.FC<TerminalTabsProps> = ({
  className,
  terminalRef // This is the ref for the "Bolt Terminal"
}) => {
  const terminalStoreState = useStore($terminalStore);
  const { sessions, activeTerminalId, terminalPanelHeight } = terminalStoreState;
  const { webContainerInstance } = useWebContainer(terminalRef);

  const terminalInitFailuresRef = useRef<Record<string, number>>({});
  const initializeTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const xtermComponentRefsRef = useRef<Record<string, React.RefObject<TerminalRef>>>({});

  // Create stable refs that don't get recreated unnecessarily
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
    // Skip initialization for 'bolt' terminal, it's managed by persistent shell logic
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
          console.log(`Terminal ${terminalId} initialization failed, retrying...`);
          safeInitializeTerminal(terminalId);
        } else {
          console.error(`Terminal ${terminalId} initialization failed after multiple attempts`);
        }
        return;
      }

      console.log(`Terminal ${terminalId} initialized successfully`);
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
      <Tabs
        value={activeTerminalId}
        onValueChange={(newTabId) => {
          if (sessions[newTabId]) {
            terminalActions.setActiveTerminal(newTabId);
          }
        }}
        className="h-full flex flex-col"
      >
        <div className="flex items-center justify-between px-2 border-b border-[#2a2a2c] bg-[#161618] h-10 flex-shrink-0">
          <TabsList className="bg-transparent h-full border-b-0 p-0">
            {terminalSessionsArray.map(session => (
              <TabsTrigger
                key={session.id}
                value={session.id}
                className="relative data-[state=active]:bg-[#1f1f21] data-[state=active]:shadow-none data-[state=active]:text-white data-[state=inactive]:text-[#888888] px-3 py-1 h-full text-xs rounded-none border-r border-[#2a2a2c] last:border-r-0 data-[state=active]:border-b-2 data-[state=active]:border-b-blue-500 data-[state=inactive]:border-b-2 data-[state=inactive]:border-b-transparent"
              >
                {session.label}
                {terminalInitFailuresRef.current[session.id] >= 3 && (
                  <span className="absolute -top-1 -right-1 text-red-500">
                    <AlertCircle size={12} />
                  </span>
                )}
                {session.type === 'standard' && terminalSessionsArray.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTerminal(session.id, e)}
                    className="ml-2 text-[#6e6e6e] hover:text-white absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[#313133] rounded-full"
                    aria-label={`Close ${session.label}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </TabsTrigger>
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
          </TabsList>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#888888] hover:text-white"
              onClick={handleClearActiveTerminal}
              aria-label="Clear active terminal"
              title="Clear Terminal"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-[#151718]">
          {terminalSessionsArray.map(session => {
            // We need a unique key for tab content even if we conditionally render the Terminal
            const isActive = activeTerminalId === session.id;

            return (
              <TabsContent
                key={session.id}
                value={session.id}
                className="h-full data-[state=active]:flex data-[state=active]:flex-col mt-0 border-0 p-0"
              >
                {(isActive || session.id === 'bolt') && (
                  <Terminal
                    id={session.id}
                    ref={session.id === 'bolt' ? terminalRef : getOrCreateTerminalRef(session.id)}
                    active={isActive}
                    onResize={(cols, rows) => handleTerminalResize(cols, rows, session.id)}
                  />
                )}
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </div>
  );
};

// Use React.memo to prevent unnecessary re-renders
export default React.memo(TerminalTabs);
