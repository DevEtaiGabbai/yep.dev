import { setWorkbenchFiles, type WorkbenchFile, type WorkbenchFileMap, type WorkbenchFolder } from '@/app/lib/stores/workbenchStore';
import { path } from '@/app/utils/path';
import { WORK_DIR } from '@/lib/prompt';
import { WebContainer } from '@webcontainer/api';

// Directories and files to exclude from the file tree
const EXCLUDED_PATHS = [
  '.bolt',
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  '.vite',
  'coverage',
  '.nyc_output',
  '.DS_Store',
  'Thumbs.db'
];

/**
 * Check if a path should be excluded from the file tree
 */
function shouldExcludePath(filePath: string): boolean {
  const pathParts = filePath.split('/').filter(Boolean);
  return pathParts.some(part => EXCLUDED_PATHS.includes(part));
}

/**
 * Recursively read all files from WebContainer and build workbench file map
 */
async function readDirectoryRecursive(
  webContainer: WebContainer,
  dirPath: string = '/',
  fileMap: WorkbenchFileMap = {}
): Promise<WorkbenchFileMap> {
  try {
    const entries = await webContainer.fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;
      const normalizedPath = path.join(WORK_DIR, entryPath);

      // Skip excluded paths
      if (shouldExcludePath(entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        fileMap[normalizedPath] = {
          name: entry.name,
          path: normalizedPath,
          type: 'directory',
          isLocked: false,
        } as WorkbenchFolder;

        // Recursively read subdirectory
        await readDirectoryRecursive(webContainer, entryPath, fileMap);
      } else if (entry.isFile()) {
        try {
          const content = await webContainer.fs.readFile(entryPath, 'utf-8');
          fileMap[normalizedPath] = {
            name: entry.name,
            path: normalizedPath,
            type: 'file',
            content: content,
            isBinary: false,
            isLocked: false,
          } as WorkbenchFile;
        } catch (error) {
          // Handle binary files or read errors
          console.warn(`Could not read file ${entryPath}:`, error);
          fileMap[normalizedPath] = {
            name: entry.name,
            path: normalizedPath,
            type: 'file',
            content: '// Binary file or read error',
            isBinary: true,
            isLocked: false,
          } as WorkbenchFile;
        }
      }
    }
  } catch (error) {
    console.warn(`Could not read directory ${dirPath}:`, error);
  }

  return fileMap;
}

/**
 * Load all files from WebContainer into workbench store
 */
export async function loadFilesIntoWorkbench(
  webContainer: WebContainer,
  source: string = 'fileSync'
): Promise<WorkbenchFileMap> {
  try {
    const fileMap = await readDirectoryRecursive(webContainer);
    setWorkbenchFiles(fileMap, source);

    return fileMap;
  } catch (error) {
    console.error('Error loading files into workbench:', error);
    return {};
  }
}

/**
 * Auto-refresh file tree from WebContainer
 */
export function startFileSystemWatcher(
  webContainer: WebContainer,
  intervalMs: number = 500
): () => void {

  let isRunning = true;
  let lastSnapshot: string = '';
  let isPaused = false;

  const handleAIStreamingChange = (event: CustomEvent) => {
    const isStreaming = event.detail?.isStreaming;
    const isProcessing = event.detail?.isProcessing;

    // Pause during AI streaming/processing to prevent overwriting AI updates
    isPaused = isStreaming || isProcessing;

    if (!isPaused) {
      setTimeout(() => {
        if (isRunning && !isPaused) {
          console.log('📁 Force refreshing after AI completion');
          loadFilesIntoWorkbench(webContainer, 'fileWatcher-post-AI').catch(console.error);
        }
      }, 1000);
    }
  };

  // Listen for AI streaming events
  if (typeof window !== 'undefined') {
    window.addEventListener('aiStreamingStateChange', handleAIStreamingChange);
  }

  const watchFiles = async () => {
    if (!isRunning) return;

    // Skip if paused during AI operations
    if (isPaused) {
      setTimeout(watchFiles, intervalMs);
      return;
    }

    try {
      // Create a quick snapshot of the file system structure
      const snapshot = await createFileSystemSnapshot(webContainer);

      if (snapshot !== lastSnapshot) {
        await loadFilesIntoWorkbench(webContainer, 'fileWatcher');
        lastSnapshot = snapshot;
      }
    } catch (error) {
      console.warn('File system watcher error:', error);
    }

    if (isRunning) {
      setTimeout(watchFiles, intervalMs);
    }
  };

  // Start watching
  watchFiles();

  return () => {
    isRunning = false;

    if (typeof window !== 'undefined') {
      window.removeEventListener('aiStreamingStateChange', handleAIStreamingChange);
    }
  };
}

/**
 * Create a quick snapshot of file system structure for change detection
 */
async function createFileSystemSnapshot(webContainer: WebContainer): Promise<string> {
  const paths: string[] = [];

  const scanDirectory = async (dirPath: string = '/') => {
    try {
      const entries = await webContainer.fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;

        // Skip excluded paths
        if (shouldExcludePath(entryPath)) {
          continue;
        }

        paths.push(`${entryPath}:${entry.isFile() ? 'file' : 'dir'}`);

        if (entry.isDirectory()) {
          await scanDirectory(entryPath);
        }
      }
    } catch (error) {
      // Ignore errors during snapshot creation
    }
  };

  await scanDirectory();
  return paths.sort().join('|');
}

/**
 * Get excluded paths for reference
 */
export function getExcludedPaths(): readonly string[] {
  return EXCLUDED_PATHS;
}
