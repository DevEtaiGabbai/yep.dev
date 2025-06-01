'use client';

import type { WorkbenchFile, WorkbenchFileMap } from '@/app/lib/stores/workbenchStore';
import { $workbench, setSelectedFile, setWorkbenchFiles } from '@/app/lib/stores/workbenchStore';
import { path as pathUtil } from '@/app/utils/path';
import { GITHUB_REPO_URL } from '@/lib/constants';
import { WORK_DIR } from '@/lib/prompt';
import type { GitHubFile } from '@/lib/types';
import {
  extractRepoName,
} from '@/lib/utils';
import { WebContainer } from '@webcontainer/api';
import { useCallback, useEffect, useState } from 'react';


interface RateLimit {
  limit: number;
  remaining: number;
  resetTime: string | null;
}

// Helper to transform raw GitHub files to WorkbenchFileMap
const transformRawGitHubFilesToWorkbenchFileMap = (
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


export const useGitHubFiles = (webContainerInstance: WebContainer | null, customRepoName?: string) => {
  const [files, setLocalFilesState] = useState<WorkbenchFileMap>({});
  const [isLoadingGitHubFiles, setIsLoadingGitHubFiles] = useState(true);
  const [gitHubError, setGitHubError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);
  const [repoName, setRepoName] = useState<string | null>(null);

  useEffect(() => {
    const repoURL = customRepoName || GITHUB_REPO_URL;
    const name = extractRepoName(repoURL);
    setRepoName(name);
  }, [customRepoName]);

  const fetchAndCacheRepoFiles = useCallback(async (
    repoNameToFetch: string,
    forceFetch: boolean = false
  ): Promise<GitHubFile[]> => {
    const url = `/api/github-repo?repo=${encodeURIComponent(repoNameToFetch)}${forceFetch ? '&forceFetch=true' : ''}`;
    const response = await fetch(url);

    // GitHub API rate limit headers (OpenRouter might not include these directly,
    // but your /api/github-repo route could add them if it makes direct GH calls)
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    const reset = response.headers.get('x-ratelimit-reset');

    if (remaining && limit && reset) {
      setRateLimit({
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetTime: new Date(parseInt(reset, 10) * 1000).toLocaleTimeString(),
      });
    }


    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `Failed to fetch repository: ${response.statusText}` }));
      const errorMessage = errorData.error || `Failed to fetch repository: ${response.statusText}`;
      if (response.status === 403 && errorMessage.includes('rate limit')) {
        setGitHubError(`GitHub API rate limit exceeded. ${reset ? `Resets at ${new Date(parseInt(reset) * 1000).toLocaleTimeString()}` : ''}`);
      } else {
        setGitHubError(errorMessage);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (!data.success) {
      setGitHubError(data.error || 'Unknown error fetching repository from API route');
      throw new Error(data.error || 'Unknown error fetching repository from API route');
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
      setGitHubError(`Failed to mount file system: ${mountError.message}`);
    }
  }, [webContainerInstance]);


  const initializeFiles = useCallback(async () => {
    if (!repoName) return;

    setIsLoadingGitHubFiles(true);
    setGitHubError(null);

    try {
      console.log(`Loading files for GitHub repo: ${repoName}`);
      const fetchedRawFiles = await fetchAndCacheRepoFiles(repoName);
      console.log(`Fetched ${fetchedRawFiles.length} files from GitHub repo ${repoName}`);

      if (fetchedRawFiles.length === 0 && Object.keys($workbench.get().files).length === 0) {
        setGitHubError(`No files found in repository: ${repoName}`);
        setIsLoadingGitHubFiles(false);
        return;
      }

      // Transform to WorkbenchFileMap, ensuring paths are absolute for the store
      const workbenchReadyFiles = transformRawGitHubFilesToWorkbenchFileMap(fetchedRawFiles, WORK_DIR);
      setLocalFilesState(workbenchReadyFiles); // Update local state for this hook
      setWorkbenchFiles(workbenchReadyFiles, "useGitHubFiles.initializeFiles"); // Update global store

      const defaultFileEntry = fetchedRawFiles.find(f =>
        f.path.toLowerCase() === 'readme.md' ||
        f.path.toLowerCase() === 'package.json'
      );
      if (defaultFileEntry) {
        const defaultFilePath = pathUtil.join(WORK_DIR, defaultFileEntry.path);
        console.log(`Setting default file: ${defaultFilePath}`);
        setSelectedFile(defaultFilePath);
      }

      if (webContainerInstance) {
        await mountFilesToWebContainer(workbenchReadyFiles);
      } else {
        console.log('WebContainer not ready yet, files will be mounted later');
      }

    } catch (error: any) {
      console.error(`GitHub fetch error for repo ${repoName}:`, error);
      // Error state already set by fetchAndCacheRepoFiles
    } finally {
      setIsLoadingGitHubFiles(false);
      console.log(`useGitHubFiles: initializeFiles completed for ${repoName}`);
    }
  }, [repoName, fetchAndCacheRepoFiles, webContainerInstance, mountFilesToWebContainer]);

  useEffect(() => {
    if (repoName) {
      initializeFiles();
    }
  }, [repoName, initializeFiles]);


  const loadFileContent = useCallback(async (filePath: string): Promise<string> => {
    if (!webContainerInstance) throw new Error("WebContainer not initialized");

    // Ensure filePath is relative for WebContainer FS operations
    let relativePath = filePath;
    if (filePath.startsWith(WORK_DIR + '/')) {
      relativePath = filePath.substring(WORK_DIR.length + 1);
    } else if (filePath.startsWith('/')) {
      relativePath = filePath.substring(1);
    }


    try {
      const content = await webContainerInstance.fs.readFile(relativePath, 'utf-8');
      const updatedFileEntry: WorkbenchFile = {
        ...(files[filePath] as WorkbenchFile),
        path: filePath,
        content: content,
        type: 'file',
        isBinary: false,
      };
      setLocalFilesState(prev => ({ ...prev, [filePath]: updatedFileEntry }));
      return content;
    } catch (error: any) {
      console.error(`Error loading file content for ${filePath} (relative: ${relativePath}):`, error);
      throw error;
    }
  }, [webContainerInstance, files]);

  const refreshRepository = useCallback(async () => {
    if (!repoName) return;
    console.log(`Refreshing repository: ${repoName}`);
    await initializeFiles(); // Re-run the initialization logic
  }, [repoName, initializeFiles]);


  return {
    files,
    selectedFile: $workbench.get().selectedFile,
    isLoadingGitHubFiles,
    gitHubError,
    rateLimit,
    loadFileContent,
    refreshRepository
  };
};
