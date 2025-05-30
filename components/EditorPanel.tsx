// components/EditorPanel.tsx
'use client';

import {
  $workbench, handleEditorContentChange, // Import the main store
  setSelectedFile as setSelectedWorkbenchFile
} from '@/app/lib/stores/workbenchStore';
import { useStore } from '@nanostores/react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

// import { useWebContainer } from '@/hooks/useWebContainer'; // Not directly needed if save/reset are higher up
// import { toast } from '../ui/use-toast'; // Toasts are handled higher up
import FileExplorer from '@/app/components/chat/FileExplorer';
import { WORK_DIR } from '@/lib/prompt';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@radix-ui/react-tabs';
import { useCallback, useEffect, useMemo, useRef } from 'react'; // Added useCallback
import CodeEditor2 from './chat/CodeEditor2';
import { FileBreadcrumb } from './chat/FileBreadcrumb';
import { SearchPanel } from './SearchPanel';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EditorPanelProps {
  // EditorPanel will now mostly read from the $workbench store.
  // We might still pass down specific interaction handlers if they don't belong in the store.
  isStreaming?: boolean; // Example: To make editor read-only during AI generation
  // onFileSave: () => void; // Moved to Workbench.tsx header
  // onFileReset: () => void; // Moved to Workbench.tsx header
}

export function EditorPanel({ isStreaming }: EditorPanelProps) {
  const workbenchState = useStore($workbench);
  const { files, selectedFile, currentDocument, unsavedFiles } = workbenchState;
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleFileSelectInTree = useCallback((filePath: string | undefined) => {
    setSelectedWorkbenchFile(filePath || null);
  }, []);


  const handleEditorChange = useCallback((newContent: string) => {
    handleEditorContentChange(newContent);
  }, []);


  const activeFileSegments = useMemo(() => {
    if (!currentDocument?.filePath) return [];
    // Ensure WORK_DIR is correctly used for relative path calculation
    const pathWithoutWorkDir = currentDocument.filePath.startsWith(WORK_DIR + '/')
      ? currentDocument.filePath.substring(WORK_DIR.length + 1)
      : currentDocument.filePath.replace(/^\//, '');

    return [WORK_DIR.split('/').pop() || 'project', ...pathWithoutWorkDir.split('/')].filter(Boolean);
  }, [currentDocument?.filePath]);


  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const scrollContainer = chatContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };


  const handleScroll = () => {
    if (chatContainerRef.current) {
      const scrollContainer = chatContainerRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        // Consider "at bottom" if within 50px of the bottom
      }
    }
  };

  useEffect(() => {
    scrollToBottom();

    // Add scroll event listener
    const scrollContainer = chatContainerRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, []);


  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
      <ResizablePanel defaultSize={25} minSize={15} className="bg-[#101012] flex flex-col min-w-[200px]">
        <Tabs defaultValue="files" className="flex flex-col flex-1 h-full overflow-hidden">
          <TabsList className="bg-[#101012] border-b border-[#313133] rounded-none justify-start px-2 h-10">
            <TabsTrigger value="files" className="px-3 py-1.5 text-xs data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]">Files</TabsTrigger>
            <TabsTrigger value="search" className="px-3 py-1.5 text-xs data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]">Search</TabsTrigger>
            {/* <TabsTrigger value="locks" className="px-3 py-1.5 text-xs data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]">Locks</TabsTrigger> */}
          </TabsList>
          <ScrollArea className="h-full bg-[#101012]" ref={chatContainerRef}>
            <TabsContent value="files" className="flex-1 mt-0 p-1">

              {Object.keys(files).length === 0 ? (
                <div className="text-center text-xs text-[#969798] pt-4">No files in project.</div>
              ) : (
                <FileExplorer
                  files={Object.keys(files)} // Pass only paths
                  selectedFile={selectedFile}
                  onSelectFile={handleFileSelectInTree}
                />
              )}
            </TabsContent>
          </ScrollArea>
          <TabsContent value="search" className="flex-1 overflow-auto mt-0">
            <SearchPanel />
          </TabsContent>
          {/* <TabsContent value="locks" className="flex-1 overflow-auto mt-0">
            <LockManager />
          </TabsContent> */}
        </Tabs>
      </ResizablePanel>
      <ResizableHandle className="w-[1px] bg-[#313133]" />
      <ResizablePanel defaultSize={75} className="bg-[#101012] flex flex-col min-w-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#313133] bg-[#161618] flex-shrink-0 h-10">
          {currentDocument?.filePath ? (
            <FileBreadcrumb
              pathSegments={activeFileSegments}
              onFileSelect={handleFileSelectInTree}
            />
          ) : (
            <span className="text-xs text-[#969798]">No file selected</span>
          )}
        </div>
        <div className="flex-1 relative min-h-0">
          {currentDocument?.filePath && currentDocument && !currentDocument.isBinary ? (
            <CodeEditor2
              value={currentDocument.value}
              onChange={handleEditorChange}
              language={currentDocument.language || 'plaintext'}
            // readOnly={isStreaming || currentDocument.isLocked}
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
