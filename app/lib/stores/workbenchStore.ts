// app/lib/stores/workbenchStore.ts
import { path } from '@/app/utils/path';
import { toast } from '@/hooks/use-toast';
import { WORK_DIR } from '@/lib/prompt';
import type { WebContainer } from '@webcontainer/api';
import { computed, map } from 'nanostores';

// --- Types ---
export interface ScrollPosition {
    top?: number;
    left?: number;
    line?: number;
    column?: number;
}

export interface EditorDocument {
    filePath: string;
    value: string;
    isBinary: boolean;
    language?: string;
    scroll?: ScrollPosition;
}

export interface PreviewInfo {
    port: number;
    ready: boolean;
    baseUrl: string;
}

export interface BaseFileEntry {
    name: string;
    path: string; // Full absolute path (e.g., /home/project/src/index.js)
    type: 'file' | 'directory';
    isLocked?: boolean;
    lockedByFolder?: string;
}

export interface WorkbenchFile extends BaseFileEntry {
    type: 'file';
    content: string;
    isBinary: boolean;
}

export interface WorkbenchFolder extends BaseFileEntry {
    type: 'directory';
    // Children are typically derived for UI, not stored directly here to avoid deep nesting issues.
    // If you need to store children, ensure it's a flat structure of paths.
}

export type WorkbenchDirent = WorkbenchFile | WorkbenchFolder;
export type WorkbenchFileMap = Record<string, WorkbenchDirent | undefined>;

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';
export interface ActionState {
    id: string;
    type: string;
    content: string;
    status: ActionStatus;
    error?: string;
    filePath?: string;
    operation?: string;
}

export interface ArtifactState {
    id: string;
    messageId: string;
    title: string;
    type?: string;
    closed: boolean;
    actions: Record<string, ActionState>;
}

export type WorkbenchViewType = 'Editor' | 'Preview' | 'Diff';

interface WorkbenchState {
    showWorkbench: boolean;
    currentView: WorkbenchViewType;
    files: WorkbenchFileMap;
    selectedFile: string | null;
    currentDocument: EditorDocument | null;
    unsavedFiles: Set<string>;
    previews: PreviewInfo[];
    activePreviewUrl: string | null;
    activePreviewPort: number | null;
    showTerminal: boolean;
    artifacts: Record<string, ArtifactState>;
    isProcessingArtifact: boolean;
    isLoadingFiles: boolean;
    fileLoadError: string | null;
    fileHistory: Record<string, { originalContent: string; versions: Array<{ timestamp: number; content: string }> }>;
    pendingAIChange: { filePath: string; newContent: string } | null;
    streamingContent: { filePath: string; content: string } | null;
}

const initialWorkbenchState: WorkbenchState = {
    showWorkbench: false,
    currentView: 'Editor',
    files: {},
    selectedFile: null,
    currentDocument: null,
    unsavedFiles: new Set(),
    previews: [],
    activePreviewUrl: null,
    activePreviewPort: null,
    showTerminal: true,
    artifacts: {},
    isProcessingArtifact: false,
    isLoadingFiles: false,
    fileLoadError: null,
    fileHistory: {},
    pendingAIChange: null,
    streamingContent: null,
};

export const $workbench = map<WorkbenchState>(initialWorkbenchState);

// --- Selectors (derived state) ---
export const $firstArtifact = computed($workbench, (wb) => {
    const firstArtifactKey = Object.keys(wb.artifacts)[0];
    return firstArtifactKey ? wb.artifacts[firstArtifactKey] : undefined;
});
export const $hasPreview = computed($workbench, (wb) => wb.previews.length > 0);

// --- Actions ---
export const toggleWorkbench = (show?: boolean) => {
    const currentShowState = $workbench.get().showWorkbench;
    $workbench.setKey('showWorkbench', show === undefined ? !currentShowState : show);
};

