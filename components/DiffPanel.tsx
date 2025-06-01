// components/DiffPanel.tsx
'use client';

import { $workbench, type WorkbenchFile } from '@/app/lib/stores/workbenchStore';
import { toast } from '@/hooks/use-toast';
import { getLanguageForFilename } from '@/lib/utils';
import { useStore } from '@nanostores/react';
import { ScrollArea } from '@radix-ui/react-scroll-area';
import { Copy, Download, Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from './ui/button';

interface DiffLine {
    type: 'added' | 'removed' | 'unchanged' | 'modified';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
    originalContent?: string; // For modified lines
}

export function DiffPanel() {
    const { files, selectedFile, currentDocument, pendingAIChange, fileHistory, unsavedFiles } = useStore($workbench);
    const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side');
    const [showWhitespace, setShowWhitespace] = useState(false);

    let displayOriginalContent: string = "";
    let displayModifiedContent: string = "";
    let displayFilePath: string | null = null;
    let diffSource: 'ai-change' | 'history' | 'current-selection' | 'none' = 'none';

    if (pendingAIChange) {
        displayFilePath = pendingAIChange.filePath; // Already normalized by setPendingAIChange
        const currentFileInStore = files[pendingAIChange.filePath] as WorkbenchFile | undefined;

        // If the pending change is for the currently open & unsaved doc, use its content as original
        if (currentDocument && currentDocument.filePath === pendingAIChange.filePath && unsavedFiles.has(pendingAIChange.filePath)) {
            displayOriginalContent = currentDocument.value;
        } else {
            displayOriginalContent = currentFileInStore?.content || "";
        }
        displayModifiedContent = pendingAIChange.newContent;
        diffSource = 'ai-change';
    } else if (selectedFile) {
        displayFilePath = selectedFile; // selectedFile is already normalized
        const currentFileInStore = files[selectedFile] as WorkbenchFile | undefined;
        const historyEntry = fileHistory[selectedFile];

        displayOriginalContent = historyEntry?.originalContent || currentFileInStore?.content || "";

        if (currentDocument && currentDocument.filePath === selectedFile) {
            displayModifiedContent = currentDocument.value;
        } else {
            displayModifiedContent = currentFileInStore?.content || "";
        }
        diffSource = historyEntry ? 'history' : 'current-selection';
    }

    const hasActualChanges = displayOriginalContent !== displayModifiedContent;
    const language = getLanguageForFilename(displayFilePath || '');

    // Always call useMemo hooks regardless of early returns
    const diffLines = useMemo(() => {
        if (!hasActualChanges) return [];

        const originalLines = displayOriginalContent.split('\n');
        const modifiedLines = displayModifiedContent.split('\n');
        const lines: DiffLine[] = [];

        const maxLines = Math.max(originalLines.length, modifiedLines.length);

        for (let i = 0; i < maxLines; i++) {
            const originalLine = originalLines[i];
            const modifiedLine = modifiedLines[i];

            if (originalLine === undefined) {
                lines.push({
                    type: 'added',
                    newLineNumber: i + 1,
                    content: modifiedLine || '',
                });
            } else if (modifiedLine === undefined) {
                lines.push({
                    type: 'removed',
                    oldLineNumber: i + 1,
                    content: originalLine,
                });
            } else if (originalLine === modifiedLine) {
                lines.push({
                    type: 'unchanged',
                    oldLineNumber: i + 1,
                    newLineNumber: i + 1,
                    content: originalLine,
                });
            } else {
                lines.push({
                    type: 'modified',
                    oldLineNumber: i + 1,
                    newLineNumber: i + 1,
                    content: modifiedLine,
                    originalContent: originalLine,
                });
            }
        }

        return lines;
    }, [displayOriginalContent, displayModifiedContent, hasActualChanges]);

    const stats = useMemo(() => {
        const added = diffLines.filter(line => line.type === 'added').length;
        const removed = diffLines.filter(line => line.type === 'removed').length;
        const modified = diffLines.filter(line => line.type === 'modified').length;
        return { added, removed, modified };
    }, [diffLines]);

    // Early return after all hooks are called
    if (!displayFilePath) {
        return (
            <div className="flex items-center justify-center h-full text-[#969798] p-4 text-center">
                {pendingAIChange ? "Loading AI proposed changes..." : "Select a file or let AI suggest changes to view differences."}
            </div>
        );
    }

    const handleCopyDiff = async () => {
        try {
            const diffText = diffLines.map(line => {
                const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                return `${prefix} ${line.content}`;
            }).join('\n');

            await navigator.clipboard.writeText(diffText);
            toast({ title: "Diff copied to clipboard" });
        } catch (error) {
            toast({ title: "Failed to copy diff", variant: "destructive" });
        }
    };

    const handleDownloadDiff = () => {
        const diffText = diffLines.map(line => {
            const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
            return `${prefix} ${line.content}`;
        }).join('\n');

        const blob = new Blob([diffText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${displayFilePath?.split('/').pop() || 'diff'}.diff`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="h-full flex flex-col bg-[#101012]">
            {/* Header */}
            <div className="flex-shrink-0 p-4 border-b border-[#313133]">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-white">
                        Diff for: {displayFilePath?.split('/').pop()}
                    </h3>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode(viewMode === 'side-by-side' ? 'unified' : 'side-by-side')}
                            className="text-xs h-7 px-2"
                        >
                            {viewMode === 'side-by-side' ? 'Unified' : 'Side by Side'}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowWhitespace(!showWhitespace)}
                            className="text-xs h-7 px-2"
                            title="Toggle Whitespace"
                        >
                            {showWhitespace ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopyDiff}
                            className="text-xs h-7 px-2"
                            title="Copy Diff"
                        >
                            <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDownloadDiff}
                            className="text-xs h-7 px-2"
                            title="Download Diff"
                        >
                            <Download className="h-3 w-3" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        {diffSource === 'ai-change' && (
                            <p className="text-xs text-blue-400">Reviewing AI proposed changes.</p>
                        )}
                        {diffSource === 'history' && (
                            <p className="text-xs text-yellow-400">Comparing with original version.</p>
                        )}
                        {diffSource === 'current-selection' && !hasActualChanges && (
                            <p className="text-xs text-gray-400">No unsaved changes.</p>
                        )}
                        {diffSource === 'current-selection' && hasActualChanges && (
                            <p className="text-xs text-orange-400">Unsaved local changes.</p>
                        )}
                    </div>

                    {hasActualChanges && (
                        <div className="flex items-center space-x-4 text-xs">
                            {stats.added > 0 && (
                                <span className="text-green-400">+{stats.added}</span>
                            )}
                            {stats.removed > 0 && (
                                <span className="text-red-400">-{stats.removed}</span>
                            )}
                            {stats.modified > 0 && (
                                <span className="text-yellow-400">~{stats.modified}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {!hasActualChanges && diffSource !== 'ai-change' ? (
                    <div className="flex-1 flex items-center justify-center h-full">
                        <p className="text-sm text-green-400">No changes detected for the current file selection.</p>
                    </div>
                ) : viewMode === 'side-by-side' ? (
                    <div className="h-full grid grid-cols-2 gap-px bg-[#313133]">
                        {/* Original Content */}
                        <div className="flex flex-col bg-[#101012]">
                            <div className="text-sm font-medium text-gray-400 p-2 bg-[#161618] border-b border-[#313133]">
                                {diffSource === 'ai-change' ? 'Current Content' : 'Original'}
                            </div>
                            <ScrollArea className="flex-1">
                                <div className="font-mono text-xs">
                                    {diffLines.map((line, index) => (
                                        line.type !== 'added' && (
                                            <div
                                                key={index}
                                                className={`flex ${line.type === 'removed' ? 'bg-red-900/20' :
                                                    line.type === 'modified' ? 'bg-yellow-900/20' : ''
                                                    }`}
                                            >
                                                <span className="w-12 text-right pr-2 text-[#969798] bg-[#161618] border-r border-[#313133] flex-shrink-0">
                                                    {line.oldLineNumber}
                                                </span>
                                                <span className="px-2 flex-1 whitespace-pre">
                                                    {line.type === 'modified' ? line.originalContent : line.content}
                                                </span>
                                            </div>
                                        )
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Modified Content */}
                        <div className="flex flex-col bg-[#101012]">
                            <div className="text-sm font-medium text-gray-400 p-2 bg-[#161618] border-b border-[#313133]">
                                {diffSource === 'ai-change' ? 'AI Proposed Content' : 'Modified'}
                            </div>
                            <ScrollArea className="flex-1">
                                <div className="font-mono text-xs">
                                    {diffLines.map((line, index) => (
                                        line.type !== 'removed' && (
                                            <div
                                                key={index}
                                                className={`flex ${line.type === 'added' ? 'bg-green-900/20' :
                                                    line.type === 'modified' ? 'bg-yellow-900/20' : ''
                                                    }`}
                                            >
                                                <span className="w-12 text-right pr-2 text-[#969798] bg-[#161618] border-r border-[#313133] flex-shrink-0">
                                                    {line.newLineNumber}
                                                </span>
                                                <span className="px-2 flex-1 whitespace-pre">
                                                    {line.content}
                                                </span>
                                            </div>
                                        )
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                ) : (
                    /* Unified View */
                    <ScrollArea className="h-full">
                        <div className="font-mono text-xs">
                            {diffLines.map((line, index) => (
                                <div
                                    key={index}
                                    className={`flex ${line.type === 'added' ? 'bg-green-900/20' :
                                        line.type === 'removed' ? 'bg-red-900/20' :
                                            line.type === 'modified' ? 'bg-yellow-900/20' : ''
                                        }`}
                                >
                                    <span className="w-12 text-right pr-2 text-[#969798] bg-[#161618] border-r border-[#313133] flex-shrink-0">
                                        {line.oldLineNumber || line.newLineNumber}
                                    </span>
                                    <span className="w-4 text-center text-[#969798] bg-[#161618] border-r border-[#313133] flex-shrink-0">
                                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                                    </span>
                                    <span className="px-2 flex-1 whitespace-pre">
                                        {line.content}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
