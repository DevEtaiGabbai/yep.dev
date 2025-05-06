export interface FileEntry {
  type: 'file' | 'directory';
  name?: string;
  content?: string | {};
  children?: Record<string, FileEntry>;
}

// Add window property for WebContainer
declare global {
  interface Window {
    webContainerInstance?: {
      fs: {
        readFile: (path: string, encoding: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<void>;
      };
    };
  }
} 