export const setWorkbenchView = (view: WorkbenchViewType) => {
    const currentView = $workbench.get().currentView;
    $workbench.setKey('currentView', view);

    if (view === 'Preview' && currentView !== 'Preview') {
        setTimeout(() => {
            const currentPreviews = $workbench.get().previews;
            const hasNoActiveServer = !currentPreviews.some(p => p.ready);

            if (hasNoActiveServer && typeof window !== 'undefined') {
                const event = new CustomEvent('requestDevServer', {
                    detail: { reason: 'preview_tab_switch' }
                });
                window.dispatchEvent(event);
            }
        }, 100);
    }
};

export const getFileLanguage = (filename: string | null): string => {
    if (!filename) return 'plaintext';
    const extension = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
        js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
        html: 'html', css: 'css', json: 'json', md: 'markdown', py: 'python',
        vue: 'vue', astro: 'astro', svelte: 'svelte',
        // Add more mappings from your getLanguage function in CodeEditor2
    };
    return langMap[extension || ''] || 'plaintext';
};

const normalizeFilePath = (filePath: string): string => {
    let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

    if (normalizedPath.startsWith('home/project/')) {
        return '/' + normalizedPath;
    } else if (normalizedPath.startsWith('project/')) {
        return '/home/' + normalizedPath;
    } else {
        if (!filePath.startsWith('/')) filePath = '/' + filePath;
        return WORK_DIR + filePath;
    }
};

export const setSelectedFile = (filePath: string | null) => {
    const currentSelected = $workbench.get().selectedFile;
    if (currentSelected === filePath && filePath !== null) {
        if (filePath) {
            const fileData = $workbench.get().files[filePath];
            const currentDoc = $workbench.get().currentDocument;
            if (fileData && fileData.type === 'file' && currentDoc && currentDoc.value !== (fileData as WorkbenchFile).content) {
                $workbench.setKey('currentDocument', {
                    filePath: filePath,
                    value: (fileData as WorkbenchFile).content,
                    isBinary: (fileData as WorkbenchFile).isBinary,
                    language: getFileLanguage(filePath),
                    scroll: currentDoc.filePath === filePath ? currentDoc.scroll : { top: 0, left: 0, line: 0, column: 0 }
                });
            }
        }
        return;
    }

    $workbench.setKey('selectedFile', filePath);
    if (filePath) {
        const fileData = $workbench.get().files[filePath];
        if (fileData && fileData.type === 'file') {
            const content = (fileData as WorkbenchFile).content;
            $workbench.setKey('currentDocument', {
                filePath: filePath,
                value: content,
                isBinary: (fileData as WorkbenchFile).isBinary,
                language: getFileLanguage(filePath),
                scroll: { top: 0, left: 0, line: 0, column: 0 }
            });
        } else if (fileData && fileData.type === 'directory') {
            $workbench.setKey('currentDocument', null);
        } else {
            $workbench.setKey('currentDocument', null);
        }
    } else {
        $workbench.setKey('currentDocument', null);
    }
};

