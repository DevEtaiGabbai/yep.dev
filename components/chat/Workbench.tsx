// components/chat/Workbench.tsx
'use client';

import {
    $workbench,
    saveCurrentFile,
    setSelectedFile,
    setWorkbenchView,
    toggleTerminal,
    toggleWorkbench,
    type WorkbenchViewType
} from '@/app/lib/stores/workbenchStore';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { toast } from '@/hooks/use-toast';
import { useWebContainer } from '@/hooks/useWebContainer';
import { getAllFilesFromWebContainer } from '@/lib/services/webContainerSync';
import { useStore } from '@nanostores/react';
import { Download } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { EditorPanel } from '../EditorPanel';
import { PreviewPanel } from '../PreviewPanel';
import type { TerminalRef } from '../Terminal';
import TerminalTabs from '../TerminalTabs';
import { Button } from '../ui/button';
import { CodePreviewTab, CodePreviewTabList, CodePreviewTabTrigger } from '../ui/code-preview-tab';
import { Icons } from '../ui/icons';

interface WorkbenchProps {
    mainTerminalRef: RefObject<TerminalRef | null>;
    isProcessingFiles?: boolean;
    streamingComplete?: boolean;
    activeFileFromAI?: string | null;
    projectId: string | null;
}

const sliderOptions: Array<{ value: WorkbenchViewType; label: string }> = [
    { value: 'Editor', label: 'Code' },
    { value: 'Preview', label: 'Preview' },
];

