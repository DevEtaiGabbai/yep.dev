import { ChevronDown, ChevronRight, File } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// app/components/chat/FileExplorer.tsx
interface FileExplorerProps {
    files: string[]; // Expects an array of full absolute paths, e.g., "/home/project/src/index.js"
    selectedFile: string | null;
    onSelectFile: (file: string) => void;
}

interface TreeNode {
    name: string;
    fullPath: string; // Store the full original path
    isDirectory: boolean;
    children: Record<string, TreeNode>;
}

export default function FileExplorer({
    files,
    selectedFile,
    onSelectFile,
}: FileExplorerProps) {
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
        new Set([""])
    ); // Root is initially expanded

    useEffect(() => {
        if (selectedFile) {
            const parts = selectedFile.split("/").filter(Boolean); // ignore empty strings
            const foldersToExpand = new Set<string>();
            let currentPath = "";

            // Go through each folder part except the file name
            for (let i = 0; i < parts.length - 1; i++) {
                currentPath += `/${parts[i]}`;
                foldersToExpand.add(currentPath);
            }

            setExpandedFolders((prev) => {
                const updated = new Set(prev);
                foldersToExpand.forEach((f) => updated.add(f));
                return updated;
            });
        }
    }, [selectedFile]);

    // Build a more robust tree structure
    const fileTreeRoot = useMemo(() => {
        const root: TreeNode = {
            name: "",
            fullPath: "/",
            isDirectory: true,
            children: {},
        };

        files.forEach((filePath) => {
            // Ensure paths start with a slash for consistent splitting
            const correctedFilePath = filePath.startsWith("/")
                ? filePath
                : `/${filePath}`;
            const parts = correctedFilePath.substring(1).split("/"); // Remove leading '/' then split

            let currentLevel = root.children;
            let currentPath = "";

            parts.forEach((part, index) => {
                currentPath += `/${part}`;
                const isLastPart = index === parts.length - 1;

                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        fullPath: currentPath,
                        isDirectory: !isLastPart,
                        children: {},
                    };
                } else if (!isLastPart && !currentLevel[part].isDirectory) {
                    // If a file was mistakenly created as a directory segment earlier
                    currentLevel[part].isDirectory = true;
                    currentLevel[part].children = currentLevel[part].children || {};
                }

                if (!isLastPart) {
                    currentLevel = currentLevel[part].children;
                } else {
                    // If it's the last part, it's a file; ensure its fullPath is correct
                    currentLevel[part].fullPath = correctedFilePath;
                    currentLevel[part].isDirectory = false; // Explicitly mark as file
                }
            });
        });
        return root;
    }, [files]);

    const toggleFolder = (folderPath: string) => {
        setExpandedFolders((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(folderPath)) {
                newSet.delete(folderPath);
            } else {
                newSet.add(folderPath);
            }
            return newSet;
        });
    };

    const renderNode = (node: TreeNode) => {
        return (
            <div
                key={node.fullPath}
                style={{ paddingLeft: node.name ? "1rem" : "0" }}
                className="my-0.5"
            >
                <div
                    className={`flex items-center p-1 rounded cursor-pointer hover:bg-[#2a2a2c] transition-colors ${selectedFile === node.fullPath && "bg-[#2a2a2c] text-white"
                        }`}
                    onClick={() => {
                        if (!node.isDirectory) {
                            onSelectFile(node.fullPath);
                        } else {
                            // Implement folder expansion/collapse logic here
                            toggleFolder(node.fullPath);
                        }
                    }}
                >
                    <span className="mr-1"></span>
                    {Object.keys(node?.children).length > 0 ? (
                        expandedFolders.has(node.fullPath) ? (
                            <ChevronDown size={16} className="mr-1" />
                        ) : (
                            <ChevronRight size={16} className="mr-1" />
                        )
                    ) : (
                        <File size={16} className="mr-1" />
                    )}

                    <span className="truncate text-xs">{node.name}</span>
                </div>

                {expandedFolders.has(node.fullPath) && node.children && (
                    <div className="pl-2 border-l border-[#313133] ml-[7px]">
                        {Object.values(node.children)
                            .sort((a, b) => {
                                if (a.isDirectory && !b.isDirectory) return -1;
                                if (!a.isDirectory && b.isDirectory) return 1;
                                return a.name.localeCompare(b.name);
                            })
                            .map((child) => renderNode(child))}
                    </div>
                )}
            </div>
        );
    };

    return (

        <div className="text-sm text-[#969798]">
            {Object.values(fileTreeRoot.children)
                .sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                })
                .map((node) => renderNode(node))}
        </div>
    );
}
