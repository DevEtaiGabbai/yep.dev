import { db } from '@/lib/db';
import { getGitHubRepoContent, GitHubFile } from '@/lib/utils';
import 'server-only';

// Duration to consider a cached repo valid (default: 30 days)
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedGitHubRepo {
  id: string;
  repoName: string;
  lastFetched: Date;
  files: GitHubFile[];
}

/**
 * Get a GitHub repository from the database cache or fetch from GitHub if not cached
 * This function can only be called from server components or API routes
 */
export async function getGitHubRepoFiles(
  repoName: string,
  forceFetch: boolean = false
): Promise<GitHubFile[]> {
  // Check if repo exists in database and is not too old
  const existingRepo = await db.gitHubRepo.findUnique({
    where: { repoName },
    include: { repoFiles: true },
  });

  const now = new Date();
  const isCacheValid = existingRepo &&
    (now.getTime() - existingRepo.lastFetched.getTime() < CACHE_DURATION_MS);

  // Return cached files if valid and not forcing a refresh
  if (isCacheValid && !forceFetch) {
    return existingRepo.repoFiles.map(file => ({
      name: file.name,
      path: file.path,
      content: file.content,
    }));
  }

  // Fetch files from GitHub
  try {
    const fetchedFiles = await getGitHubRepoContent(repoName);
    await upsertGitHubRepo(repoName, fetchedFiles);

    return fetchedFiles;
  } catch (error) {
    console.error(`Error fetching GitHub repo ${repoName}:`, error);

    // If we have a cached version, return it even if outdated
    if (existingRepo) {
      return existingRepo.repoFiles.map(file => ({
        name: file.name,
        path: file.path,
        content: file.content,
      }));
    }
    throw error;
  }
}

/**
 * Save or update GitHub repository files in the database
 */
async function upsertGitHubRepo(
  repoName: string,
  files: GitHubFile[]
): Promise<void> {
  // Use a transaction to ensure all operations complete together
  await db.$transaction(async (tx) => {
    // Create or update the repo record
    const repo = await tx.gitHubRepo.upsert({
      where: { repoName },
      update: {
        lastFetched: new Date(),
        updatedAt: new Date(),
      },
      create: {
        repoName,
        lastFetched: new Date(),
      },
    });

    // Delete existing files for this repo (to handle removed files)
    await tx.gitHubRepoFile.deleteMany({
      where: { repoId: repo.id },
    });

    // Create new file records
    const fileCreatePromises = files.map(file =>
      tx.gitHubRepoFile.create({
        data: {
          name: file.name,
          path: file.path,
          content: file.content,
          size: Buffer.byteLength(file.content),
          repoId: repo.id,
        },
      })
    );

    await Promise.all(fileCreatePromises);
  });

  console.log(`Successfully cached repo ${repoName} in database`);
}

/**
 * List all cached GitHub repositories
 */
export async function listCachedRepos() {
  return db.gitHubRepo.findMany({
    orderBy: { lastFetched: 'desc' },
  });
}

/**
 * Delete a cached GitHub repository
 */
export async function deleteCachedRepo(repoName: string) {
  return db.gitHubRepo.delete({
    where: { repoName },
  });
}
