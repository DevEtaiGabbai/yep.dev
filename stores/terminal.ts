// stores/terminal.ts
import type { WebContainerProcess } from "@webcontainer/api";
import { computed, map } from "nanostores";

export const coloredText = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
};

declare global {
  interface ImportMeta {
    hot?: {
      data: Record<string, any>;
    };
  }
}

export const MAX_TERMINALS = 5;

export interface TerminalSession {
  id: string;
  label: string;
  process: WebContainerProcess | null;
  type: "bolt" | "standard";
  isActive: boolean;
  isRunningCommand: boolean;
  currentCommand?: string;
  isInteractive: boolean;
  cols?: number;
  rows?: number;
}

export interface TerminalStoreState {
  sessions: Record<string, TerminalSession>;
  activeTerminalId: string;
  showTerminalPanel: boolean;
  terminalPanelHeight: string;
}

const initialBoltTerminalSession: TerminalSession = {
  id: "bolt",
  label: "Bolt Terminal",
  process: null,
  type: "bolt",
  isActive: true,
  isRunningCommand: false,
  isInteractive: false,
  cols: 80,
  rows: 24,
};

const initialTerminalState: TerminalStoreState = {
  sessions: { bolt: initialBoltTerminalSession },
  activeTerminalId: "bolt",
  showTerminalPanel: true,
  terminalPanelHeight: "100%",
};

export const $terminalStore = map<TerminalStoreState>(initialTerminalState);

export type TerminalActions = {
  toggleTerminalPanel: (show?: boolean) => any;
  setTerminalPanelHeight: (height?: string) => any;
  setActiveTerminal: (id?: string) => any;
};
export const terminalActions = {
  toggleTerminalPanel: (show?: boolean) => {
    const currentShowState = $terminalStore.get().showTerminalPanel;
    $terminalStore.setKey(
      "showTerminalPanel",
      show === undefined ? !currentShowState : show
    );
  },

  setTerminalPanelHeight: (height: string) => {
    $terminalStore.setKey("terminalPanelHeight", height);
  },

  setActiveTerminal: (id: string) => {
    const currentStore = $terminalStore.get();
    const currentSessions = currentStore.sessions;
    if (currentSessions[id]) {
      const updatedSessions = { ...currentSessions };
      Object.keys(updatedSessions).forEach((sessionId) => {
        updatedSessions[sessionId] = {
          ...updatedSessions[sessionId],
          isActive: sessionId === id,
        };
      });
      $terminalStore.setKey("sessions", updatedSessions);
      $terminalStore.setKey("activeTerminalId", id);
    } else {
      console.warn(
        `TerminalTabs: Attempted to set active terminal to non-existent ID: ${id}. Current sessions:`,
        Object.keys(currentSessions)
      );
      if (currentSessions["bolt"]) {
        terminalActions.setActiveTerminal("bolt");
      }
    }
  },

  createNewTerminal: (): string | null => {
    const currentStore = $terminalStore.get();
    const currentSessions = currentStore.sessions;
    if (Object.keys(currentSessions).length >= MAX_TERMINALS) {
      console.warn(`Maximum number of terminals (${MAX_TERMINALS}) reached.`);
      return null;
    }
    const newId = `terminal_${Date.now()}`;
    const newLabel = `Terminal ${Object.keys(currentSessions).length}`;

    const newSession: TerminalSession = {
      id: newId,
      label: newLabel,
      process: null,
      type: "standard",
      isActive: false,
      isRunningCommand: false,
      isInteractive: true,
      cols: 80,
      rows: 24,
    };

    $terminalStore.setKey("sessions", {
      ...currentSessions,
      [newId]: newSession,
    });
    terminalActions.setActiveTerminal(newId); // This will update activeTerminalId in the store
    return newId;
  },

  closeTerminal: (id: string) => {
    if (id === "bolt") {
      console.warn("Cannot close the main Bolt terminal.");
      return;
    }
    const currentStore = $terminalStore.get();
    const currentSessions = { ...currentStore.sessions }; // Create a mutable copy
    const sessionToClose = currentSessions[id];

    if (sessionToClose) {
      sessionToClose.process?.kill();
      delete currentSessions[id];
      $terminalStore.setKey("sessions", currentSessions);

      if (currentStore.activeTerminalId === id) {
        terminalActions.setActiveTerminal("bolt");
      }
    }
  },

  setTerminalRunning: (
    terminalId: string,
    isRunning: boolean,
    command?: string
  ) => {
    const currentStore = $terminalStore.get();
    const sessions = currentStore.sessions;
    if (sessions[terminalId]) {
      const updatedSession = {
        ...sessions[terminalId],
        isRunningCommand: isRunning,
        currentCommand: isRunning ? command : undefined,
        isInteractive: !isRunning,
      };
      $terminalStore.setKey("sessions", {
        ...sessions,
        [terminalId]: updatedSession,
      });
    }
  },

  setTerminalInteractive: (terminalId: string, isInteractive: boolean) => {
    const currentStore = $terminalStore.get();
    const sessions = currentStore.sessions;
    if (sessions[terminalId]) {
      const updatedSession = { ...sessions[terminalId], isInteractive };
      $terminalStore.setKey("sessions", {
        ...sessions,
        [terminalId]: updatedSession,
      });
    }
  },

  registerProcessForSession: (
    sessionId: string,
    process: WebContainerProcess | null
  ) => {
    const currentStore = $terminalStore.get();
    const sessions = currentStore.sessions;
    if (sessions[sessionId]) {
      const updatedSession = {
        ...sessions[sessionId],
        process: process,
        isInteractive: !!process,
      };
      $terminalStore.setKey("sessions", {
        ...sessions,
        [sessionId]: updatedSession,
      });
    } else {
      console.warn(
        `Terminal session with ID ${sessionId} not found for process registration.`
      );
    }
  },

  updateTerminalDimensions: (
    terminalId: string,
    cols: number,
    rows: number
  ) => {
    const currentStore = $terminalStore.get();
    const sessions = currentStore.sessions;
    const session = sessions[terminalId];
    if (session) {
      const updatedSession = { ...session, cols, rows };
      $terminalStore.setKey("sessions", {
        ...sessions,
        [terminalId]: updatedSession,
      });
      session.process?.resize({ cols, rows });
    }
  },
};

export function getTerminalStore() {
  return {
    // For useStore hook on the whole state object if needed directly
    $store: $terminalStore,
    // Computed atoms for reactive UI updates
    $terminalSessionsArray: computed($terminalStore, (store) =>
      Object.values(store.sessions)
    ),
    $activeTerminalId: computed(
      $terminalStore,
      (store) => store.activeTerminalId
    ),
    $showTerminalPanel: computed(
      $terminalStore,
      (store) => store.showTerminalPanel
    ),
    $terminalPanelHeight: computed(
      $terminalStore,
      (store) => store.terminalPanelHeight
    ),
    // Expose actions directly
    actions: terminalActions,
  };
}
