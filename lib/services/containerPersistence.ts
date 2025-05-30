import { WebContainer } from '@webcontainer/api';
import { loadFilesFromDB, saveFileToDB, syncFilesToDB } from './fileService';
import { createProject, getProject } from './projectService';

/**
 * Integrates WebContainer file operations with database persistence
 * @param webcontainerInstance The WebContainer instance
 * @param userId The user ID for database operations
 */
export function setupContainerPersistence(webcontainerInstance: WebContainer | null, userId: string) {
    if (!webcontainerInstance) {
        console.error('Cannot setup container persistence: WebContainer instance is null');
        return {
            createProjectFromFiles: async () => ({ projectId: null }),
            loadProjectFiles: async () => false,
            saveFileToProject: async () => { },
            syncFilesToProject: async () => { }
        };
    }

    /**
     * Creates a new project in the database from files in WebContainer
     */
    const createProjectFromFiles = async (
        name: string,
        description: string,
        filePaths: string[]
    ): Promise<{ projectId: string | null }> => {
        if (!userId) {
            console.error('Cannot create project: User ID not provided');
            return { projectId: null };
        }

        try {
            // Create new project in database
            const project = await createProject(userId, name);
            console.log(`Created new project: ${project.id} - ${name}`);

            // Save all specified files to this project
            await syncFilesToDB(webcontainerInstance, filePaths, userId, project.id);

            return { projectId: project.id };
        } catch (error) {
            console.error('Error creating project from files:', error);
            return { projectId: null };
        }
    };

    /**
     * Loads files from an existing project in the database into WebContainer
     */
    const loadProjectFiles = async (projectId: string): Promise<boolean> => {
        try {
            // Verify project belongs to user
            const project = await getProject(projectId);
            if (!project) {
                console.error(`Project ${projectId} not found`);
                return false;
            }

            if (project.userId !== userId) {
                console.error(`User ${userId} does not have access to project ${projectId}`);
                return false;
            }

            // Load files from database to WebContainer
            return await loadFilesFromDB(webcontainerInstance, projectId);
        } catch (error) {
            console.error(`Error loading project ${projectId}:`, error);
            return false;
        }
    };

    /**
     * Saves a single file to a project
     */
    const saveFileToProject = async (filePath: string, projectId: string): Promise<void> => {
        if (!projectId) {
            console.error('Cannot save file: Project ID not provided');
            return;
        }

        try {
            await saveFileToDB(webcontainerInstance, filePath, userId, projectId);
        } catch (error) {
            console.error(`Error saving file ${filePath} to project ${projectId}:`, error);
        }
    };

    /**
     * Syncs multiple files to a project
     */
    const syncFilesToProject = async (filePaths: string[], projectId: string): Promise<void> => {
        if (!projectId) {
            console.error('Cannot sync files: Project ID not provided');
            return;
        }

        try {
            await syncFilesToDB(webcontainerInstance, filePaths, userId, projectId);
        } catch (error) {
            console.error(`Error syncing files to project ${projectId}:`, error);
        }
    };

    return {
        createProjectFromFiles,
        loadProjectFiles,
        saveFileToProject,
        syncFilesToProject
    };
}
