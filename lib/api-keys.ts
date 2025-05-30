import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";

export async function getUserApiKey(provider: string): Promise<string | null> {
    try {
        const session = await getServerSession(authOptions);
        
        if (!session?.user?.id) {
            return null;
        }

        const apiKey = await db.apiKey.findFirst({
            where: {
                userId: session.user.id,
                provider: provider,
            },
            select: {
                key: true,
            },
        });

        return apiKey?.key || null;
    } catch (error) {
        console.error("Error fetching user API key:", error);
        return null;
    }
}

/**
 * Get all API keys for the current user (server-side only)
 */
export async function getUserApiKeys(): Promise<Record<string, string>> {
    try {
        const session = await getServerSession(authOptions);
        
        if (!session?.user?.id) {
            return {};
        }

        const apiKeys = await db.apiKey.findMany({
            where: {
                userId: session.user.id,
            },
            select: {
                provider: true,
                key: true,
            },
        });

        const result: Record<string, string> = {};
        apiKeys.forEach(apiKey => {
            result[apiKey.provider] = apiKey.key;
        });

        return result;
    } catch (error) {
        console.error("Error fetching user API keys:", error);
        return {};
    }
}

