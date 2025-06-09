

import { ITheme } from '@xterm/xterm';
import { type ClassValue, clsx } from 'clsx';
import he from 'he';
import { decode as base64Decode } from 'js-base64';
import { twMerge } from 'tailwind-merge';
import { FileEntry } from '../types';
// Define types locally since they aren't exported from types file
export interface GitHubFile {
  name: string;
  path: string;
  content: string;
}

export interface FileSystemTree {
  [key: string]: {
    file?: {
      contents: string;
    };
    directory?: FileSystemTree;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}



const generateTextTree = (tree: FileSystemTree, prefix = ''): string => {
  const entries = Object.entries(tree);
  let treeString = '';
  entries.forEach(([name, node], index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const newPrefix = prefix + (isLast ? '    ' : '│   ');

    if (node && typeof node === 'object' && 'directory' in node && node.directory) {
      treeString += `${prefix}${connector}${name}/\n`;
      treeString += generateTextTree(node.directory, newPrefix);
    } else if (node && typeof node === 'object' && 'file' in node && node.file) {
      treeString += `${prefix}${connector}${name}\n`;
    }
  });
  return treeString;
};


// Define the structure for the output
export interface AIContextData {
  treeString: string;
  contentString: string;
  files: Record<string, FileEntry>;
}

// Function to create WebContainer-mountable file system
export const createMountableFileSystem = (
  filesInput: GitHubFile[] | Record<string, FileEntry> | Record<string, { name: string; content: string; type: string }>
): Record<string, any> => {
  console.log("Creating mountable file system for WebContainer...");

  // Convert input to a consistent array format
  let processedFiles: Array<{ path: string; content: string }> = [];

  if (Array.isArray(filesInput)) {
    processedFiles = filesInput.map(file => ({
      path: file.path,
      content: file.content
    }));
    console.log(`Processing ${processedFiles.length} files from templates`);
  } else {
    processedFiles = Object.entries(filesInput).map(([path, fileEntry]) => ({
      path,
      content: typeof fileEntry.content === 'string'
        ? fileEntry.content
        : JSON.stringify(fileEntry.content)
    }));
    console.log(`Processing ${processedFiles.length} files from state`);
  }

  // Build WebContainer-compatible file system structure
  const fileSystem: Record<string, any> = {};

  const pathsIncluded = new Set<string>();

  for (const file of processedFiles) {
    const pathParts = file.path.split('/');
    let currentLevel = fileSystem;

    // Track the full path of each directory we're creating
    let currentPath = '';

    // Navigate through directories
    for (let i = 0; i < pathParts.length - 1; i++) {
      const dirName = pathParts[i];

      // Skip empty directory names
      if (!dirName) continue;

      // Update current path
      currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;
      pathsIncluded.add(currentPath);

      // Create directory if it doesn't exist
      if (!currentLevel[dirName]) {
        currentLevel[dirName] = { directory: {} };
      } else if (!currentLevel[dirName].directory) {
        // Force directory if something else with the same name exists
        currentLevel[dirName] = { directory: {} };
      }

      // Move to the next level
      currentLevel = currentLevel[dirName].directory;
    }

    // Add the file at the current level
    const fileName = pathParts[pathParts.length - 1];
    if (fileName) {
      currentLevel[fileName] = { file: { contents: file.content } };
      pathsIncluded.add(file.path);
    }
  }

  return fileSystem;
};

export const getLanguageForFilename = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'js' || extension === 'jsx') return 'javascript';
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'html') return 'html';
  if (extension === 'css') return 'css';
  if (extension === 'json') return 'json';
  if (extension === 'md') return 'markdown';
  return 'plaintext';
};

export function extractFilesFromContent(content: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  // First extract the boltArtifact blocks
  const artifactRegex = /<boltArtifact[^>]*>([\s\S]*?)<\/boltArtifact>/g;
  let artifactMatch;

  while ((artifactMatch = artifactRegex.exec(content)) !== null) {
    const artifactContent = artifactMatch[1];

    // Then extract file actions from each artifact
    const fileRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)">([\s\S]*?)(?=<\/boltAction>)/g;
    let fileMatch;

    while ((fileMatch = fileRegex.exec(artifactContent)) !== null) {
      const [_, path, fileContent] = fileMatch;
      if (path && fileContent) {
        files.push({
          path: he.decode(path.trim()),
          content: he.decode(fileContent.trim()),
        });
      }
    }
  }

  // If no boltArtifact was found, try to extract boltAction directly
  // This is for backward compatibility
  if (files.length === 0) {
    const fileRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)">([\s\S]*?)(?=<\/boltAction>|$)/g;
    let match;

    while ((match = fileRegex.exec(content)) !== null) {
      const [_, path, fileContent] = match;
      if (path && fileContent) {
        files.push({
          path: he.decode(path.trim()),
          content: he.decode(fileContent.trim()),
        });
      }
    }
  }

  return files;
}


export function getTerminalTheme(overrides?: ITheme): ITheme {
  return {
    cursor: '#000000',
    cursorAccent: '#000000',
    foreground: '#333333',
    background: '#FFFFFF', // Using white as default background
    selectionBackground: '#00000040',
    selectionForeground: '#333333',
    selectionInactiveBackground: '#00000020',

    // ansi escape code colors
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#686868',
    brightRed: '#cd3131',
    brightGreen: '#00bc00',
    brightYellow: '#949800',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',

    ...overrides,
  };
}