export function Workbench({
    mainTerminalRef,
    isProcessingFiles = false,
    streamingComplete = true,
    activeFileFromAI = null,
    projectId,
}: WorkbenchProps) {
    const { data: session } = useSession();

    const workbenchState = useStore($workbench);
    const {
        showWorkbench,
        currentView,
        selectedFile,
        currentDocument,
        unsavedFiles,
        files,
        previews,
        showTerminal: terminalVisible,
    } = workbenchState;

    const { webContainerInstance } = useWebContainer(mainTerminalRef);
    const [isDownloading, setIsDownloading] = useState(false);

    const isCurrentFileUnsaved = currentDocument ? unsavedFiles.has(currentDocument.filePath) : false;

    useEffect(() => {
        if (!showWorkbench) {
            toggleWorkbench(true);
        }
    }, [showWorkbench]);

    useEffect(() => {
        if (activeFileFromAI) {
            if (currentView !== 'Editor') {
                setWorkbenchView('Editor');
            }

            if (selectedFile !== activeFileFromAI) {
                setSelectedFile(activeFileFromAI);
            }
        }
    }, [isProcessingFiles, streamingComplete, activeFileFromAI, selectedFile, currentView, files]);

    // Auto-sync files when they change or when streaming completes
    useEffect(() => {
        const syncFiles = async () => {
            if (!webContainerInstance || !projectId || !session?.user?.id) return;
            if (isProcessingFiles && !streamingComplete) return; // Don't sync while streaming

            try {
                const files = await getAllFilesFromWebContainer(webContainerInstance);
                if (files.length === 0) return;

                await fetch(`/api/projects/${projectId}/sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ files }),
                });

                console.log(`Synced ${files.length} files to project ${projectId}`);
            } catch (error) {
                console.error('Error syncing files:', error);
            }
        };

        // Sync files when streaming completes or when files change significantly
        if (streamingComplete && Object.keys(files).length > 0) {
            const timeoutId = setTimeout(syncFiles, 2000); // Debounce
            return () => clearTimeout(timeoutId);
        }
    }, [webContainerInstance, projectId, session?.user?.id, streamingComplete, files, isProcessingFiles]);

    const handleSave = useCallback(async () => {
        if (currentDocument) {
            const success = await saveCurrentFile(webContainerInstance);
            if (success) {
                toast({ title: "File Saved", description: `${currentDocument.filePath.split('/').pop()} saved.` });

                // Trigger sync after save
                if (webContainerInstance && projectId && session?.user?.id) {
                    try {
                        const files = await getAllFilesFromWebContainer(webContainerInstance);
                        await fetch(`/api/projects/${projectId}/sync`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ files }),
                        });
                    } catch (error) {
                        console.error('Error syncing after save:', error);
                    }
                }
            }
        }
    }, [webContainerInstance, currentDocument, projectId, session?.user?.id]);

    useEffect(() => {
        if (previews.length > 0 && !$workbench.get().activePreviewUrl) {
            const mainPreview = previews.find(p => [3000, 5173, 8080].includes(p.port)) || previews[0];
            if (mainPreview) {
                $workbench.setKey('activePreviewUrl', mainPreview.baseUrl);
                $workbench.setKey('activePreviewPort', mainPreview.port);
            }
        }
    }, [previews]);

    const handleDownloadProject = useCallback(async () => {
        if (!projectId || !session?.user?.id) {
            toast({
                title: "Download Error",
                description: "No project available to download.",
                variant: "destructive"
            });
            return;
        }

        setIsDownloading(true);
        try {
            // First sync current files
            if (webContainerInstance) {
                const files = await getAllFilesFromWebContainer(webContainerInstance);
                if (files.length > 0) {
                    await fetch(`/api/projects/${projectId}/sync`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ files }),
                    });
                }
            }

            // Download the project
            const response = await fetch(`/api/projects/${projectId}/download`);

            if (!response.ok) {
                throw new Error(`Download failed: ${response.statusText}`);
            }

            // Get the filename from the response headers
            const contentDisposition = response.headers.get('content-disposition');
            const filename = contentDisposition
                ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
                : `project_${new Date().toISOString().split('T')[0]}.zip`;

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast({
                title: "Project Downloaded",
                description: `${filename} downloaded successfully.`
            });
        } catch (error) {
            console.error('Error downloading project:', error);
            toast({
                title: "Download Error",
                description: `Failed to download project: ${error instanceof Error ? error.message : 'Unknown error'}`,
                variant: "destructive"
            });
        } finally {
            setIsDownloading(false);
        }
    }, [projectId, session?.user?.id, webContainerInstance]);

    return (
        <div className="flex flex-col h-full bg-[#101012] border-l border-[#313133] shadow-lg text-sm text-[#c0c0c0]">
            <div className="flex items-center pr-2 border-b border-[#313133] flex-shrink-0 bg-[#161618]">
                <CodePreviewTab value={currentView} onValueChange={(val) => setWorkbenchView(val as WorkbenchViewType)}>
                    <CodePreviewTabList className="h-8">
                        {sliderOptions.map(option => (
                            <CodePreviewTabTrigger
                                key={option.value}
                                value={option.value}
                                className="px-3 py-1 text-xs h-full data-[state=active]:bg-[#2a2a2c] data-[state=active]:text-white text-[#969798]"
                            >
                                {option.label}
                            </CodePreviewTabTrigger>
                        ))}
                    </CodePreviewTabList>
                </CodePreviewTab>

                <div className="flex items-center space-x-1.5 ml-2">
                    {currentView === 'Editor' && currentDocument?.filePath && isCurrentFileUnsaved && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleSave}
                            className="text-xs h-7 px-2 text-[#c0c0c0] hover:text-white hover:bg-[#2a2a2c]"
                        >
                            <Icons.save className="h-3.5 w-3.5 mr-1" /> Save
                        </Button>
                    )}

                </div>

                <div className="ml-auto flex items-center space-x-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleDownloadProject}
                        disabled={isDownloading || !projectId}
                        className="h-7 w-7 text-[#c0c0c0] hover:text-white hover:bg-[#2a2a2c] disabled:opacity-50"
                        title={projectId ? "Download Project" : "No project available"}
                    >
                        {isDownloading ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                            <Download className="h-4 w-4" />
                        )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => toggleTerminal()} title={terminalVisible ? "Hide Terminal" : "Show Terminal"} className="h-7 w-7 text-[#c0c0c0] hover:text-white hover:bg-[#2a2a2c]">
                        <Icons.eyes />
                    </Button>
                </div>
            </div>

            <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
                <ResizablePanel defaultSize={terminalVisible ? 70 : 100} minSize={20}>
                    <div className="h-full overflow-hidden">
                        {currentView === 'Editor' && (
                            <EditorPanel />
                        )}
                        {currentView === 'Preview' && <PreviewPanel />}
                    </div>
                </ResizablePanel>
                {terminalVisible && (
                    <>
                        <ResizableHandle className="h-[1px] bg-[#313133]" />
                        <ResizablePanel defaultSize={30} minSize={15}>
                            <TerminalTabs terminalRef={mainTerminalRef} />
                        </ResizablePanel>
                    </>
                )}
            </ResizablePanelGroup>
        </div>
    );
}
