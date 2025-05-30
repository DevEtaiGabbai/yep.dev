import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Project creation/update schema
const projectSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
});

// Get all projects for the current user
export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const projects = await db.project.findMany({
            where: {
                userId: session.user.id,
            },
            include: {
                _count: {
                    select: {
                        files: true,
                    },
                },
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        return NextResponse.json({ projects });
    } catch (error) {
        console.error("Error fetching projects:", error);
        return NextResponse.json(
            { error: "Failed to fetch projects" },
            { status: 500 }
        );
    }
}

// Create a new project
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { name, description } = projectSchema.parse(body);

        // Create the project
        const project = await db.project.create({
            data: {
                name,
                userId: session.user.id,
            },
        });

        return NextResponse.json(
            { project, message: "Project created successfully" },
            { status: 201 }
        );
    } catch (error) {
        console.error("Error creating project:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input data", details: error.errors },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to create project" },
            { status: 500 }
        );
    }
}
