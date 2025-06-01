import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const apiKeySchema = z.object({
    name: z.string().min(1, "Name is required"),
    provider: z.string().min(1, "Provider is required"),
    key: z.string().min(1, "API key is required"),
});

const updateApiKeySchema = z.object({
    key: z.string().min(1, "API key is required"),
});

// Get all API keys for the current user
export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const apiKeys = await db.apiKey.findMany({
            where: {
                userId: session.user.id,
            },
            select: {
                id: true,
                name: true,
                provider: true,
                key: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return NextResponse.json({ apiKeys });
    } catch (error) {
        console.error("Error fetching API keys:", error);
        return NextResponse.json(
            { error: "Failed to fetch API keys" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { name, provider, key } = apiKeySchema.parse(body);

        const existingApiKey = await db.apiKey.findFirst({
            where: {
                userId: session.user.id,
                provider: provider,
            },
        });

        if (existingApiKey) {
            const updatedApiKey = await db.apiKey.update({
                where: {
                    id: existingApiKey.id,
                },
                data: {
                    key: key,
                    name: name,
                },
            });

            return NextResponse.json(
                {
                    apiKey: {
                        id: updatedApiKey.id,
                        name: updatedApiKey.name,
                        provider: updatedApiKey.provider,
                        key: updatedApiKey.key,
                        createdAt: updatedApiKey.createdAt,
                    },
                    message: "API key updated successfully",
                },
                { status: 200 }
            );
        } else {
            const apiKey = await db.apiKey.create({
                data: {
                    name,
                    provider,
                    key,
                    userId: session.user.id,
                },
            });

            return NextResponse.json(
                {
                    apiKey: {
                        id: apiKey.id,
                        name: apiKey.name,
                        provider: apiKey.provider,
                        key: apiKey.key,
                        createdAt: apiKey.createdAt,
                    },
                    message: "API key added successfully",
                },
                { status: 201 }
            );
        }
    } catch (error) {
        console.error("Error creating API key:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input data", details: error.errors },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to create API key" },
            { status: 500 }
        );
    }
}

export async function PUT(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const provider = searchParams.get("provider");

        if (!provider) {
            return NextResponse.json(
                { error: "Provider is required" },
                { status: 400 }
            );
        }

        const body = await req.json();
        const { key } = updateApiKeySchema.parse(body);

        // Find existing API key for this provider
        const existingApiKey = await db.apiKey.findFirst({
            where: {
                userId: session.user.id,
                provider: provider,
            },
        });

        if (!existingApiKey) {
            return NextResponse.json(
                { error: "API key not found for this provider" },
                { status: 404 }
            );
        }

        // Update the API key
        const updatedApiKey = await db.apiKey.update({
            where: {
                id: existingApiKey.id,
            },
            data: {
                key: key,
            },
        });

        return NextResponse.json(
            {
                apiKey: {
                    id: updatedApiKey.id,
                    name: updatedApiKey.name,
                    provider: updatedApiKey.provider,
                    key: updatedApiKey.key,
                    createdAt: updatedApiKey.createdAt,
                },
                message: "API key updated successfully",
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error updating API key:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input data", details: error.errors },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to update API key" },
            { status: 500 }
        );
    }
}

// Delete an API key
export async function DELETE(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { error: "API key ID is required" },
                { status: 400 }
            );
        }

        // Verify ownership before deletion
        const apiKey = await db.apiKey.findFirst({
            where: {
                id,
                userId: session.user.id,
            },
        });

        if (!apiKey) {
            return NextResponse.json(
                { error: "API key not found or not authorized" },
                { status: 404 }
            );
        }

        // Delete the API key
        await db.apiKey.delete({
            where: {
                id,
            },
        });

        return NextResponse.json(
            { message: "API key deleted successfully" },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error deleting API key:", error);
        return NextResponse.json(
            { error: "Failed to delete API key" },
            { status: 500 }
        );
    }
}
