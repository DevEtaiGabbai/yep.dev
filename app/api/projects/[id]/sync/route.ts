import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Schema for file sync request
const fileSyncSchema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        name: z.string(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
    }))
});

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const projectId = params.id;
        const body = await req.json();
        const { files } = fileSyncSchema.parse(body);

        // Verify project ownership (using same pattern as existing route)
        const existingProject = await db.project.findFirst({
            where: {
                id: projectId,
                userId: session.user.id,
            },
        });

        if (!existingProject) {
            return NextResponse.json(
                { error: "Project not found or not authorized" },
                { status: 404 }
            );
        }

        // Delete existing files first
        await db.file.deleteMany({
            where: {
                projectId: projectId,
            },
        });

        // Insert new files if any
        if (files.length > 0) {
            const fileData = files.map(file => ({
                name: file.name,
                path: file.path,
                content: file.content,
                mimeType: file.mimeType || 'text/plain',
                size: file.size || new Blob([file.content]).size,
                projectId: projectId,
            }));

            await db.file.createMany({
                data: fileData,
            });
        }

        // Update project timestamp
        await db.project.update({
            where: {
                id: projectId,
            },
            data: {
                updatedAt: new Date(),
            },
        });

        return NextResponse.json({
            message: `Successfully synced ${files.length} files`,
            fileCount: files.length,
        });

    } catch (error) {
        console.error("Error syncing files:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input data", details: error.errors },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to sync files" },
            { status: 500 }
        );
    }
} 