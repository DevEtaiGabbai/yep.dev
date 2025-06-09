
const getStorageKey = (userId?: string | null): string => {
    return userId ? `apiKeys_${userId}` : 'apiKeys_guest';
};

export const getApiKeyFromStorage = (provider: string, userId?: string | null): string | null => {
    try {
        if (typeof window === 'undefined') return null;

        const storageKey = getStorageKey(userId);
        const cached = localStorage.getItem(storageKey);
        if (!cached) return null;

        const apiKeys = JSON.parse(cached);
        return apiKeys[provider] || null;
    } catch (error) {
        console.error('Error reading API key from localStorage:', error);
        return null;
    }
};

export const setApiKeyInStorage = (provider: string, apiKey: string, userId?: string | null): void => {
    try {
        if (typeof window === 'undefined') return;

        const storageKey = getStorageKey(userId);
        const existing = getAllApiKeysFromStorage(userId);
        existing[provider] = apiKey;

        localStorage.setItem(storageKey, JSON.stringify(existing));
    } catch (error) {
        console.error('Error saving API key to localStorage:', error);
    }
};

export const getAllApiKeysFromStorage = (userId?: string | null): Record<string, string> => {
    try {
        if (typeof window === 'undefined') return {};

        const storageKey = getStorageKey(userId);
        const cached = localStorage.getItem(storageKey);

        // If user-specific storage is empty, check guest storage for migration
        if (!cached && userId) {
            const guestStorage = localStorage.getItem('apiKeys_guest');
            if (guestStorage) {
                const guestKeys = JSON.parse(guestStorage);
                // Migrate guest keys to user-specific storage
                localStorage.setItem(storageKey, guestStorage);
                // Clean up guest storage
                localStorage.removeItem('apiKeys_guest');
                return guestKeys;
            }
        }

        return cached ? JSON.parse(cached) : {};
    } catch (error) {
        console.error('Error reading API keys from localStorage:', error);
        return {};
    }
};

export function getApiKeysFromRequest(apiKeys: Record<string, string> | null): Record<string, string> {
    if (apiKeys && Object.keys(apiKeys).length > 0) {
        return apiKeys;
    }

    // No fallback to environment variables - user must provide API keys
    console.warn("No API keys provided from client request");
    return {};
}

