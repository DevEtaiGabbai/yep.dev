// app/components/ErrorNotificationModal.tsx
'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle, Github, X } from 'lucide-react';

interface ErrorNotificationModalProps {
    error: string | null;
    rateLimitResetTime?: string | null;
    onClose: () => void;
    isOpen: boolean;
}

export function ErrorNotificationModal({
    error,
    rateLimitResetTime = null,
    onClose,
    isOpen,
}: ErrorNotificationModalProps) {
    if (!isOpen || !error) {
        return null;
    }

    const isNotFoundError = error.includes('Status: 404') || error.includes('Not Found');

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 transition-opacity duration-300 ease-out">
            <div className="relative bg-[#1a1a1c] border border-[#3a3a3f] p-6 rounded-lg shadow-2xl max-w-md w-full text-gray-100 animate-in fade-in-0 zoom-in-95 duration-300">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="absolute top-3 right-3 h-7 w-7 text-[#a0a0a0] hover:text-white hover:bg-[#2a2a2c] rounded-full"
                    aria-label="Close error notification"
                >
                    <X size={18} />
                </Button>

                <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-lg font-semibold mb-2 text-red-400">Initialization Problem</h2>
                        <p className="text-sm text-[#c0c0c0] mb-3 whitespace-pre-wrap break-words">{error}</p>
                    </div>
                </div>

                {isNotFoundError && (
                    <div className="mt-3 bg-[#2a2a2c]/70 p-3 border-l-2 border-red-500 rounded-r-md">
                        <div className="flex items-center mb-1">
                            <Github className="mr-2 text-[#a0a0a0]" size={14} />
                            <h3 className="text-xs font-medium text-red-400">Repository Not Found</h3>
                        </div>
                        <p className="text-xs text-[#a0a0a0] mt-1">
                            The GitHub repository could not be found. Please check the URL or template name.
                        </p>
                    </div>
                )}

                <div className="mt-4 pt-3 border-t border-[#3a3a3f]">
                    <p className="text-xs text-[#a0a0a0]">
                        The development server might have failed to start. You can still access the code editor and terminal to investigate and fix the issue.
                        Please check the terminal for specific error messages.
                    </p>
                </div>
                <div className="mt-5 flex justify-end">
                    <Button
                        onClick={onClose}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-2 h-auto rounded-md"
                    >
                        Continue to Editor
                    </Button>
                </div>
            </div>
        </div>
    );
}
