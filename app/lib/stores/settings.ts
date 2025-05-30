import { DEFAULT_TAB_CONFIG } from "@/app/components/@settings/core/constants";
import type {
  DevTabConfig,
  TabVisibilityConfig,
  TabWindowConfig,
  UserTabConfig,
} from "@/app/components/@settings/core/types";
import Cookies from "js-cookie";
import { atom, map } from "nanostores";
import { create } from "zustand";
import { toggleTheme } from "./theme";

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlOrMetaKey?: boolean;
  action: () => void;
  description?: string;
  isPreventDefault?: boolean;
}

export interface Shortcuts {
  toggleTheme: Shortcut;
  toggleTerminal: Shortcut;
}

export const URL_CONFIGURABLE_PROVIDERS = ["Ollama", "LMStudio", "OpenAILike"];
export const LOCAL_PROVIDERS = ["OpenAILike", "LMStudio", "Ollama"];

// Simplified shortcuts store with only theme toggle
export const shortcutsStore = map<Shortcuts>({
  toggleTheme: {
    key: "d",
    metaKey: true,
    altKey: true,
    shiftKey: true,
    action: () => toggleTheme(),
    description: "Toggle theme",
    isPreventDefault: true,
  },
  toggleTerminal: {
    key: "`",
    ctrlOrMetaKey: true,
    action: () => {
      // This will be handled by the terminal component
    },
    description: "Toggle terminal",
    isPreventDefault: true,
  },
});

const isBrowser = typeof window !== "undefined";


export const isDebugMode = atom(false);

// Define keys for localStorage
const SETTINGS_KEYS = {
  LATEST_BRANCH: "isLatestBranch",
  AUTO_SELECT_TEMPLATE: "autoSelectTemplate",
  CONTEXT_OPTIMIZATION: "contextOptimizationEnabled",
  EVENT_LOGS: "isEventLogsEnabled",
  PROMPT_ID: "promptId",
  DEVELOPER_MODE: "isDeveloperMode",
} as const;

// Initialize settings from localStorage or defaults
const getInitialSettings = () => {
  const getStoredBoolean = (key: string, defaultValue: boolean): boolean => {
    if (!isBrowser) {
      return defaultValue;
    }

    const stored = localStorage.getItem(key);

    if (stored === null) {
      return defaultValue;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return defaultValue;
    }
  };

  return {
    latestBranch: getStoredBoolean(SETTINGS_KEYS.LATEST_BRANCH, false),
    autoSelectTemplate: getStoredBoolean(
      SETTINGS_KEYS.AUTO_SELECT_TEMPLATE,
      true
    ),
    contextOptimization: getStoredBoolean(
      SETTINGS_KEYS.CONTEXT_OPTIMIZATION,
      true
    ),
    eventLogs: getStoredBoolean(SETTINGS_KEYS.EVENT_LOGS, true),
    promptId: isBrowser
      ? localStorage.getItem(SETTINGS_KEYS.PROMPT_ID) || "default"
      : "default",
    developerMode: getStoredBoolean(SETTINGS_KEYS.DEVELOPER_MODE, false),
  };
};

// Initialize stores with persisted values
const initialSettings = getInitialSettings();

export const latestBranchStore = atom<boolean>(initialSettings.latestBranch);
export const autoSelectStarterTemplate = atom<boolean>(
  initialSettings.autoSelectTemplate
);
export const enableContextOptimizationStore = atom<boolean>(
  initialSettings.contextOptimization
);
export const isEventLogsEnabled = atom<boolean>(initialSettings.eventLogs);
export const promptStore = atom<string>(initialSettings.promptId);

// Helper functions to update settings with persistence
export const updateLatestBranch = (enabled: boolean) => {
  latestBranchStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.LATEST_BRANCH, JSON.stringify(enabled));
};

export const updateAutoSelectTemplate = (enabled: boolean) => {
  autoSelectStarterTemplate.set(enabled);
  localStorage.setItem(
    SETTINGS_KEYS.AUTO_SELECT_TEMPLATE,
    JSON.stringify(enabled)
  );
};

