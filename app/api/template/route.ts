import { NextRequest, NextResponse } from 'next/server';

interface CloudFrontTemplateFile {
  path: string;
  name: string;
  isBinary: boolean;
  content: string;
}

interface CloudFrontTemplate {
  meta: {
    name: string;
    fname: string;
    label: string;
    description: string;
    githubRepo?: string;
    tags: string[];
    icon: string;
    generatedAt: string;
    totalFiles: number;
  };
  files: CloudFrontTemplateFile[];
}

export async function GET(request: NextRequest) {
  // Extract parameters from URL
  const searchParams = request.nextUrl.searchParams;
  const templateUrl = searchParams.get('url');
  
  // Check required parameters
  if (!templateUrl) {
    return NextResponse.json(
      { error: 'Missing required parameter: url' },
      { status: 400 }
    );
  }
  
  try {
    // Fetch template from CloudFront
    const response = await fetch(templateUrl, {
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch template: ${response.status} ${response.statusText}`);
    }

    const templateData: CloudFrontTemplate = await response.json();
    
    // Transform CloudFront template format to our expected format
    const transformedFiles = templateData.files.map(file => ({
      name: file.name,
      path: file.path,
      content: file.content,
    }));

    // Return files in the same format as the old GitHub API
    return NextResponse.json({ 
      success: true, 
      templateName: templateData.meta.name,
      files: transformedFiles,
      meta: templateData.meta,
    });
  } catch (error: any) {
    console.error(`API error fetching template from ${templateUrl}:`, error);
    
    // Return error details
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Unknown error fetching template',
        templateUrl 
      },
      { status: 500 }
    );
  }
} 