export const setWorkbenchFiles = (newFiles: WorkbenchFileMap, source: string = "unknown") => {
    const currentStore = $workbench.get();
    let filesChanged = false;

    if (Object.keys(currentStore.files).length !== Object.keys(newFiles).length) {
        filesChanged = true;
    } else {
        for (const path in newFiles) {
            if (!currentStore.files[path] ||
                (newFiles[path]?.type === 'file' && (currentStore.files[path] as WorkbenchFile)?.content !== (newFiles[path] as WorkbenchFile)?.content) ||
                newFiles[path]?.type !== currentStore.files[path]?.type) {
                filesChanged = true;
                break;
            }
        }
    }

    if (!filesChanged) {
        return;
    }

    $workbench.setKey('files', newFiles);

    const currentSelected = currentStore.selectedFile;
    if ((!currentSelected && Object.keys(newFiles).length > 0) || (currentSelected && !newFiles[currentSelected])) {
        const firstFilePath = Object.keys(newFiles).find(
            (path) => newFiles[path]?.type === 'file'
        );
        if (firstFilePath) {
            setTimeout(() => setSelectedFile(firstFilePath), 0);
        } else if (currentSelected && !newFiles[currentSelected]) {
            setTimeout(() => setSelectedFile(null), 0);
        }
    } else if (currentSelected && newFiles[currentSelected] && newFiles[currentSelected]?.type === 'file') {
        const fileData = newFiles[currentSelected] as WorkbenchFile;
        const currentDoc = currentStore.currentDocument;
        if (!currentDoc || currentDoc.filePath !== currentSelected || currentDoc.value !== fileData.content || currentDoc.isBinary !== fileData.isBinary) {
            setTimeout(() => {
                $workbench.setKey('currentDocument', {
                    filePath: currentSelected,
                    value: fileData.content,
                    isBinary: fileData.isBinary,
                    language: getFileLanguage(currentSelected),
                    scroll: currentDoc?.filePath === currentSelected ? currentDoc.scroll : { top: 0, left: 0, line: 0, column: 0 }
                });
            }, 0);
        }
    }
};

export const handleEditorContentChange = (newContent: string) => {
    const currentStore = $workbench.get();
    const doc = currentStore.currentDocument;
    if (doc) {
        $workbench.setKey('currentDocument', { ...doc, value: newContent });

        const currentFiles = currentStore.files;
        const originalFile = currentFiles[doc.filePath] as WorkbenchFile | undefined;

        if (originalFile) {
            const unsaved = new Set(currentStore.unsavedFiles);

            if (originalFile.content !== newContent) {
                unsaved.add(doc.filePath);
            } else {
                unsaved.delete(doc.filePath);
            }

            $workbench.setKey('unsavedFiles', unsaved);
        }
    }
};

export const saveCurrentFile = async (wc: WebContainer | null) => {
    const currentStore = $workbench.get();
    const doc = currentStore.currentDocument;
    if (doc && wc) {
        try {
            const fullPath = doc.filePath;
            let relativePath = fullPath;
            if (fullPath.startsWith(WORK_DIR + '/')) {
                relativePath = fullPath.substring(WORK_DIR.length + 1);
            } else if (fullPath.startsWith('/')) {
                relativePath = fullPath.substring(1);
            }

            const dirParts = relativePath.split('/');
            if (dirParts.length > 1) {
                let currentDirPath = '';
                for (let i = 0; i < dirParts.length - 1; i++) {
                    currentDirPath = currentDirPath ? `${currentDirPath}/${dirParts[i]}` : dirParts[i];
                    try {
                        await wc.fs.readdir(currentDirPath);
                    } catch (e: any) {
                        if (e.message.includes('ENOENT')) {
                            await wc.fs.mkdir(currentDirPath, { recursive: true });
                        } else { throw e; }
                    }
                }
            }
            await wc.fs.writeFile(relativePath, doc.value);

            const fileEntry = currentStore.files[fullPath] as WorkbenchFile | undefined;
            if (fileEntry) {
                const updatedFiles = {
                    ...currentStore.files,
                    [fullPath]: { ...fileEntry, content: doc.value },
                };
                const history = currentStore.fileHistory;
                const currentFileHistory = history[fullPath] || { originalContent: fileEntry.content, versions: [] };
                const updatedFileHistory = {
                    ...history,
                    [fullPath]: {
                        originalContent: currentFileHistory.originalContent,
                        versions: [...currentFileHistory.versions, { timestamp: Date.now(), content: doc.value }]
                    }
                };
                $workbench.set({
                    ...currentStore,
                    files: updatedFiles,
                    fileHistory: updatedFileHistory,
                    unsavedFiles: new Set([...currentStore.unsavedFiles].filter(p => p !== fullPath)),
                });
            }
            return true;
        } catch (error) {
            console.error(`Error saving file ${doc.filePath} to WebContainer:`, error);
            toast({ title: "Save Error", description: `Failed to save ${doc.filePath}. Error: ${error instanceof Error ? error.message : String(error)}`, variant: "destructive" });
            return false;
        }
    }
    return false;
};

