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
    isProcessingArtifact: boolean; // True if AI is generating content that will modify workbench
    isLoadingFiles: boolean; // True when initially loading files from GitHub/template
    fileLoadError: string | null;
    fileHistory: Record<string, { originalContent: string; versions: Array<{ timestamp: number; content: string }> }>;
    pendingAIChange: { filePath: string; newContent: string } | null; // New state
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
    $workbench.setKey('currentView', view);
};

const getFileLanguage = (filename: string | null): string => {
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

export const setSelectedFile = (filePath: string | null) => {
    const currentSelected = $workbench.get().selectedFile;
    if (currentSelected === filePath && filePath !== null) { // Allow re-selection if filePath is null (deselect)
        // If trying to select the same file, but its content might have updated in the main 'files' store
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
            $workbench.setKey('currentDocument', {
                filePath: filePath,
                value: (fileData as WorkbenchFile).content,
                isBinary: (fileData as WorkbenchFile).isBinary,
                language: getFileLanguage(filePath),
                scroll: { top: 0, left: 0, line: 0, column: 0 } // Reset scroll for new file
            });
        } else if (fileData && fileData.type === 'directory') {
            // If a directory is selected, clear the current document
            $workbench.setKey('currentDocument', null);
        } else {
            $workbench.setKey('currentDocument', null);
            console.warn(`File or directory not found in store: ${filePath}`);
        }
    } else {
        $workbench.setKey('currentDocument', null);
    }
};

