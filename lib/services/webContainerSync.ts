import { WebContainer } from '@webcontainer/api';
import { WORK_DIR } from '@/lib/prompt';

export interface FileData {
    name: string;
    path: string;
    content: string;
    mimeType: string;
    size: number;
}

/**
 * Recursively reads all files from WebContainer
 */
export async function getAllFilesFromWebContainer(
    webContainer: WebContainer,
    excludeDirs: string[] = ['/node_modules', '/.git', '/.next', '/dist', '/build', '/.cache', '/.vite', '/coverage']
): Promise<FileData[]> {
    const files: FileData[] = [];

    const readDirRecursive = async (dirPath: string) => {
        try {
            // Skip excluded directories
            if (excludeDirs.some(dir => dirPath === dir || dirPath.startsWith(dir + '/'))) {
                return;
            }

            const entries = await webContainer.fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = `${dirPath === '/' ? '' : dirPath}/${entry.name}`;
                
                // Skip excluded directories
                if (excludeDirs.some(dir => entryPath === dir || entryPath.startsWith(dir + '/'))) {
                    continue;
                }

                if (entry.isFile()) {
                    try {
                        const content = await webContainer.fs.readFile(entryPath, 'utf-8');
                        
                        // Clean the path for storage (remove WORK_DIR prefix if present)
                        let cleanPath = entryPath;
                        if (cleanPath.startsWith(WORK_DIR)) {
                            cleanPath = cleanPath.replace(WORK_DIR, '');
                        }
                        if (cleanPath.startsWith('/')) {
                            cleanPath = cleanPath.substring(1);
                        }

                        // Determine MIME type
                        const mimeType = getMimeType(entry.name);
                        const size = new Blob([content]).size;

                        files.push({
                            name: entry.name,
                            path: cleanPath,
                            content,
                            mimeType,
                            size
                        });
                    } catch (err) {
                        console.warn(`Could not read file content for ${entryPath}:`, err);
                    }
                } else if (entry.isDirectory()) {
                    await readDirRecursive(entryPath);
                }
            }
        } catch (e) {
            console.warn(`Could not read directory ${dirPath}:`, e);
        }
    };

    await readDirRecursive('/');
    return files;
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    
    const mimeMap: Record<string, string> = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'text/javascript',
        'mjs': 'text/javascript',
        'ts': 'text/typescript',
        'tsx': 'text/typescript',
        'jsx': 'text/javascript',
        'json': 'application/json',
        'md': 'text/markdown',
        'txt': 'text/plain',
        'yml': 'text/yaml',
        'yaml': 'text/yaml',
        'xml': 'text/xml',
        'svg': 'image/svg+xml',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'pdf': 'application/pdf',
        'zip': 'application/zip',
        'tar': 'application/x-tar',
        'gz': 'application/gzip'
    };

    return mimeMap[extension || ''] || 'text/plain';
}

/**
 * Sync files from WebContainer to database via API
 */
export async function syncWebContainerToProject(
    webContainer: WebContainer,
    projectId: string,
    userId: string
): Promise<{ success: boolean; fileCount: number; error?: string }> {
    try {
        const files = await getAllFilesFromWebContainer(webContainer);
        
        if (files.length === 0) {
            return { success: true, fileCount: 0 };
        }

        const response = await fetch(`/api/projects/${projectId}/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return { success: true, fileCount: result.fileCount || files.length };
    } catch (error) {
        console.error('Error syncing WebContainer to project:', error);
        return { 
            success: false, 
            fileCount: 0, 
            error: error instanceof Error ? error.message : String(error) 
        };
    }
} 