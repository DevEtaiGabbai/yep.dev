import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Project update schema
const projectUpdateSchema = z.object({
    name: z.string().min(1, "Name is required").optional(),
    description: z.string().optional(),
});

// Get a specific project
export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const projectId = params.id;

        const project = await db.project.findFirst({
            where: {
                id: projectId,
                userId: session.user.id,
            },
            include: {
                files: true
            },
        });

        if (!project) {
            return NextResponse.json(
                { error: "Project not found or not authorized" },
                { status: 404 }
            );
        }

        return NextResponse.json({ project });
    } catch (error) {
        console.error("Error fetching project:", error);
        return NextResponse.json(
            { error: "Failed to fetch project" },
            { status: 500 }
        );
    }
}

// Update a project
export async function PATCH(
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

        const { name, description } = projectUpdateSchema.parse(body);

        // Verify ownership before update
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

        // Update the project
        const updatedProject = await db.project.update({
            where: {
                id: projectId,
            },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
            },
        });

        return NextResponse.json({
            project: updatedProject,
            message: "Project updated successfully",
        });
    } catch (error) {
        console.error("Error updating project:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input data", details: error.errors },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to update project" },
            { status: 500 }
        );
    }
}

// Delete a project
export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const projectId = params.id;

        // Verify ownership before deletion
        const project = await db.project.findFirst({
            where: {
                id: projectId,
                userId: session.user.id,
            },
        });

        if (!project) {
            return NextResponse.json(
                { error: "Project not found or not authorized" },
                { status: 404 }
            );
        }

        // Delete the project (this will cascade delete files and conversations)
        await db.project.delete({
            where: {
                id: projectId,
            },
        });

        return NextResponse.json(
            { message: "Project deleted successfully" },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error deleting project:", error);
        return NextResponse.json(
            { error: "Failed to delete project" },
            { status: 500 }
        );
    }
}
