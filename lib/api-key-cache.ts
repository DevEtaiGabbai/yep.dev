import Cookies from "js-cookie";

interface ApiKeyCacheMap {
    [provider: string]: string;
}

const getCookieNameForUser = (userId: string | null | undefined): string => {
    if (userId) {
        return `apiKeys_${userId}`;
    }
    return 'apiKeys_guest';
};

const CACHE_EXPIRY_DAYS = 30;

export class ApiKeyCache {
    /**
     * Get API key from user-specific cache (cookie)
     */
    static get(userId: string | null, provider: string): string | null {
        try {
            const cookieName = getCookieNameForUser(userId);
            const cached = Cookies.get(cookieName);
            if (!cached) return null;

            const apiKeys: ApiKeyCacheMap = JSON.parse(cached);
            return apiKeys[provider] || null;
        } catch (error) {
            console.error('Error reading API key cache for user:', userId, error);
            return null;
        }
    }

    /**
     * Set API key in user-specific cache (cookie)
     */
    static set(userId: string | null, provider: string, apiKey: string): void {
        try {
            const cookieName = getCookieNameForUser(userId);
            const existing = this.getAll(userId); // Get all keys for this specific user
            existing[provider] = apiKey;

            Cookies.set(cookieName, JSON.stringify(existing), {
                expires: CACHE_EXPIRY_DAYS
            });
        } catch (error) {
            console.error('Error setting API key cache for user:', userId, error);
        }
    }

    /**
     * Remove API key from user-specific cache
     */
    static remove(userId: string | null, provider: string): void {
        try {
            const cookieName = getCookieNameForUser(userId);
            const existing = this.getAll(userId); // Get all keys for this specific user
            delete existing[provider];

            if (Object.keys(existing).length === 0) {
                Cookies.remove(cookieName);
            } else {
                Cookies.set(cookieName, JSON.stringify(existing), {
                    expires: CACHE_EXPIRY_DAYS
                });
            }
        } catch (error) {
            console.error('Error removing API key from cache for user:', userId, error);
        }
    }

    /**
     * Get all cached API keys for a specific user
     */
    static getAll(userId: string | null): ApiKeyCacheMap {
        try {
            const cookieName = getCookieNameForUser(userId);
            const cached = Cookies.get(cookieName);
            return cached ? JSON.parse(cached) : {};
        } catch (error) {
            console.error('Error reading API key cache for user:', userId, error);
            return {};
        }
    }

    /**
     * Clear all cached API keys for a specific user
     */
    static clear(userId: string | null): void {
        const cookieName = getCookieNameForUser(userId);
        Cookies.remove(cookieName);
    }

    /**
     * Check if a provider has a cached API key for a specific user
     */
    static has(userId: string | null, provider: string): boolean {
        return this.get(userId, provider) !== null;
    }

    /**
     * Refresh cache from server for a specific user
     * This assumes /api/api-keys endpoint is user-aware via session cookie
     * and returns keys appropriate for the authenticated user.
     */
    static async refresh(userId: string | null): Promise<void> {
        try {
            const response = await fetch('/api/api-keys'); // This fetch should be authenticated
            if (response.ok) {
                const data = await response.json();
                const apiKeyCacheMap: ApiKeyCacheMap = {};

                // Assuming data.apiKeys is an array of {provider: string, key: string}
                data.apiKeys?.forEach((apiKey: { provider: string, key: string }) => {
                    apiKeyCacheMap[apiKey.provider] = apiKey.key;
                });

                const cookieName = getCookieNameForUser(userId);
                Cookies.set(cookieName, JSON.stringify(apiKeyCacheMap), {
                    expires: CACHE_EXPIRY_DAYS
                });
            } else {
                console.error('Failed to refresh API key cache from server, status:', response.status);
            }
        } catch (error) {
            console.error('Error refreshing API key cache for user:', userId, error);
        }
    }
}

/**
 * Hook for using user-specific API key cache with React
 */
export function useApiKeyCache(userId: string | null) {
    const get = (provider: string) => ApiKeyCache.get(userId, provider);
    const set = (provider: string, apiKey: string) => ApiKeyCache.set(userId, provider, apiKey);
    const remove = (provider: string) => ApiKeyCache.remove(userId, provider);
    const getAll = () => ApiKeyCache.getAll(userId);
    const clear = () => ApiKeyCache.clear(userId);
    const has = (provider: string) => ApiKeyCache.has(userId, provider);
    const refresh = () => ApiKeyCache.refresh(userId);

    return {
        get,
        set,
        remove,
        getAll,
        clear,
        has,
        refresh
    };
}
