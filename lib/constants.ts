import { Template } from './types/index';

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/1completions1';
// export const DEFAULT_MODEL = 'google/gemma-3-4b-it';
// export const DEFAULT_MODEL = 'deepseek/deepseek-r1:free';
// export const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';
// export const DEFAULT_MODEL = 'meta-llama/llama-3.3-8b-instruct:free';
// export const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';
// export const DEFAULT_MODEL = 'meta-llama/llama-4-maverick:free';
// export const DEFAULT_MODEL = "google/gemma-3-4b-it:free"

export const DEFAULT_MODEL = 'deepseek/deepseek-chat-v3-0324:free';

// export const SECONDARY_MODEL = 'google/gemini-2.0-flash-001';
export const SECONDARY_MODEL = 'qwen/qwen3-14b:free';

export const MAX_TOKENS_NO_SUMMARY = 8000; // Maximum tokens before requiring chat summary
export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yml',
];

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
  lockedByFolder?: string;
}

export interface Folder {
  type: 'folder';
  isLocked?: boolean;
  lockedByFolder?: string;
}

type Dirent = File | Folder;
export type FileMap = Record<string, Dirent | undefined>;

export const CLOUDFRONT_BASE_URL = 'https://d2locx3yj0ppqr.cloudfront.net';

export const STARTER_TEMPLATES: Template[] = [
  {
    name: 'nextjs-shadcn',
    label: 'Next.js with shadcn/ui',
    description: 'Next.js starter fullstack template integrated with shadcn/ui components and styling system',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/nextjs-shadcn-template.json`,
    tags: ['nextjs', 'react', 'typescript', 'shadcn', 'tailwind'],
    icon: 'next',
  },
  {
    name: 'sveltekit',
    label: 'SvelteKit',
    description: 'SvelteKit starter template for building fast, efficient web applications',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/sveltekit-template.json`,
    tags: ['svelte', 'sveltekit', 'typescript'],
    icon: 'svelte',
  },
  {
    name: 'vite-react-ts',
    label: 'React + Vite + TypeScript',
    description: 'React starter template powered by Vite for fast development experience',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/vite-react-ts-template.json`,
    tags: ['react', 'vite', 'frontend'],
    icon: 'react',
  },
  {
    name: 'vite-ts',
    label: 'Vite + TypeScript',
    description: 'Vite starter template with TypeScript configuration for type-safe development',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/vite-ts-template.json`,
    tags: ['vite', 'typescript', 'minimal'],
    icon: 'typescript',
  },
  {
    name: 'vue',
    label: 'Vue.js',
    description: 'Vue.js starter template with modern tooling and best practices',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/vue-template.json`,
    tags: ['vue', 'typescript', 'frontend'],
    icon: 'vue',
  },
  {
    name: 'vanilla-vite',
    label: 'Vanilla + Vite',
    description: 'Minimal Vite starter template for vanilla JavaScript projects',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/vanilla-vite-template.json`,
    tags: ['vite', 'vanilla-js', 'minimal'],
    icon: 'vite',
  },
  {
    name: 'astro-basic',
    label: 'Astro Basic',
    description: 'Lightweight Astro starter template for building fast static websites',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/astro-basic-template.json`,
    tags: ['astro', 'blog', 'performance'],
    icon: 'astro',
  },
  {
    name: 'angular',
    label: 'Angular',
    description: 'Angular starter template with modern tooling and best practices',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/angular-template.json`,
    tags: ['angular', 'typescript', 'frontend'],
    icon: 'angular',
  },
  {
    name: 'expo',
    label: 'Expo React Native',
    description: 'Expo starter template for React Native mobile development',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/expo-template.json`,
    tags: ['expo', 'react-native', 'mobile'],
    icon: 'expo',
  },
  {
    name: 'qwik-ts',
    label: 'Qwik + TypeScript',
    description: 'Qwik starter template with TypeScript for performance-focused applications',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/qwik-ts-template.json`,
    tags: ['qwik', 'typescript', 'performance'],
    icon: 'qwik',
  },
  {
    name: 'remix-ts',
    label: 'Remix + TypeScript',
    description: 'Remix starter template with TypeScript for full-stack web applications',
    cloudFrontUrl: `${CLOUDFRONT_BASE_URL}/remix-ts-template.json`,
    tags: ['remix', 'typescript', 'full-stack'],
    icon: 'remix',
  }
];

// Default template when user enters prompt without selecting a template
export const DEFAULT_TEMPLATE = STARTER_TEMPLATES.find(t => t.name === 'vite-react-ts') || STARTER_TEMPLATES[2];

// Maximum time in milliseconds to wait for a terminal command to complete
export const MAX_TERMINAL_EXECUTION_TIME = 15000; // 15 seconds

export const MAX_FREE_PROJECT = 5