export const resetCurrentFile = () => {
    const currentStore = $workbench.get();
    const doc = currentStore.currentDocument;
    if (doc && currentStore.files) {
        const fileHistory = currentStore.fileHistory[doc.filePath];

        if (fileHistory && fileHistory.originalContent) {
            const unsaved = new Set(currentStore.unsavedFiles);
            unsaved.delete(doc.filePath);

            $workbench.set({
                ...currentStore,
                currentDocument: { ...doc, value: fileHistory.originalContent },
                unsavedFiles: unsaved,
            });

            return;
        }

        const originalFile = currentStore.files[doc.filePath] as WorkbenchFile | undefined;
        if (originalFile) {
            const unsaved = new Set(currentStore.unsavedFiles);
            unsaved.delete(doc.filePath);
            $workbench.set({
                ...currentStore,
                currentDocument: { ...doc, value: originalFile.content },
                unsavedFiles: unsaved,
            });
        }
    }
};

export const setCurrentDocumentScroll = (scroll: ScrollPosition) => {
    const currentStore = $workbench.get();
    const doc = currentStore.currentDocument;
    if (doc) {
        $workbench.setKey('currentDocument', { ...doc, scroll });
    }
};

export const addPreview = (port: number, url: string) => {
    const currentStore = $workbench.get();
    const existingPreviewIndex = currentStore.previews.findIndex(p => p.port === port);
    let updatedPreviews;

    if (existingPreviewIndex > -1) {
        updatedPreviews = [...currentStore.previews];
        updatedPreviews[existingPreviewIndex] = { port, baseUrl: url, ready: true };
    } else {
        updatedPreviews = [...currentStore.previews, { port, baseUrl: url, ready: true }];
    }
    $workbench.setKey('previews', updatedPreviews);

    if (updatedPreviews.length === 1 || !currentStore.activePreviewUrl || [3000, 5173, 8080].includes(port)) {
        setActivePreview(port, url);
    }
};

export const removePreview = (port: number) => {
    const currentStore = $workbench.get();
    const updatedPreviews = currentStore.previews.filter(p => p.port !== port);
    $workbench.setKey('previews', updatedPreviews);

    if (currentStore.activePreviewPort === port) {
        if (updatedPreviews.length > 0) {
            setActivePreview(updatedPreviews[0].port, updatedPreviews[0].baseUrl);
        } else {
            setActivePreview(null, null);
        }
    }
};

export const setActivePreview = (port: number | null, url: string | null) => {
    $workbench.setKey('activePreviewUrl', url);
    $workbench.setKey('activePreviewPort', port);
};

export const toggleTerminal = (show?: boolean) => {
    const currentShowState = $workbench.get().showTerminal;
    $workbench.setKey('showTerminal', show === undefined ? !currentShowState : show);
};

export const addArtifact = (artifactData: Omit<ArtifactState, 'actions' | 'closed'>) => {
    const currentArtifacts = $workbench.get().artifacts;
    if (!currentArtifacts[artifactData.messageId]) {
        $workbench.setKey('artifacts', {
            ...currentArtifacts,
            [artifactData.messageId]: {
                ...artifactData,
                actions: {},
                closed: false,
            },
        });
    }
};

export const updateArtifact = (messageId: string, updates: Partial<Pick<ArtifactState, 'title' | 'closed' | 'type'>>) => {
    const currentArtifacts = $workbench.get().artifacts;
    const artifact = currentArtifacts[messageId];
    if (artifact) {
        $workbench.setKey('artifacts', {
            ...currentArtifacts,
            [messageId]: { ...artifact, ...updates },
        });
    }
};

