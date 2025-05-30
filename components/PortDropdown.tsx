// components/PortDropdown.tsx
'use client';

import { $workbench, setActivePreview } from '@/app/lib/stores/workbenchStore';
import { useStore } from '@nanostores/react';
import { ChevronDown, Plug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

export function PortDropdown() {
    const { previews, activePreviewPort } = useStore($workbench);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const activePreview = previews.find(p => p.port === activePreviewPort);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    if (!previews || previews.length === 0) {
        return (
            <Button variant="ghost" size="icon" className="text-[#969798] h-7 w-7" disabled>
                <Plug size={16} />
            </Button>
        );
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center text-[#969798] hover:text-white h-7 px-2"
            >
                <Plug size={14} className="mr-1" />
                <span className="text-xs">{activePreview?.port || previews[0]?.port || "Port"}</span>
                <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>

            {isOpen && (
                <div className="absolute left-0 mt-1 w-36 bg-[#1f1f21] border border-[#313133] rounded-md shadow-lg z-10 py-1">
                    {previews.map(preview => (
                        <button
                            key={preview.port}
                            onClick={() => {
                                setActivePreview(preview.port, preview.baseUrl);
                                setIsOpen(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#2a2a2c] ${activePreviewPort === preview.port ? 'text-white bg-[#2a2a2c]' : 'text-[#c0c0c0]'}`}
                        >
                            Port {preview.port}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
