'use client';

import type { WorkbenchFile, WorkbenchFileMap } from '@/app/lib/stores/workbenchStore';
import { $workbench, setSelectedFile, setWorkbenchFiles } from '@/app/lib/stores/workbenchStore';
import { path as pathUtil } from '@/app/utils/path';
import { WORK_DIR } from '@/lib/prompt';
import type { GitHubFile } from '@/lib/types';
import { WebContainer } from '@webcontainer/api';
import { useCallback, useEffect, useState } from 'react';


// Helper to transform raw template files to WorkbenchFileMap
const transformTemplateFilesToWorkbenchFileMap = (
  rawFiles: GitHubFile[],
  repoRootPath: string = "" // e.g., "/home/project" if you want absolute paths in store
): WorkbenchFileMap => {
  const fileMap: WorkbenchFileMap = {};
  const directories = new Set<string>();

  rawFiles.forEach(file => {
    // Ensure path is relative to repo root if repoRootPath is provided, otherwise use as is
    const fullPath = repoRootPath ? pathUtil.join(repoRootPath, file.path) : file.path;

    // Create parent directories if they don't exist
    const dirParts = file.path.split('/');
    let currentDirPath = repoRootPath;
    for (let i = 0; i < dirParts.length - 1; i++) {
      const part = dirParts[i];
      currentDirPath = pathUtil.join(currentDirPath, part);
      if (!directories.has(currentDirPath)) {
        fileMap[currentDirPath] = {
          name: pathUtil.basename(currentDirPath),
          path: currentDirPath,
          type: 'directory',
          isLocked: false, // Default lock state
        };
        directories.add(currentDirPath);
      }
    }

    fileMap[fullPath] = {
      name: file.name,
      path: fullPath,
      content: file.content,
      type: 'file',
      isBinary: false,
      isLocked: false,
    };
  });
  return fileMap;
};

export const useCloudFrontTemplate = (webContainerInstance: WebContainer | null, templateUrl?: string) => {
  const [files, setLocalFilesState] = useState<WorkbenchFileMap>({});
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);

  const fetchTemplateFiles = useCallback(async (
    urlToFetch: string
  ): Promise<GitHubFile[]> => {
    const url = `/api/template?url=${encodeURIComponent(urlToFetch)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `Failed to fetch template: ${response.statusText}` }));
      const errorMessage = errorData.error || `Failed to fetch template: ${response.statusText}`;
      setTemplateError(errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (!data.success) {
      setTemplateError(data.error || 'Unknown error fetching template from API route');
      throw new Error(data.error || 'Unknown error fetching template from API route');
    }

    return data.files as GitHubFile[];
  }, []);

  const mountFilesToWebContainer = useCallback(async (filesToMount: WorkbenchFileMap) => {
    if (!webContainerInstance) return;
    const wcFileSystem: Record<string, any> = {};

    for (const path in filesToMount) {
      const entry = filesToMount[path];
      if (!entry) continue;

      let wcPath = path;
      if (path.startsWith(WORK_DIR + '/')) {
        wcPath = path.substring(WORK_DIR.length + 1);
      } else if (path.startsWith('/')) {
        wcPath = path.substring(1);
      }

      const parts = wcPath.split('/');
      let currentLevel = wcFileSystem;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!currentLevel[part]) {
          currentLevel[part] = { directory: {} };
        }
        currentLevel = currentLevel[part].directory;
      }
      if (entry.type === 'file') {
        currentLevel[parts[parts.length - 1]] = { file: { contents: (entry as WorkbenchFile).content } };
      } else {
        if (!currentLevel[parts[parts.length - 1]]) {
          currentLevel[parts[parts.length - 1]] = { directory: {} };
        }
      }
    }
    try {
      await webContainerInstance.mount(wcFileSystem);
    } catch (mountError: any) {
      console.error('Error mounting files to WebContainer:', mountError);
      setTemplateError(`Failed to mount file system: ${mountError.message}`);
    }
  }, [webContainerInstance]);

  const initializeFiles = useCallback(async () => {
    if (!templateUrl) {
      return;
    }

    setTemplateError(null);

    try {
      const fetchedRawFiles = await fetchTemplateFiles(templateUrl);

      if (fetchedRawFiles.length === 0 && Object.keys($workbench.get().files).length === 0) {
        setTemplateError(`No files found in template: ${templateUrl}`);
        return;
      }

      // Transform to WorkbenchFileMap, ensuring paths are absolute for the store
      const workbenchReadyFiles = transformTemplateFilesToWorkbenchFileMap(fetchedRawFiles, WORK_DIR);
      setLocalFilesState(workbenchReadyFiles); // Update local state for this hook
      setWorkbenchFiles(workbenchReadyFiles, "useCloudFrontTemplate.initializeFiles"); // Update global store

      const defaultFileEntry = fetchedRawFiles.find(f =>
        f.path.includes("App.") ||
        f.path.includes("main.ts")
      );

      if (defaultFileEntry) {
        const defaultFilePath = pathUtil.join(WORK_DIR, defaultFileEntry.path);
        setSelectedFile(defaultFilePath);
      }

      if (webContainerInstance) {
        await mountFilesToWebContainer(workbenchReadyFiles);
      }

    } catch (error: any) {
      console.error(`Template fetch error for ${templateUrl}:`, error);
    }
  }, [templateUrl, fetchTemplateFiles, webContainerInstance, mountFilesToWebContainer]);

  useEffect(() => {
    if (templateUrl) {
      initializeFiles();
    }
  }, [templateUrl, initializeFiles]);

  return {
    files,
    selectedFile: $workbench.get().selectedFile,
    templateError,
    templateName,
  };
};
