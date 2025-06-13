// components/EditorPanel.tsx
'use client';

import {
  $workbench,
  getFileLanguage,
  handleEditorContentChange, // Import the main store
  setSelectedFile as setSelectedWorkbenchFile
} from '@/app/lib/stores/workbenchStore';
import { useStore } from '@nanostores/react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import FileExplorer from '@/app/components/chat/FileExplorer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WORK_DIR } from '@/lib/prompt';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@radix-ui/react-tabs';
import { useCallback, useMemo } from 'react';
import CodeEditor2 from './chat/CodeEditor2';
import { FileBreadcrumb } from './chat/FileBreadcrumb';
import { SearchPanel } from './SearchPanel';

export function EditorPanel() {
  const workbenchState = useStore($workbench);
  const { files, selectedFile, currentDocument, streamingContent } = workbenchState;

  const handleFileSelectInTree = useCallback((filePath: string | undefined) => {
    setSelectedWorkbenchFile(filePath || null);
  }, []);

  const handleEditorChange = useCallback((newContent: string) => {
    handleEditorContentChange(newContent);
  }, []);

  // Fix the flickering by creating stable content and language values
  const editorContent = useMemo(() => {
    // If we have streaming content, use it (it takes priority)
    if (streamingContent) {
      return streamingContent.content;
    }
    // Otherwise use the current document content
    return currentDocument?.value || '';
  }, [streamingContent?.content, currentDocument?.value]);

  const editorLanguage = useMemo(() => {
    // Determine language based on the active file
    const activeFilePath = streamingContent?.filePath || currentDocument?.filePath;
    if (!activeFilePath) return 'plaintext';
    
    const fileName = activeFilePath.split('/').pop() || '';
    return getFileLanguage(fileName);
  }, [streamingContent?.filePath, currentDocument?.filePath]);

  const isReadOnly = useMemo(() => {
    // Editor is read-only when streaming
    return streamingContent !== null;
  }, [streamingContent]);

  const activeFileSegments = useMemo(() => {
    // Use streaming content file path if available, otherwise current document
    const activeFilePath = streamingContent?.filePath || currentDocument?.filePath;
    if (!activeFilePath) return [];

    // Ensure WORK_DIR is correctly used for relative path calculation
    const pathWithoutWorkDir = activeFilePath.startsWith(WORK_DIR + '/')
      ? activeFilePath.substring(WORK_DIR.length + 1)
      : activeFilePath.replace(/^\//, '');

    return [WORK_DIR.split('/').pop() || 'project', ...pathWithoutWorkDir.split('/')].filter(Boolean);
  }, [streamingContent?.filePath, currentDocument?.filePath]);

  // Check if we have any content to show
  const hasContent = useMemo(() => {
    return (currentDocument?.filePath && currentDocument && !currentDocument.isBinary) || streamingContent;
  }, [currentDocument, streamingContent]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
      <ResizablePanel defaultSize={25} minSize={15} className="bg-[#101012] flex flex-col min-w-[200px]">
        <Tabs defaultValue="files" className="flex flex-col flex-1 h-full overflow-hidden">
          <TabsList className="bg-[#101012] border-b border-[#313133] rounded-none justify-start h-10">
            <TabsTrigger value="files" className="px-3 py-1.5 text-xs data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]">Files</TabsTrigger>
            <TabsTrigger value="search" className="px-3 py-1.5 text-xs data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]">Search</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="flex-1 mt-0 overflow-hidden bg-[#101012]">
            <ScrollArea className="h-full w-full p-1">
              {Object.keys(files).length === 0 ? (
                <div className="text-center text-xs text-[#969798] pt-4">No files in project.</div>
              ) : (
                <FileExplorer
                  files={Object.keys(files)}
                  selectedFile={selectedFile}
                  onSelectFile={handleFileSelectInTree}
                />
              )}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="search" className="flex-1 overflow-auto mt-0">
            <SearchPanel />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <ResizableHandle className="w-[1px] bg-[#313133]" />
      <ResizablePanel defaultSize={75} className="bg-[#101012] flex flex-col min-w-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#313133] bg-[#161618] flex-shrink-0 h-10">
          {(currentDocument?.filePath || streamingContent?.filePath) ? (
            <div className="flex items-center gap-2">
              <FileBreadcrumb
                pathSegments={activeFileSegments}
                onFileSelect={handleFileSelectInTree}
              />
              {streamingContent && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 border border-blue-500/30 rounded text-blue-400 text-xs">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  Streaming...
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-[#969798]">No file selected</span>
          )}
        </div>
        <div className="flex-1 relative min-h-0">
          {hasContent ? (
            <CodeEditor2
              value={editorContent}
              onChange={handleEditorChange}
              language={editorLanguage}
              readOnly={isReadOnly}
            />
          ) : currentDocument?.isBinary ? (
            <div className="flex items-center justify-center h-full text-[#969798] text-sm">
              Binary file. Cannot be displayed.
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[#969798] text-sm">
              Select a file to edit or view.
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