export const addActionToArtifact = (messageId: string, actionId: string, action: Omit<ActionState, 'status' | 'error'>) => {
    const currentArtifacts = $workbench.get().artifacts;
    const artifact = currentArtifacts[messageId];
    if (artifact && !artifact.actions[actionId]) {
        const newAction: ActionState = { ...action, id: actionId, status: 'pending' };
        $workbench.setKey('artifacts', {
            ...currentArtifacts,
            [messageId]: {
                ...artifact,
                actions: { ...artifact.actions, [actionId]: newAction },
            },
        });
    }
};

export const updateActionState = (messageId: string, actionId: string, updates: Partial<ActionState>) => {
    const currentArtifacts = $workbench.get().artifacts;
    const artifact = currentArtifacts[messageId];
    if (artifact && artifact.actions[actionId]) {
        $workbench.setKey('artifacts', {
            ...currentArtifacts,
            [messageId]: {
                ...artifact,
                actions: {
                    ...artifact.actions,
                    [actionId]: { ...artifact.actions[actionId], ...updates },
                },
            },
        });
    }
};

export const setProcessingArtifact = (isProcessing: boolean) => {
    $workbench.setKey('isProcessingArtifact', isProcessing);
};

// --- File Update / Creation from AI Actions ---
export const updateFileInWorkbench = async (filePath: string, content: string, wc?: WebContainer | null) => {
    const normalizedFilePath = normalizeFilePath(filePath);

    const currentStore = $workbench.get();
    const currentFiles = currentStore.files;

    const fileEntry = currentFiles[normalizedFilePath];
    const updatedFileEntry: WorkbenchFile = {
        path: normalizedFilePath,
        name: path.basename(normalizedFilePath),
        type: 'file',
        content: content,
        isBinary: false,
        isLocked: fileEntry?.isLocked,
        lockedByFolder: (fileEntry as WorkbenchFile)?.lockedByFolder,
    };

    const newFilesMap = { ...currentFiles, [normalizedFilePath]: updatedFileEntry };
    $workbench.setKey('files', newFilesMap);

    if (currentStore.selectedFile === normalizedFilePath) {
        $workbench.setKey('currentDocument', {
            filePath: normalizedFilePath,
            value: content,
            isBinary: false,
            language: getFileLanguage(normalizedFilePath),
            scroll: currentStore.currentDocument?.scroll || { top: 0, left: 0, line: 0, column: 0 }
        });
    }

    if (wc) {
        try {
            let relativePath = normalizedFilePath;
            if (normalizedFilePath.startsWith(WORK_DIR + '/')) {
                relativePath = normalizedFilePath.substring(WORK_DIR.length + 1);
            } else if (normalizedFilePath.startsWith('/')) {
                relativePath = normalizedFilePath.substring(1);
            }

            const dirPath = path.dirname(relativePath);
            if (dirPath && dirPath !== '.') {
                try {
                    await wc.fs.readdir(dirPath);
                } catch (err) {
                    await wc.fs.mkdir(dirPath, { recursive: true });
                }
            }

            await wc.fs.writeFile(relativePath, content);

            try {
                const writtenContent = await wc.fs.readFile(relativePath, 'utf-8');
                if (writtenContent !== content) {
                    console.warn(`File content mismatch for ${relativePath}. Expected ${content.length} chars, got ${writtenContent.length} chars`);
                }
            } catch (verifyError) {
                console.warn(`Could not verify file write for ${relativePath}:`, verifyError);
            }

            toast({ title: "File Created", description: `${path.basename(normalizedFilePath)} saved to virtual environment.` });
        } catch (error) {
            console.error(`Error writing file ${normalizedFilePath} to WebContainer:`, error);
            toast({ title: "Sync Error", description: `Failed to save ${path.basename(normalizedFilePath)} to virtual environment. ${error}`, variant: "destructive" });
        }
    }

    const history = currentStore.fileHistory;
    const originalContent = (currentFiles[normalizedFilePath] as WorkbenchFile)?.content || "";
    const currentFileHistory = history[normalizedFilePath] || { originalContent, versions: [] };
    $workbench.setKey('fileHistory', {
        ...history,
        [normalizedFilePath]: {
            originalContent: currentFileHistory.versions.length === 0 ? originalContent : currentFileHistory.originalContent,
            versions: [...currentFileHistory.versions, { timestamp: Date.now(), content }]
        }
    });
};

