import { authOptions } from "@/lib/auth";
import { MAX_FREE_PROJECT } from "@/lib/constants";
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

        // Check subscription status and project limit for free users
        const user = await db.user.findUnique({
            where: { id: session.user.id },
            include: {
                projects: true
            }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // If user is not subscribed and has 5 or more projects, deny creation
        if (!user.isSubscribed && user.projects.length >= MAX_FREE_PROJECT) {
            return NextResponse.json(
                {
                    error: 'Project limit reached',
                    message: 'Free users can create up to 5 projects. Upgrade to Pro for unlimited projects.',
                    requiresUpgrade: true
                },
                { status: 403 }
            );
        }

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
