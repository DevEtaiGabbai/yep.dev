import type {
  TabVisibilityConfig,
  TabWindowConfig,
} from "@/app/components/@settings/core/types";
import { useStore } from "@nanostores/react";
import Cookies from "js-cookie";
import { useCallback, useState } from "react";
import { getLocalStorage, setLocalStorage } from "../persistence";
import { logStore } from "../stores/logs";
import {
  autoSelectStarterTemplate,
  enableContextOptimizationStore,
  isDebugMode,
  isEventLogsEnabled,
  latestBranchStore,
  promptStore,
  resetTabConfiguration as resetTabConfig,
  tabConfigurationStore,
  updateAutoSelectTemplate,
  updateContextOptimization,
  updateEventLogs,
  updateLatestBranch,
  updatePromptId,
  updateTabConfiguration as updateTabConfig
} from "../stores/settings";

export interface Settings {
  theme: "light" | "dark" | "system";
  language: string;
  notifications: boolean;
  eventLogs: boolean;
  timezone: string;
  tabConfiguration: TabWindowConfig;
}

export interface UseSettingsReturn {
  setTheme: (theme: Settings["theme"]) => void;
  setLanguage: (language: string) => void;
  setNotifications: (enabled: boolean) => void;
  setEventLogs: (enabled: boolean) => void;
  setTimezone: (timezone: string) => void;
  settings: Settings;
  debug: boolean;
  enableDebugMode: (enabled: boolean) => void;
  eventLogs: boolean;
  promptId: string;
  setPromptId: (promptId: string) => void;
  isLatestBranch: boolean;
  enableLatestBranch: (enabled: boolean) => void;
  autoSelectTemplate: boolean;
  setAutoSelectTemplate: (enabled: boolean) => void;
  contextOptimizationEnabled: boolean;
  enableContextOptimization: (enabled: boolean) => void;

  // Tab configuration
  tabConfiguration: TabWindowConfig;
  updateTabConfiguration: (config: TabVisibilityConfig) => void;
  resetTabConfiguration: () => void;
}

export function useSettings(): UseSettingsReturn {
  const debug = useStore(isDebugMode);
  const eventLogs = useStore(isEventLogsEnabled);
  const promptId = useStore(promptStore);
  const isLatestBranch = useStore(latestBranchStore);
  const autoSelectTemplate = useStore(autoSelectStarterTemplate);
  const contextOptimizationEnabled = useStore(enableContextOptimizationStore);
  const tabConfiguration = useStore(tabConfigurationStore);
  const [settings, setSettings] = useState<Settings>(() => {
    const storedSettings = getLocalStorage("settings");
    return {
      theme: storedSettings?.theme || "system",
      language: storedSettings?.language || "en",
      notifications: storedSettings?.notifications ?? true,
      eventLogs: storedSettings?.eventLogs ?? true,
      timezone:
        storedSettings?.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      tabConfiguration,
    };
  });

  const saveSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      setLocalStorage("settings", updated);

      return updated;
    });
  }, []);

  const enableDebugMode = useCallback((enabled: boolean) => {
    isDebugMode.set(enabled);
    logStore.logSystem(`Debug mode ${enabled ? "enabled" : "disabled"}`);
    Cookies.set("isDebugEnabled", String(enabled));
  }, []);

  const setEventLogs = useCallback((enabled: boolean) => {
    updateEventLogs(enabled);
    logStore.logSystem(`Event logs ${enabled ? "enabled" : "disabled"}`);
  }, []);

  const setPromptId = useCallback((id: string) => {
    updatePromptId(id);
    logStore.logSystem(`Prompt template updated to ${id}`);
  }, []);

  const enableLatestBranch = useCallback((enabled: boolean) => {
    updateLatestBranch(enabled);
    logStore.logSystem(
      `Main branch updates ${enabled ? "enabled" : "disabled"}`
    );
  }, []);

  const setAutoSelectTemplate = useCallback((enabled: boolean) => {
    updateAutoSelectTemplate(enabled);
    logStore.logSystem(
      `Auto select template ${enabled ? "enabled" : "disabled"}`
    );
  }, []);

  const enableContextOptimization = useCallback((enabled: boolean) => {
    updateContextOptimization(enabled);
    logStore.logSystem(
      `Context optimization ${enabled ? "enabled" : "disabled"}`
    );
  }, []);

  const setTheme = useCallback(
    (theme: Settings["theme"]) => {
      saveSettings({ theme });
    },
    [saveSettings]
  );

  const setLanguage = useCallback(
    (language: string) => {
      saveSettings({ language });
    },
    [saveSettings]
  );

  const setNotifications = useCallback(
    (enabled: boolean) => {
      saveSettings({ notifications: enabled });
    },
    [saveSettings]
  );

  const setTimezone = useCallback(
    (timezone: string) => {
      saveSettings({ timezone });
    },
    [saveSettings]
  );

  return {
    ...settings,
    debug,
    enableDebugMode,
    eventLogs,
    setEventLogs,
    promptId,
    setPromptId,
    isLatestBranch,
    enableLatestBranch,
    autoSelectTemplate,
    setAutoSelectTemplate,
    contextOptimizationEnabled,
    enableContextOptimization,
    setTheme,
    setLanguage,
    setNotifications,
    setTimezone,
    settings,
    tabConfiguration,
    updateTabConfiguration: updateTabConfig,
    resetTabConfiguration: resetTabConfig,
  };
}
