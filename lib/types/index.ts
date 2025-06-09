import type { LanguageModelV1 } from "ai";

export interface Env {
  [key: string]: any;
}

export interface IProviderSetting {
  apiToken?: string;
  baseUrl?: string;
  organization?: string;
  enabled?: boolean;
}

export interface FileEntry {
  name: string;
  content?: string;
  type: 'file' | 'directory';
}

export interface ContextAnnotation {
  type: string;
  [key: string]: any;
}

export interface ProgressAnnotation {
  type: 'progress';
  label: string;
  status: 'in-progress' | 'complete' | 'error';
  order: number;
  message: string;
  [key: string]: any;
}

export interface ModelInfo {
  name: string;
  label: string;
  provider: string;
  maxTokenAllowed: number;
}

export interface GitHubFile {
  name: string;
  path: string;
  content: string;
}

export interface FileSystemTree {
  [key: string]: {
    file?: {
      contents: string;
    };
    directory?: FileSystemTree;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface Template {
  name: string;
  label: string;
  description: string;
  cloudFrontUrl: string;
  tags: string[];
  icon: string;
}

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export interface RateLimit {
  limit: number;
  remaining: number;
  resetTime?: Date;
  resetTimeString?: string;
  used: number;
}

export interface EditorRateLimit {
  resetTime?: Date;
}

// No need to extend Window interface here as it's already defined in types.d.ts
export type ProgressType = 'summary' | 'context' | 'response';
export type ProgressStatus = 'in-progress' | 'complete';

export interface ProgressIndicator {
  label: ProgressType;
  status: ProgressStatus;
  message: string;
  order: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

export interface ModelInfo {
  name: string;
  label: string;
  provider: string;
  maxTokenAllowed: number;
}

export interface ProviderInfo {
  name: string;
  staticModels: ModelInfo[];
  getDynamicModels?: (
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>
  ) => Promise<ModelInfo[]>;
  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  icon?: string;
}
export interface ProviderConfig {
  baseUrlKey?: string;
  baseUrl?: string;
  apiTokenKey?: string;
}
