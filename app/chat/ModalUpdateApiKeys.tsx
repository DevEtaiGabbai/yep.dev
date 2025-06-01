import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiKeyCache } from "@/lib/api-key-cache";
import { DEFAULT_PROVIDER } from "@/lib/provider";
import { Check, Eye, EyeOff, Loader2, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ApiKey {
    id: string;
    name: string;
    provider: string;
    key: string;
    createdAt: string;
}

interface ModalUpdateApiKeysProps {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export default function ModalUpdateApiKeys({ open, setOpen }: ModalUpdateApiKeysProps) {
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [editingProvider, setEditingProvider] = useState<string | null>(null);
    const [tempKey, setTempKey] = useState("");
    const [showKey, setShowKey] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Load API keys when modal opens - try cache first, then database
    const loadApiKeys = useCallback(async () => {
        if (!open) return;

        try {
            setIsLoading(true);
            setError(null);

            // Try to get from cache first
            const cachedKeys = ApiKeyCache.getAll();
            const providers = [DEFAULT_PROVIDER.name]; // Add more providers as needed

            if (Object.keys(cachedKeys).length > 0) {
                const mockApiKeys: ApiKey[] = providers
                    .filter(provider => cachedKeys[provider])
                    .map(provider => ({
                        id: 'cached',
                        name: `${provider} API Key`,
                        provider: provider,
                        key: cachedKeys[provider],
                        createdAt: new Date().toISOString()
                    }));

                setApiKeys(mockApiKeys);
                setIsLoading(false);
                return;
            }

            // If not in cache, fetch from database
            const response = await fetch('/api/api-keys');

            if (response.ok) {
                const data = await response.json();
                setApiKeys(data.apiKeys || []);

                // Update cache with fresh data
                data.apiKeys?.forEach((apiKey: ApiKey) => {
                    ApiKeyCache.set(apiKey.provider, apiKey.key);
                });
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to load API keys');
            }
        } catch (error) {
            console.error('Error loading API keys:', error);
            setError('Failed to load API keys');
        } finally {
            setIsLoading(false);
        }
    }, [open]);

    useEffect(() => {
        loadApiKeys();
    }, [loadApiKeys]);

    // Verify API key with OpenRouter
    const verifyApiKey = async (apiKey: string): Promise<boolean> => {
        try {
            setIsVerifying(true);
            const response = await fetch('/api/verify-key', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ apiKey }),
            });

            const data = await response.json();
            return data.valid;
        } catch (error) {
            console.error('Failed to verify API key:', error);
            return false;
        } finally {
            setIsVerifying(false);
        }
    };

    // Handle saving API key
    const handleSave = async () => {
        if (!editingProvider || !tempKey.trim()) {
            setError('API key cannot be empty');
            return;
        }

        setError(null);
        setSuccess(null);

        // Verify the API key first
        const isValid = await verifyApiKey(tempKey);

        if (!isValid) {
            setError('Invalid API key. Please check and try again.');
            return;
        }

        try {
            setIsSaving(true);

            const response = await fetch('/api/api-keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: `${editingProvider} API Key`,
                    provider: editingProvider,
                    key: tempKey,
                }),
            });

            if (response.ok) {
                const data = await response.json();

                // Update local state
                setApiKeys(prev => {
                    const filtered = prev.filter(key => key.provider !== editingProvider);
                    return [...filtered, data.apiKey];
                });

                // Update cache
                ApiKeyCache.set(editingProvider, data.apiKey.key);

                setEditingProvider(null);
                setTempKey("");
                setSuccess('API key updated successfully!');

                setTimeout(() => setSuccess(null), 3000);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to save API key');
            }
        } catch (error) {
            console.error('Error saving API key:', error);
            setError('Failed to save API key. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (provider: string) => {
        const existingKey = apiKeys.find(key => key.provider === provider);
        setEditingProvider(provider);
        setTempKey(existingKey?.key || "");
        setError(null);
        setSuccess(null);
    };

    const handleCancel = () => {
        setEditingProvider(null);
        setTempKey("");
        setError(null);
        setSuccess(null);
    };

    const toggleShowKey = (provider: string) => {
        setShowKey(prev => ({
            ...prev,
            [provider]: !prev[provider]
        }));
    };

    const providers = [DEFAULT_PROVIDER]; // Add more providers here as needed
    const getCurrentApiKey = (provider: string) => {
        return apiKeys.find(key => key.provider === provider);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md border border-[#313133] rounded-xl bg-[#161618] shadow-sm">
                <DialogHeader>
                    <DialogTitle className="text-center text-white">Update API Keys</DialogTitle>
                    <DialogDescription className="sr-only">Update your API keys for different providers.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                            <span className="ml-2 text-gray-400">Loading API keys...</span>
                        </div>
                    ) : (
                        providers.map((provider) => {
                            const currentKey = getCurrentApiKey(provider.name);
                            const isEditing = editingProvider === provider.name;
                            const hasKey = Boolean(currentKey?.key);

                            return (
                                <div key={provider.name} className="space-y-2">
                                    <Label className="text-sm font-medium text-gray-300">
                                        {provider.name} API Key
                                    </Label>

                                    {isEditing ? (
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <Input
                                                    type="password"
                                                    value={tempKey}
                                                    onChange={(e) => setTempKey(e.target.value)}
                                                    placeholder="Enter your API key"
                                                    className="border border-[#313133] rounded bg-[#1a1a1c] text-white pr-24"
                                                    disabled={isSaving || isVerifying}
                                                />
                                            </div>

                                            <div className="flex gap-2 justify-end">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={handleCancel}
                                                    disabled={isSaving || isVerifying}
                                                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                                                >
                                                    <X className="w-4 h-4 mr-1" />
                                                    Cancel
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    onClick={handleSave}
                                                    disabled={isSaving || isVerifying || !tempKey.trim()}
                                                    className="bg-green-600 hover:bg-green-700"
                                                >
                                                    {isSaving || isVerifying ? (
                                                        <>
                                                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                                                            {isVerifying ? 'Verifying...' : 'Saving...'}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Check className="w-4 h-4 mr-1" />
                                                            Save
                                                        </>
                                                    )}
                                                </Button>

                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 relative">
                                                <Input
                                                    type={showKey[provider.name] ? "text" : "password"}
                                                    value={currentKey?.key || ""}
                                                    placeholder={hasKey ? "API key configured" : "No API key set"}
                                                    className="border border-[#313133] rounded bg-[#1a1a1c] text-white pr-24"
                                                    disabled
                                                />
                                                {hasKey && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleShowKey(provider.name)}
                                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                                                    >
                                                        {showKey[provider.name] ? (
                                                            <EyeOff className="w-4 h-4" />
                                                        ) : (
                                                            <Eye className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleEdit(provider.name)}
                                                className="border-gray-600 text-gray-300 hover:bg-gray-700"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    )}

                                    {/* Status indicator */}
                                    {!isEditing && (
                                        <div className="text-xs flex items-center gap-1">
                                            {hasKey ? (
                                                <>
                                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                                    <span className="text-green-400">Configured</span>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                                    <span className="text-red-400">Not configured</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}

                    {/* Status messages */}
                    {error && (
                        <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="text-xs text-green-400 bg-green-900/20 border border-green-500/30 rounded px-2 py-1">
                            {success}
                        </div>
                    )}
                </div>

                {/* <DialogFooter className="sm:justify-end">
                    <DialogClose asChild>
                        <Button variant="secondary" className="border-gray-600 text-gray-300 hover:bg-gray-700">
                            Close
                        </Button>
                    </DialogClose>
                </DialogFooter> */}
            </DialogContent>
        </Dialog>
    );
}