export const addDirectoryToWorkbench = async (dirPath: string, wc?: WebContainer | null) => {
    const normalizedDirPath = normalizeFilePath(dirPath);

    const currentStore = $workbench.get();
    const currentFiles = currentStore.files;

    if (!currentFiles[normalizedDirPath]) {
        const newDirEntry: WorkbenchFolder = {
            path: normalizedDirPath,
            name: path.basename(normalizedDirPath),
            type: 'directory',
            isLocked: false,
        };
        $workbench.setKey('files', { ...currentFiles, [normalizedDirPath]: newDirEntry });

        if (wc) {
            try {
                let relativePath = normalizedDirPath;
                if (normalizedDirPath.startsWith(WORK_DIR + '/')) {
                    relativePath = normalizedDirPath.substring(WORK_DIR.length + 1);
                } else if (normalizedDirPath.startsWith('/')) {
                    relativePath = normalizedDirPath.substring(1);
                }
                await wc.fs.mkdir(relativePath, { recursive: true });
            } catch (error) {
                console.error(`Error creating directory ${normalizedDirPath} in WebContainer:`, error);
            }
        }
    }
};

export const setPendingAIChange = (filePath: string, newContent: string) => {
    const currentStore = $workbench.get();
    const normalizedFilePath = filePath.startsWith(WORK_DIR) ? filePath : path.join(WORK_DIR, filePath.replace(/^\//, ''));

    $workbench.setKey('pendingAIChange', { filePath: normalizedFilePath, newContent });
    setWorkbenchView('Diff');
    if (!currentStore.showWorkbench) {
        toggleWorkbench(true);
    }
    toast({ title: "AI Suggestion Ready", description: `Review changes for ${path.basename(normalizedFilePath)} in the Diff panel.` });
};

export const acceptPendingAIChange = async (wc?: WebContainer | null) => {
    const pendingChange = $workbench.get().pendingAIChange;
    if (pendingChange) {
        const normalizedPath = pendingChange.filePath.startsWith(WORK_DIR)
            ? pendingChange.filePath
            : path.join(WORK_DIR, pendingChange.filePath.replace(/^\//, ''));

        await updateFileInWorkbench(normalizedPath, pendingChange.newContent, wc);
        setSelectedFile(normalizedPath);
        setWorkbenchView('Editor');
        toast({ title: "AI Changes Applied", description: `Changes to ${path.basename(normalizedPath)} have been applied.` });
    }
};

export const setStreamingContent = (filePath: string | null, content: string = '') => {
    $workbench.setKey('streamingContent', filePath ? { filePath, content } : null);

    if (filePath && $workbench.get().selectedFile !== filePath) {
        setSelectedFile(filePath);
        setWorkbenchView('Editor');
    }
};

export const updateStreamingContent = (filePath: string, content: string) => {
    const current = $workbench.get().streamingContent;
    if (current && current.filePath === filePath) {
        $workbench.setKey('streamingContent', { filePath, content });
    } else {
        setStreamingContent(filePath, content);
    }
};

export const clearStreamingContent = () => {
    $workbench.setKey('streamingContent', null);
};

if (typeof window !== 'undefined') {
    (window as any).debugRefreshPackageJson = async () => {
        try {
            const { webContainerManager } = await import('@/lib/WebContainerManager');
            const webContainerInstance = await webContainerManager.getWebContainer();

            if (!webContainerInstance) {
                console.error('WebContainer not available');
                return false;
            }

            const packageJsonContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');
            await updateFileInWorkbench('/home/project/package.json', packageJsonContent, webContainerInstance);

            return true;
        } catch (error) {
            console.error('Failed to refresh package.json:', error);
            return false;
        }
    };
}
