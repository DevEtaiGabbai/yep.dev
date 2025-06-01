'use client';

import { WORK_DIR } from "@/lib/prompt";
import { ChevronRight } from "lucide-react";

interface FileBreadcrumbProps {
    pathSegments: string[];
    onFileSelect: (path: string) => void;
}

export function FileBreadcrumb({ pathSegments, onFileSelect }: FileBreadcrumbProps) {
    if (!pathSegments || pathSegments.length === 0) {
        return <span className="text-xs text-[#969798]">No file selected</span>;
    }

    const handleClick = (index: number) => {
        const fullPath = WORK_DIR + '/' + pathSegments.slice(1).slice(0, index + 1).join('/');
        onFileSelect(fullPath);
    };

    return (
        <div className="flex items-center space-x-0.5 text-xs text-[#969798] overflow-x-auto whitespace-nowrap py-0.5">
            {pathSegments.map((segment, index) => (
                <span key={index} className="flex items-center">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 mx-0.5" />}
                    <button
                        onClick={() => handleClick(index)}
                        className={`hover:text-white ${index === pathSegments.length - 1 ? 'text-white font-medium' : ''}`}
                        disabled={index === pathSegments.length - 1} // Last segment is not clickable in this simple version
                    >
                        {segment}
                    </button>
                </span>
            ))}
        </div>
    );
}
