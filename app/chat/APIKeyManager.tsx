import { IconButton } from "@/components/ui/IconButton";
import { ApiKeyCache } from "@/lib/api-key-cache";
import { ProviderInfo } from "@/lib/types";
import { Check, CircleX, KeyRound, Loader2, Pencil, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

interface APIKeyManagerProps {
  provider: ProviderInfo;
  onApiKeyChange?: (hasValidKey: boolean) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  userId?: string | null;
}

interface ApiKey {
  id: string;
  name: string;
  provider: string;
  key: string;
  createdAt: string;
}

export const APIKeyManager: React.FC<APIKeyManagerProps> = ({
  provider,
  onApiKeyChange,
  userId,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState("");
  const [currentApiKey, setCurrentApiKey] = useState<ApiKey | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load API keys when component mounts - try cache first, then database
  const loadApiKeys = useCallback(async () => {
    try {
      setIsLoading(true);

      const cachedKey = userId ? ApiKeyCache.get(provider.name, userId) : null;
      if (cachedKey) {
        const mockApiKey: ApiKey = {
          id: 'cached-' + userId,
          name: `${provider.name} API Key`,
          provider: provider.name,
          key: cachedKey,
          createdAt: new Date().toISOString()
        };
        setCurrentApiKey(mockApiKey);
        setTempKey(cachedKey);
        onApiKeyChange?.(true);
        setIsLoading(false);
        return;
      }
      const response = await fetch('/api/api-keys');
      if (response.ok) {
        const data = await response.json();
        const apiKey = data.apiKeys.find((key: ApiKey) => key.provider === provider.name);
        if (apiKey) {
          setCurrentApiKey(apiKey);
          setTempKey(apiKey.key);
          if (userId) {
            ApiKeyCache.set(provider.name, apiKey.key, userId);
          }
          onApiKeyChange?.(true);
        } else {
          setCurrentApiKey(null);
          setTempKey("");
          onApiKeyChange?.(false);
        }
      } else {
        setCurrentApiKey(null);
        setTempKey("");
        onApiKeyChange?.(false);
      }
    } catch (error) {
      console.error("Failed to load API keys:", error);
      setCurrentApiKey(null);
      setTempKey("");
      onApiKeyChange?.(false);
    } finally {
      setIsLoading(false);
    }
  }, [provider.name, onApiKeyChange, userId]);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

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
      console.error("Failed to verify API key:", error);
      return false;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = async () => {
    if (!tempKey.trim()) {
      setError("API key cannot be empty");
      return;
    }

    setError(null);
    setSuccess(null);

    // First verify the API key
    const isValid = await verifyApiKey(tempKey);

    if (!isValid) {
      setError("Invalid API key. Please check and try again.");
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `${provider.name} API Key`,
          provider: provider.name,
          key: tempKey,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentApiKey(data.apiKey);

        // Update cache
        if (userId) {
          ApiKeyCache.set(provider.name, data.apiKey.key, userId);
        }

        setIsEditing(false);
        setSuccess("API key saved successfully!");
        onApiKeyChange?.(true);

        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to save API key");
      }
    } catch (error) {
      console.error("Failed to save API key:", error);
      setError("Failed to save API key. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setTempKey(currentApiKey?.key || "");
    setIsEditing(false);
    setError(null);
    setSuccess(null);
  };

  const hasValidKey = Boolean(currentApiKey?.key);

  if (isLoading && !isEditing) {
    return (
      <div className="flex items-center py-3 px-1 gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-400">Loading API key...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center py-3 px-1 gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-bolt-elements-textSecondary">
              {provider?.name} API Key:
            </span>
            {!isEditing && (
              <div className="flex items-center gap-2">
                {hasValidKey ? (
                  <>
                    <Check className="text-green-500 w-4 h-4" />
                    <span className="text-xs text-green-500">Configured</span>
                  </>
                ) : (
                  <>
                    <CircleX className="text-red-500 w-4 h-4" />
                    <span className="text-xs text-red-500">
                      Please input API key
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={tempKey}
                placeholder="Enter API Key"
                onChange={(e) => setTempKey(e.target.value)}
                className="w-[300px] px-3 py-1.5 text-sm border border-[#313133] rounded bg-[#161618] shadow-sm"
                disabled={isLoading || isVerifying}
              />
              <IconButton
                onClick={handleSave}
                title="Save API Key"
                className="bg-green-500/10 hover:bg-green-500/20 text-green-500"
                disabled={isLoading || isVerifying || !tempKey.trim()}
              >
                {isLoading || isVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="text-green-500 w-4 h-4" />
                )}
              </IconButton>
              <IconButton
                onClick={handleCancel}
                title="Cancel"
                className="bg-red-500/10 hover:bg-red-500/20 text-red-500"
                disabled={isLoading || isVerifying}
              >
                <X className="w-4 h-4 text-red-500" />
              </IconButton>
            </div>
          ) : (
            <>
              <IconButton
                onClick={() => setIsEditing(true)}
                title={hasValidKey ? "Edit API Key" : "Add API Key"}
                className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-500"
              >
                <Pencil className="w-4 h-4 text-gray-400" />
              </IconButton>
              {provider?.getApiKeyLink && !hasValidKey && (
                <IconButton
                  onClick={() => window.open(provider?.getApiKeyLink)}
                  title="Get API Key"
                  className="bg-purple-500/10 text-blue-400 hover:bg-blue-500/20 flex items-center gap-2"
                >
                  <span className="text-xs whitespace-nowrap">
                    {provider?.labelForGetApiKey || "Get API Key"}
                  </span>
                  <KeyRound className="w-4 h-4" />
                </IconButton>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="px-1">
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded px-2 py-1">
            {error}
          </div>
        </div>
      )}

      {success && (
        <div className="px-1">
          <div className="text-xs text-green-400 bg-green-900/20 border border-green-500/30 rounded px-2 py-1">
            {success}
          </div>
        </div>
      )}

      {isVerifying && (
        <div className="px-1">
          <div className="text-xs text-blue-400 bg-blue-900/20 border border-blue-500/30 rounded px-2 py-1 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Verifying API key...
          </div>
        </div>
      )}
    </div>
  );
};
