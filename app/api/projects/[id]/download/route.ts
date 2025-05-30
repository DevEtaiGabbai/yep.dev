import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

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

        // Get project with files (using same pattern as existing route)
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

        if (project.files.length === 0) {
            return NextResponse.json(
                { error: "No files found in project" },
                { status: 400 }
            );
        }

        // Create ZIP file
        const zip = new JSZip();

        // Add files to zip
        for (const file of project.files) {
            if (file.content) {
                // Ensure proper path structure
                const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
                zip.file(filePath, file.content);
            }
        }

        // Generate zip buffer
        const zipBuffer = await zip.generateAsync({ 
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: {
                level: 6
            }
        });

        // Create safe filename
        const safeProjectName = project.name.replace(/[^a-zA-Z0-9-_]/g, '_');
        const filename = `${safeProjectName}_${new Date().toISOString().split('T')[0]}.zip`;

        // Return zip file
        return new NextResponse(zipBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': zipBuffer.length.toString(),
            },
        });

    } catch (error) {
        console.error("Error downloading project:", error);
        return NextResponse.json(
            { error: "Failed to download project" },
            { status: 500 }
        );
    }
} 