export const updateContextOptimization = (enabled: boolean) => {
  enableContextOptimizationStore.set(enabled);
  localStorage.setItem(
    SETTINGS_KEYS.CONTEXT_OPTIMIZATION,
    JSON.stringify(enabled)
  );
};

export const updateEventLogs = (enabled: boolean) => {
  isEventLogsEnabled.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.EVENT_LOGS, JSON.stringify(enabled));
};

export const updatePromptId = (id: string) => {
  promptStore.set(id);
  localStorage.setItem(SETTINGS_KEYS.PROMPT_ID, id);
};

// Initialize tab configuration from localStorage or defaults
const getInitialTabConfiguration = (): TabWindowConfig => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter(
      (tab): tab is UserTabConfig => tab.window === "user"
    ),
    developerTabs: DEFAULT_TAB_CONFIG.filter(
      (tab): tab is DevTabConfig => tab.window === "developer"
    ),
  };

  if (!isBrowser) {
    return defaultConfig;
  }

  try {
    const saved = localStorage.getItem("bolt_tab_configuration");

    if (!saved) {
      return defaultConfig;
    }

    const parsed = JSON.parse(saved);

    if (!parsed?.userTabs || !parsed?.developerTabs) {
      return defaultConfig;
    }

    // Ensure proper typing of loaded configuration
    return {
      userTabs: parsed.userTabs.filter(
        (tab: TabVisibilityConfig): tab is UserTabConfig =>
          tab.window === "user"
      ),
      developerTabs: parsed.developerTabs.filter(
        (tab: TabVisibilityConfig): tab is DevTabConfig =>
          tab.window === "developer"
      ),
    };
  } catch (error) {
    console.warn("Failed to parse tab configuration:", error);
    return defaultConfig;
  }
};

export const tabConfigurationStore = map<TabWindowConfig>(
  getInitialTabConfiguration()
);

// Helper function to update tab configuration
export const updateTabConfiguration = (config: TabVisibilityConfig) => {
  const currentConfig = tabConfigurationStore.get();

  const isUserTab = config.window === "user";
  const targetArray = isUserTab ? "userTabs" : "developerTabs";

  // Only update the tab in its respective window
  const updatedTabs = currentConfig[targetArray].map((tab) =>
    tab.id === config.id ? { ...config } : tab
  );

  // If tab doesn't exist in this window yet, add it
  if (!updatedTabs.find((tab) => tab.id === config.id)) {
    updatedTabs.push(config);
  }

  // Create new config, only updating the target window's tabs
  const newConfig: TabWindowConfig = {
    ...currentConfig,
    [targetArray]: updatedTabs,
  };

  tabConfigurationStore.set(newConfig);
  Cookies.set("tabConfiguration", JSON.stringify(newConfig), {
    expires: 365, // Set cookie to expire in 1 year
    path: "/",
    sameSite: "strict",
  });
};

// Helper function to reset tab configuration
export const resetTabConfiguration = () => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter(
      (tab): tab is UserTabConfig => tab.window === "user"
    ),
    developerTabs: DEFAULT_TAB_CONFIG.filter(
      (tab): tab is DevTabConfig => tab.window === "developer"
    ),
  };

  tabConfigurationStore.set(defaultConfig);
  localStorage.setItem("bolt_tab_configuration", JSON.stringify(defaultConfig));
};

// Developer mode store with persistence
export const developerModeStore = atom<boolean>(initialSettings.developerMode);

export const setDeveloperMode = (value: boolean) => {
  developerModeStore.set(value);

  if (isBrowser) {
    localStorage.setItem(SETTINGS_KEYS.DEVELOPER_MODE, JSON.stringify(value));
  }
};

// First, let's define the SettingsStore interface
interface SettingsStore {
  isOpen: boolean;
  selectedTab: string;
  openSettings: () => void;
  closeSettings: () => void;
  setSelectedTab: (tab: string) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isOpen: false,
  selectedTab: "user", // Default tab

  openSettings: () => {
    set({
      isOpen: true,
      selectedTab: "user", // Always open to user tab
    });
  },

  closeSettings: () => {
    set({
      isOpen: false,
      selectedTab: "user", // Reset to user tab when closing
    });
  },

  setSelectedTab: (tab: string) => {
    set({ selectedTab: tab });
  },
}));
