// lib/selectStarterTemplate.ts
import { STARTER_TEMPLATES } from '@/lib/constants';
import { ProviderInfo, Template } from '@/lib/types/index';


const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects, Vite is preferred.

Available templates:
<template>
  <name>blank</name>
  <description>Empty starter for simple scripts and trivial tasks that don't require a full template setup</description>
  <tags>basic, script</tags>
</template>
${templates
    .map(
      (template) => `
<template>
  <name>${template.name}</name>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
    )
    .join('\n')}

Response Format:
<selection>
  <templateName>{selected template name}</templateName>
  <title>{a proper title for the project}</title>
</selection>

Examples:

<example>
User: I need to build a todo app
Response:
<selection>
  <templateName>react-basic-starter</templateName>
  <title>Simple React todo application</title>
</selection>
</example>

<example>
User: Write a script to generate numbers from 1 to 100
Response:
<selection>
  <templateName>blank</templateName>
  <title>script to generate numbers from 1 to 100</title>
</selection>
</example>

Instructions:
1. For trivial tasks and simple scripts, always recommend the blank template
2. For more complex projects, recommend templates from the provided list
3. Follow the exact XML format
4. Consider both technical requirements and tags
5. If no perfect match exists, recommend the closest option

Important: Provide only the selection tags in your response, no additional text.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH
`;

const parseSelectedTemplate = (llmOutput: string): { template: string; title: string } | null => {
  try {
    // Extract content between <templateName> tags
    const templateNameMatch = llmOutput.match(/<templateName>(.*?)<\/templateName>/);
    const titleMatch = llmOutput.match(/<title>(.*?)<\/title>/);

    if (!templateNameMatch) {
      return null;
    }

    return { template: templateNameMatch[1].trim(), title: titleMatch?.[1].trim() || 'Untitled Project' };
  } catch (error) {
    console.error('Error parsing template selection:', error);
    return null;
  }
};

export const selectStarterTemplate = async (options: {
  message: string;
  model: string;
  provider: ProviderInfo
}) => {
  const { message, model, provider } = options;
  const requestBody = {
    message,
    model,
    provider,
    system: starterTemplateSelectionPrompt(STARTER_TEMPLATES),
  };

  try {
    const response = await fetch('/api/llmcall', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const respJson = await response.json();

    const { text } = respJson;
    const selectedTemplate = parseSelectedTemplate(text);

    if (selectedTemplate) {
      return selectedTemplate;
    } else {
      return {
        template: 'blank',
        title: '',
      };
    }
  } catch (error) {
    console.error('Error in template selection:', error);
    return {
      template: 'blank',
      title: '',
    };
  }
};

// Function to fetch template files from GitHub
export async function getTemplates(templateName: string, title?: string) {
  const template = STARTER_TEMPLATES.find(t => t.name === templateName);

  if (!template) {
    return null;
  }

  try {
    const files = await getGitHubRepoContent(template.githubRepo);
    let filteredFiles = files;

    // Exclude .git and .bolt files
    filteredFiles = filteredFiles.filter(x => !x.path.startsWith('.git') && !x.path.startsWith('.bolt'));

    // Format files for the assistant message
    const assistantMessage = `
Initializing your project with the required files using the ${template.name} template.
<boltArtifact id="imported-files" title="${title || 'Create initial files'}" type="bundled">
${filteredFiles.map(file => `
<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`).join('\n')}
</boltArtifact>
`;

    // Create user message with instructions
    const userMessage = `
Template import is complete. You can now use the imported files,
edit only the files that need to be changed, and create new files as needed.

IMPORTANT: Don't forget to install the dependencies before running the app by using \`npm install && npm run dev\`
`;

    return {
      assistantMessage,
      userMessage,
      files: filteredFiles,
    };
  } catch (error) {
    console.error('Error getting template files:', error);
    return null;
  }
}

// Helper function to fetch GitHub repo content
const getGitHubRepoContent = async (repoName: string): Promise<Array<{ name: string; path: string; content: string }>> => {
  try {
    const response = await fetch(`/api/github-template?repo=${encodeURIComponent(repoName)}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching GitHub repo content:', error);
    throw error;
  }
};
