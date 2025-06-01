// components/LockManager.tsx
'use client';

import { $workbench } from "@/app/lib/stores/workbenchStore";
import { useStore } from "@nanostores/react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "../ui/button";

export function LockManager() {
    const { files } = useStore($workbench);

    // This is a simplified version. A full implementation would involve:
    // - Getting the current chat ID
    // - Using your fileLocks utility or store to check/set lock status
    // - Persisting locks (e.g., in localStorage or your database)

    const lockedItems = Object.entries(files)
        .filter(([_, entry]) => entry?.isLocked)
        .map(([path, entry]) => ({ path, type: entry!.type, lockedByFolder: entry!.lockedByFolder }));


    const handleUnlock = (path: string, isFolder: boolean) => {
        // Placeholder: In a real app, call your store's unlockFile/unlockFolder action
        console.log(`Request to unlock ${isFolder ? 'folder' : 'file'}: ${path}`);
    };

    if (lockedItems.length === 0) {
        return (
            <div className="p-4 text-center text-xs text-muted-foreground">
                <LockOpen className="mx-auto h-8 w-8 mb-2 opacity-50" />
                No items are currently locked.
            </div>
        );
    }

    return (
        <div className="p-2 space-y-1 overflow-auto h-full">
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Locked Items</div>
            {lockedItems.map(item => (
                <div key={item.path} className="flex items-center justify-between p-1.5 rounded hover:bg-accent">
                    <div className="flex items-center space-x-2 overflow-hidden">
                        <Lock className="h-3 w-3 text-destructive flex-shrink-0" />
                        <span className="text-xs truncate" title={item.path}>
                            {item.path.replace('/home/project/', '')} {/* Show relative path */}
                        </span>
                        {item.lockedByFolder && (
                            <span className="text-xs text-muted-foreground truncate" title={`Locked by folder: ${item.lockedByFolder}`}>
                                (in {item.lockedByFolder.split('/').pop()})
                            </span>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => handleUnlock(item.path, item.type === 'directory')}
                    >
                        Unlock
                    </Button>
                </div>
            ))}
        </div>
    );
}
