import { WORK_DIR } from '@/lib/prompt';
import { WebContainer } from '@webcontainer/api';
import { addFileToProject } from './projectService';


export async function saveFileToDB(
    webcontainerInstance: WebContainer | null,
    filePath: string,
    userId: string,
    projectId: string
): Promise<void> {
    if (!webcontainerInstance || !projectId) {
        console.error('Cannot save file to DB: WebContainer or ProjectID not available');
        return;
    }

    try {
        // Get the file content from WebContainer
        const fileContent = await webcontainerInstance.fs.readFile(filePath, 'utf-8');

        // Extract the file name from the path
        const pathParts = filePath.split('/');
        const fileName = pathParts[pathParts.length - 1];

        // Clean the path for storage
        let cleanPath = filePath;
        if (cleanPath.startsWith(WORK_DIR)) {
            cleanPath = cleanPath.replace(WORK_DIR, '');
        }
        // Make sure path doesn't start with /
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }

        const size = new Blob([fileContent]).size;

        const extension = fileName.split('.').pop()?.toLowerCase();
        let mimeType = 'text/plain';

        const mimeMap: Record<string, string> = {
            'html': 'text/html',
            'css': 'text/css',
            'js': 'text/javascript',
            'ts': 'text/typescript',
            'json': 'application/json',
            'md': 'text/markdown',
            'txt': 'text/plain',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'pdf': 'application/pdf'
        };

        if (extension && extension in mimeMap) {
            mimeType = mimeMap[extension];
        }

        await addFileToProject(projectId, userId, {
            name: fileName,
            path: cleanPath,
            content: fileContent,
            mimeType,
            size
        });

        console.log(`File "${filePath}" saved to database under project ${projectId}`);
    } catch (error) {
        console.error(`Error saving file "${filePath}" to database:`, error);
    }
}

/**
 * Syncs multiple files from WebContainer to the database
 */
export async function syncFilesToDB(
    webcontainerInstance: WebContainer | null,
    filePaths: string[],
    userId: string,
    projectId: string
): Promise<void> {
    if (!webcontainerInstance || !projectId) {
        console.error('Cannot sync files to DB: WebContainer or ProjectID not available');
        return;
    }

    const promises = filePaths.map(filePath =>
        saveFileToDB(webcontainerInstance, filePath, userId, projectId)
    );

    await Promise.all(promises);
    console.log(`Synced ${filePaths.length} files to database for project ${projectId}`);
}

/**
 * Loads files from the database into WebContainer
 */
export async function loadFilesFromDB(
    webcontainerInstance: WebContainer | null,
    projectId: string,
): Promise<boolean> {
    if (!webcontainerInstance) {
        console.error('Cannot load files from DB: WebContainer not available');
        return false;
    }

    try {
        // Import here to avoid circular dependency
        const { getProject } = await import('./projectService');

        const project = await getProject(projectId);
        if (!project) {
            console.error(`Project with ID ${projectId} not found`);
            return false;
        }

        // Track directories to create
        const directories = new Set<string>();

        // Extract directory paths from file paths
        for (const file of project.files) {
            if (!file.path) continue;

            const parts = file.path.split('/');
            if (parts.length > 1) {
                // Build and collect directory paths
                for (let i = 1; i < parts.length; i++) {
                    const dirPath = parts.slice(0, i).join('/');
                    if (dirPath) directories.add(dirPath);
                }
            }
        }

        // Create directories in proper order (shortest paths first)
        for (const dir of Array.from(directories).sort((a, b) => a.length - b.length)) {
            try {
                const fullPath = `/${dir}`;
                await webcontainerInstance.fs.mkdir(fullPath, { recursive: true });
            } catch (err) {
                console.warn(`Could not create directory ${dir}:`, err);
            }
        }

        // Write files
        for (const file of project.files) {
            if (!file.path || !file.content) continue;

            try {
                const fullPath = `/${file.path}`;
                await webcontainerInstance.fs.writeFile(fullPath, file.content);
            } catch (err) {
                console.error(`Error writing file ${file.path}:`, err);
            }
        }

        console.log(`Loaded ${project.files.length} files into WebContainer from project ${projectId}`);
        return true;
    } catch (error) {
        console.error('Error loading files from database:', error);
        return false;
    }
}
