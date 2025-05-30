import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export interface File {
    id: string;
    name: string;
    path: string;
    content?: string;
    mimeType?: string;
    size?: number;
    projectId?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface Project {
    id: string;
    name: string;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    files: File[];
}

export async function createProject(userId: string, name: string): Promise<Project> {
    const project = await db.project.create({
        data: {
            id: uuidv4(),
            name,
            userId,
        },
        include: {
            files: true,
        },
    });

    return {
        id: project.id,
        name: project.name,
        userId: project.userId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            content: f.content || undefined,
            mimeType: f.mimeType || undefined,
            size: f.size || undefined,
            projectId: f.projectId || undefined,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt
        }))
    };
}

export async function createProjectWithConversation(
    userId: string, 
    name: string, 
    conversationId: string
): Promise<Project> {
    const project = await db.project.create({
        data: {
            id: uuidv4(),
            name,
            userId,
        },
        include: {
            files: true,
        },
    });

    // Link the conversation to this project
    await db.conversation.update({
        where: {
            id: conversationId,
        },
        data: {
            projectId: project.id,
        },
    });

    return {
        id: project.id,
        name: project.name,
        userId: project.userId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            content: f.content || undefined,
            mimeType: f.mimeType || undefined,
            size: f.size || undefined,
            projectId: f.projectId || undefined,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt
        }))
    };
}

export async function getProject(projectId: string): Promise<Project | null> {
    const project = await db.project.findUnique({
        where: {
            id: projectId,
        },
        include: {
            files: true,
        },
    });

    if (!project) return null;

    return {
        id: project.id,
        name: project.name,
        userId: project.userId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            content: f.content || undefined,
            mimeType: f.mimeType || undefined,
            size: f.size || undefined,
            projectId: f.projectId || undefined,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt
        }))
    };
}

export async function getProjectByConversationId(conversationId: string): Promise<Project | null> {
    const conversation = await db.conversation.findUnique({
        where: {
            id: conversationId,
        },
    });

    if (!conversation?.projectId) return null;

    return getProject(conversation.projectId);
}

export async function getUserProjects(userId: string): Promise<Project[]> {
    const projects = await db.project.findMany({
        where: {
            userId,
        },
        include: {
            files: true,
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });

    return projects.map(project => ({
        id: project.id,
        name: project.name,
        // description: project.description || undefined,
        userId: project.userId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            content: f.content || undefined,
            mimeType: f.mimeType || undefined,
            size: f.size || undefined,
            projectId: f.projectId || undefined,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt
        }))
    }));
}

export async function addFileToProject(
    projectId: string,
    userId: string,
    file: { name: string; path: string; content?: string; mimeType?: string; size?: number }
): Promise<File> {
    const dbFile = await db.file.create({
        data: {
            id: uuidv4(),
            name: file.name,
            path: file.path,
            content: file.content,
            mimeType: file.mimeType,
            size: file.size,
            projectId,
        },
    });

    // Update project's updatedAt
    await db.project.update({
        where: {
            id: projectId,
        },
        data: {
            updatedAt: new Date(),
        },
    });

    return {
        id: dbFile.id,
        name: dbFile.name,
        path: dbFile.path,
        content: dbFile.content || undefined,
        mimeType: dbFile.mimeType || undefined,
        size: dbFile.size || undefined,
        projectId: dbFile.projectId || undefined,
        createdAt: dbFile.createdAt,
        updatedAt: dbFile.updatedAt
    };
}

export async function syncFilesToProject(
    projectId: string,
    userId: string,
    files: Array<{ name: string; path: string; content: string; mimeType?: string; size?: number }>
): Promise<{ fileCount: number }> {
    // Verify project ownership
    const project = await db.project.findFirst({
        where: {
            id: projectId,
            userId: userId,
        },
    });

    if (!project) {
        throw new Error('Project not found or not authorized');
    }

    // Use transaction to ensure consistency
    await db.$transaction(async (tx) => {
        // Delete existing files for this project
        await tx.file.deleteMany({
            where: {
                projectId: projectId,
            },
        });

        // Insert new files
        if (files.length > 0) {
            await tx.file.createMany({
                data: files.map(file => ({
                    id: uuidv4(),
                    name: file.name,
                    path: file.path,
                    content: file.content,
                    mimeType: file.mimeType || 'text/plain',
                    size: file.size || new Blob([file.content]).size,
                    projectId: projectId,
                })),
            });
        }

        // Update project timestamp
        await tx.project.update({
            where: {
                id: projectId,
            },
            data: {
                updatedAt: new Date(),
            },
        });
    });

    return { fileCount: files.length };
}

export async function updateProject(projectId: string, data: { name?: string; description?: string }): Promise<void> {
    await db.project.update({
        where: {
            id: projectId,
        },
        data: {
            ...data,
            updatedAt: new Date(),
        },
    });
}
