import { getGitHubRepoFiles } from '@/lib/services/github-repo.server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Extract parameters from URL
  const searchParams = request.nextUrl.searchParams;
  const repoName = searchParams.get('repo');
  const forceFetch = searchParams.get('forceFetch') === 'true';
  
  // Check required parameters
  if (!repoName) {
    return NextResponse.json(
      { error: 'Missing required parameter: repo' },
      { status: 400 }
    );
  }
  
  try {
    // Fetch GitHub repository files using the server-side function
    const files = await getGitHubRepoFiles(repoName, forceFetch);
    
    // Return files as JSON response
    return NextResponse.json({ 
      success: true, 
      repoName,
      files,
    });
  } catch (error: any) {
    console.error(`API error fetching GitHub repo ${repoName}:`, error);
    
    // Return error details
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Unknown error fetching GitHub repository',
        repoName 
      },
      { status: 500 }
    );
  }
} 