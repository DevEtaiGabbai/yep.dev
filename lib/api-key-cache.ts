import Cookies from "js-cookie";

interface ApiKeyCacheMap {
    [provider: string]: string;
}

// Cookie key for storing API keys
const API_KEY_COOKIE = 'apiKeys';
const CACHE_EXPIRY_DAYS = 30;

export class ApiKeyCache {
    /**
     * Get API key from cache (cookie)
     */
    static get(provider: string): string | null {
        try {
            const cached = Cookies.get(API_KEY_COOKIE);
            if (!cached) return null;

            const apiKeys: ApiKeyCacheMap = JSON.parse(cached);
            return apiKeys[provider] || null;
        } catch (error) {
            console.error('Error reading API key cache:', error);
            return null;
        }
    }

    /**
     * Set API key in cache (cookie)
     */
    static set(provider: string, apiKey: string): void {
        try {
            const existing = this.getAll();
            existing[provider] = apiKey;
            
            Cookies.set(API_KEY_COOKIE, JSON.stringify(existing), { 
                expires: CACHE_EXPIRY_DAYS 
            });
        } catch (error) {
            console.error('Error setting API key cache:', error);
        }
    }

    /**
     * Remove API key from cache
     */
    static remove(provider: string): void {
        try {
            const existing = this.getAll();
            delete existing[provider];
            
            if (Object.keys(existing).length === 0) {
                Cookies.remove(API_KEY_COOKIE);
            } else {
                Cookies.set(API_KEY_COOKIE, JSON.stringify(existing), { 
                    expires: CACHE_EXPIRY_DAYS 
                });
            }
        } catch (error) {
            console.error('Error removing API key from cache:', error);
        }
    }

    /**
     * Get all cached API keys
     */
    static getAll(): ApiKeyCacheMap {
        try {
            const cached = Cookies.get(API_KEY_COOKIE);
            return cached ? JSON.parse(cached) : {};
        } catch (error) {
            console.error('Error reading API key cache:', error);
            return {};
        }
    }

    /**
     * Clear all cached API keys
     */
    static clear(): void {
        Cookies.remove(API_KEY_COOKIE);
    }

    /**
     * Check if a provider has a cached API key
     */
    static has(provider: string): boolean {
        return this.get(provider) !== null;
    }

    /**
     * Refresh cache from server
     */
    static async refresh(): Promise<void> {
        try {
            const response = await fetch('/api/api-keys');
            if (response.ok) {
                const data = await response.json();
                const apiKeyCache: ApiKeyCacheMap = {};
                
                data.apiKeys?.forEach((apiKey: any) => {
                    apiKeyCache[apiKey.provider] = apiKey.key;
                });
                
                Cookies.set(API_KEY_COOKIE, JSON.stringify(apiKeyCache), { 
                    expires: CACHE_EXPIRY_DAYS 
                });
            }
        } catch (error) {
            console.error('Error refreshing API key cache:', error);
        }
    }
}

/**
 * Hook for using API key cache with React
 */
export function useApiKeyCache() {
    const get = (provider: string) => ApiKeyCache.get(provider);
    const set = (provider: string, apiKey: string) => ApiKeyCache.set(provider, apiKey);
    const remove = (provider: string) => ApiKeyCache.remove(provider);
    const getAll = () => ApiKeyCache.getAll();
    const clear = () => ApiKeyCache.clear();
    const has = (provider: string) => ApiKeyCache.has(provider);
    const refresh = () => ApiKeyCache.refresh();

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