export const setWorkbenchFiles = (newFiles: WorkbenchFileMap, source: string = "unknown") => {
    const currentStore = $workbench.get();
    let filesChanged = false;

    // Deep check if files actually changed
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


    // Logic to auto-select a file if none is selected (or if current is deleted)
    const currentSelected = currentStore.selectedFile;
    if ((!currentSelected && Object.keys(newFiles).length > 0) || (currentSelected && !newFiles[currentSelected])) {
        const firstFilePath = Object.keys(newFiles).find(
            (path) => newFiles[path]?.type === 'file'
        );
        if (firstFilePath) {
            // Deferring setSelectedFile to allow current transaction to complete
            setTimeout(() => setSelectedFile(firstFilePath), 0);
        } else if (currentSelected && !newFiles[currentSelected]) {
            // If current selected file was deleted and no other file is available
            setTimeout(() => setSelectedFile(null), 0);
        }
    } else if (currentSelected && newFiles[currentSelected] && newFiles[currentSelected]?.type === 'file') {
        // If current file still exists, ensure its document is up-to-date
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
        // Always update the document with new content
        $workbench.setKey('currentDocument', { ...doc, value: newContent });

        // Check if this content is different from the saved version
        const currentFiles = currentStore.files;
        const originalFile = currentFiles[doc.filePath] as WorkbenchFile | undefined;

        if (originalFile) {
            // If there's an original file, check if content has changed
            const unsaved = new Set(currentStore.unsavedFiles);

            if (originalFile.content !== newContent) {
                // Mark as unsaved if content differs
                unsaved.add(doc.filePath);
            } else {
                // Remove from unsaved if content matches
                unsaved.delete(doc.filePath);
            }

            $workbench.setKey('unsavedFiles', unsaved);
        } else {
            console.warn(`No original file found for ${doc.filePath}`);
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
                        await wc.fs.readdir(currentDirPath); // Check if dir exists
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
            // Reset to the original content from history
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

    // If it's the first preview or matches common dev server ports, set as active
    if (updatedPreviews.length === 1 || !currentStore.activePreviewUrl || [3000, 5173, 8080].includes(port)) {
        // Call the renamed action here
        setActivePreview(port, url);
    }
};

export const removePreview = (port: number) => {
    const currentStore = $workbench.get();
    const updatedPreviews = currentStore.previews.filter(p => p.port !== port);
    $workbench.setKey('previews', updatedPreviews);

    if (currentStore.activePreviewPort === port) {
        if (updatedPreviews.length > 0) {
            // Call the renamed action here
            setActivePreview(updatedPreviews[0].port, updatedPreviews[0].baseUrl);
        } else {
            // Call the renamed action here to clear
            setActivePreview(null, null);
        }
    }
};

// Renamed from setActivePreviewUrl for clarity and to handle both port and URL
export const setActivePreview = (port: number | null, url: string | null) => {
    $workbench.setKey('activePreviewUrl', url);
    $workbench.setKey('activePreviewPort', port);
    // Optionally, auto-switch to Preview tab if a valid preview is set
    // if (url && port && $workbench.get().currentView !== 'Preview') {
    //     setWorkbenchView('Preview');
    // }
};


export const toggleTerminal = (show?: boolean) => {
    const currentShowState = $workbench.get().showTerminal;
    $workbench.setKey('showTerminal', show === undefined ? !currentShowState : show);
};

export const addArtifact = (artifactData: Omit<ArtifactState, 'actions' | 'closed'>) => { // Added closed to Omit
    const currentArtifacts = $workbench.get().artifacts;
    if (!currentArtifacts[artifactData.messageId]) {
        $workbench.setKey('artifacts', {
            ...currentArtifacts,
            [artifactData.messageId]: {
                ...artifactData,
                actions: {},
                closed: false, // Ensure closed is initialized
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

    // Normalize the file path to prevent duplication of WORK_DIR
    let normalizedFilePath = filePath;
    
    // Remove leading slash if present for normalization
    let pathForNormalization = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    
    // Check if the path already contains the work directory structure
    if (pathForNormalization.startsWith('home/project/')) {
        // Path already has full work dir, just add leading slash
        normalizedFilePath = '/' + pathForNormalization;
    } else if (pathForNormalization.startsWith('project/')) {
        // Path has partial work dir, prepend /home/
        normalizedFilePath = '/home/' + pathForNormalization;
    } else {
        // Path is relative, prepend full WORK_DIR
        normalizedFilePath = path.join(WORK_DIR, pathForNormalization);
    }
    

    const currentStore = $workbench.get();
    const currentFiles = currentStore.files;

    // Create the file entry for the store regardless of whether it exists already
    const fileEntry = currentFiles[normalizedFilePath];
    const updatedFileEntry: WorkbenchFile = {
        path: normalizedFilePath,
        name: path.basename(normalizedFilePath),
        type: 'file',
        content: content, // The new content
        isBinary: false, // Assume text from AI for now
        isLocked: fileEntry?.isLocked,
        lockedByFolder: (fileEntry as WorkbenchFile)?.lockedByFolder, // Ensure type cast if needed
    };

    // First update the store so UI shows the file immediately
    const newFilesMap = { ...currentFiles, [normalizedFilePath]: updatedFileEntry };
    $workbench.setKey('files', newFilesMap);

    // If this file is currently selected, update the current document
    if (currentStore.selectedFile === normalizedFilePath) {
        $workbench.setKey('currentDocument', {
            filePath: normalizedFilePath,
            value: content,
            isBinary: false,
            language: getFileLanguage(normalizedFilePath),
            scroll: currentStore.currentDocument?.scroll || { top: 0, left: 0, line: 0, column: 0 }
        });
    }

    // Now write to WebContainer if available
    if (wc) {
        try {
            // Get relative path for WebContainer
            let relativePath = normalizedFilePath;
            if (normalizedFilePath.startsWith(WORK_DIR + '/')) {
                relativePath = normalizedFilePath.substring(WORK_DIR.length + 1);
            } else if (normalizedFilePath.startsWith('/')) {
                relativePath = normalizedFilePath.substring(1);
            }

            // Ensure parent directories exist before writing file
            const dirPath = path.dirname(relativePath);
            if (dirPath && dirPath !== '.') {
                try {
                    // Check if directory exists first
                    try {
                        await wc.fs.readdir(dirPath);
                    } catch (err) {
                        // Directory doesn't exist, create it
                        await wc.fs.mkdir(dirPath, { recursive: true });
                    }
                } catch (dirError) {
                    console.warn(`Error ensuring parent directory exists: ${dirError}`);
                    // Continue and try to write file anyway
                }
            }

            await wc.fs.writeFile(relativePath, content);
            
            // Verify the file was written correctly
            try {
                const writtenContent = await wc.fs.readFile(relativePath, 'utf-8');
                if (writtenContent === content) {
                } else {
                    console.warn(`⚠️ WORKBENCH_STORE: File content mismatch for ${relativePath}. Expected ${content.length} chars, got ${writtenContent.length} chars`);
                }
            } catch (verifyError) {
                console.warn(`⚠️ WORKBENCH_STORE: Could not verify file write for ${relativePath}:`, verifyError);
            }
            
            toast({ title: "File Created", description: `${path.basename(normalizedFilePath)} saved to virtual environment.` });
        } catch (error) {
            console.error(`WORKBENCH_STORE: Error writing file ${normalizedFilePath} to WebContainer:`, error);
            toast({ title: "Sync Error", description: `Failed to save ${path.basename(normalizedFilePath)} to virtual environment. ${error}`, variant: "destructive" });
        }
    } else {
    }

    // Update file history
    const history = currentStore.fileHistory;
    const originalContent = (currentFiles[normalizedFilePath] as WorkbenchFile)?.content || ""; // Get original before update
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

    // Normalize the directory path to prevent duplication of WORK_DIR
    let normalizedDirPath = dirPath;
    
    // Remove leading slash if present for normalization
    let pathForNormalization = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
    
    // Check if the path already contains the work directory structure
    if (pathForNormalization.startsWith('home/project/')) {
        // Path already has full work dir, just add leading slash
        normalizedDirPath = '/' + pathForNormalization;
    } else if (pathForNormalization.startsWith('project/')) {
        // Path has partial work dir, prepend /home/
        normalizedDirPath = '/home/' + pathForNormalization;
    } else {
        // Path is relative, prepend full WORK_DIR
        normalizedDirPath = path.join(WORK_DIR, pathForNormalization);
    }

    const currentStore = $workbench.get();
    const currentFiles = currentStore.files;

    if (!currentFiles[normalizedDirPath]) {
        const newDirEntry: WorkbenchFolder = {
            path: normalizedDirPath,
            name: path.basename(normalizedDirPath),
            type: 'directory',
            isLocked: false, // Default for new directories
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
                console.error(`AI Action: Error creating directory ${normalizedDirPath} in WebContainer:`, error);
            }
        }
    } else {
    }
};

// New actions for AI change review
export const setPendingAIChange = (filePath: string, newContent: string) => {
    const currentStore = $workbench.get();
    // If the file path is not absolute (doesn't start with WORK_DIR), prepend it.
    const normalizedFilePath = filePath.startsWith(WORK_DIR) ? filePath : path.join(WORK_DIR, filePath.replace(/^\//, ''));

    $workbench.setKey('pendingAIChange', { filePath: normalizedFilePath, newContent });
    setWorkbenchView('Diff'); // Automatically switch to diff view
    // Ensure the workbench is visible
    if (!currentStore.showWorkbench) {
        toggleWorkbench(true);
    }
    toast({ title: "AI Suggestion Ready", description: `Review changes for ${path.basename(normalizedFilePath)} in the Diff panel.` });
};

export const clearPendingAIChange = () => {
    const currentView = $workbench.get().currentView;
    $workbench.setKey('pendingAIChange', null);
    // If current view is Diff, switch back to Editor, otherwise stay.
    if (currentView === 'Diff') {
        setWorkbenchView('Editor');
    }
};

export const acceptPendingAIChange = async (wc?: WebContainer | null) => {
    const pendingChange = $workbench.get().pendingAIChange;
    if (pendingChange) {
        // Ensure filePath is normalized before updating
        const normalizedPath = pendingChange.filePath.startsWith(WORK_DIR)
            ? pendingChange.filePath
            : path.join(WORK_DIR, pendingChange.filePath.replace(/^\//, ''));

        await updateFileInWorkbench(normalizedPath, pendingChange.newContent, wc);
        clearPendingAIChange(); // This will also switch view if it was 'Diff'
        setSelectedFile(normalizedPath); // Ensure the updated file is selected
        // Explicitly switch to editor after accepting changes
        setWorkbenchView('Editor');
        toast({ title: "AI Changes Applied", description: `Changes to ${path.basename(normalizedPath)} have been applied.` });
    }
};


// Helper to initialize selectedFile from URL query param on client-side
if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const fileToOpen = params.get('file');
    if (fileToOpen) {
        const checkAndSet = () => {
            const currentFiles = $workbench.get().files;
            const currentSelected = $workbench.get().selectedFile;
            const fullPathToOpen = fileToOpen.startsWith(WORK_DIR) ? fileToOpen : `${WORK_DIR}/${fileToOpen.replace(/^\//, '')}`;

            if (currentFiles[fullPathToOpen] && currentSelected !== fullPathToOpen) {
                setSelectedFile(fullPathToOpen);
            } else if (!currentFiles[fullPathToOpen] && Object.keys(currentFiles).length > 0) {
                // If file doesn't exist yet, but store has files, retry after a short delay
                // This handles timing issues where files might be loading
                console.warn(`File ${fullPathToOpen} not found in store, retrying...`);
                setTimeout(checkAndSet, 500);
            }
        };
        // Initial delay to allow files to potentially load from GitHub/template
        setTimeout(checkAndSet, 500);
    }
}

// Add global debug function for testing package.json refresh
if (typeof window !== 'undefined') {
    (window as any).debugRefreshPackageJson = async () => {
        try {

            // Try to get WebContainer instance from the global manager
            const { webContainerManager } = await import('@/lib/WebContainerManager');
            const webContainerInstance = await webContainerManager.getWebContainer();

            if (!webContainerInstance) {
                console.error('❌ WebContainer not available');
                return false;
            }

            // Read package.json from WebContainer
            const packageJsonContent = await webContainerInstance.fs.readFile('package.json', 'utf-8');

            // Update workbench
            await updateFileInWorkbench('/home/project/package.json', packageJsonContent, webContainerInstance);

            return true;
        } catch (error) {
            console.error('❌ Failed to refresh package.json:', error);
            return false;
        }
    };

}
