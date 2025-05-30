"use client";

import { AuthenticatedLayout } from "@/components/layouts/AuthenticatedLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { UploadedImage, useImageUpload } from "@/hooks/useImageUpload";
import { usePromptEnhancer } from "@/hooks/usePromptEnhancer";
import {
  DEFAULT_TEMPLATE,
  STARTER_TEMPLATES
} from "@/lib/constants";
import { DEFAULT_PROVIDER } from "@/lib/provider";
import { ModelInfo } from "@/lib/types";
import Cookies from "js-cookie";
import { ArrowUp, Image, Loader2, X } from "lucide-react";
import { atom } from "nanostores";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ModelSelector } from "../components/chat/ModelSelector";
import { APIKeyManager } from "./APIKeyManager";

function Chat() {
  const { data: session, status } = useSession();
  const expoUrlAtom = atom<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>();
  const [modelList, setModelList] = useState<ModelInfo[]>(
    DEFAULT_PROVIDER.staticModels
  );
  const [showingError, setShowingError] = useState(false);
  const { uploadImage, uploadFromClipboard, isUploading, uploadError, clearError } = useImageUpload();
  const [isModelLoading, setIsModelLoading] = useState<string | undefined>(
    "all"
  );
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [hasValidApiKey, setHasValidApiKey] = useState(false);
  const [isLoadingApiKey, setIsLoadingApiKey] = useState(true);

  // const { providers, isLoading, error } = useProviders();
  const [model, setModel] = useState(() => {
    const savedModel = Cookies.get("selectedModel");
    return savedModel || "DEFAULT_MODEL";
  });

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // let parsedApiKeys: Record<string, string> | undefined = {};

      // try {
      //   parsedApiKeys = { a: "getApiKeysFromCookies()" }
      //   setApiKeys(parsedApiKeys);
      // } catch (error) {
      //   console.error('Error loading API keys from cookies:', error);
      //   // Cookies.remove('apiKeys');
      // }

      setIsModelLoading('all');
      fetch('/api/models')
        .then((response) => response.json())
        .then((data) => {
          const typedData = data as { modelList: ModelInfo[] };
          setModelList(typedData.modelList);
        })
        .catch((error) => {
          console.error("Error fetching model list:", error);
        })
        .finally(() => {
          setIsModelLoading(undefined);
        });
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onApiKeysChange = async (providerName: string, apiKey: string) => {
    const newApiKeys = { ...apiKeys, [providerName]: apiKey };
    setApiKeys(newApiKeys);
    Cookies.set('apiKeys', JSON.stringify(newApiKeys));

    setIsModelLoading(providerName);

    let providerModels: ModelInfo[] = [];

    try {
      const response = await fetch(
        `/api/models/${encodeURIComponent(providerName)}`
      );
      const data = await response.json();
      providerModels = (data as { modelList: ModelInfo[] }).modelList;
    } catch (error) {
      console.error("Error loading dynamic models for:", providerName, error);
    }

    // Only update models for the specific provider
    setModelList((prevModels) => {
      const otherModels = prevModels.filter(
        (model) => model.provider !== providerName
      );
      return [...otherModels, ...providerModels];
    });
    setIsModelLoading(undefined);
  };
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const { enhancePrompt, enhancingPrompt } = usePromptEnhancer();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isStarterLoading, setIsStarterLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApiKeyChange = (hasValidKey: boolean) => {
    setHasValidApiKey(hasValidKey);
    setIsLoadingApiKey(false);
  };

  // Set loading to false after a timeout as fallback
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoadingApiKey(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    if (!hasValidApiKey) {
      alert("Please configure your OpenRouter API key first.");
      return;
    }

    setIsStarterLoading(true);

    try {
      // Prepare the message content - include images if any
      let messageContent: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;

      if (uploadedImages.length > 0) {
        // Create mixed content with text and images
        messageContent = [
          {
            type: 'text',
            text: trimmedPrompt
          },
          ...uploadedImages.map(image => ({
            type: 'image_url' as const,
            image_url: {
              url: image.signUrl
            }
          }))
        ];
      } else {
        messageContent = trimmedPrompt;
      }

      // Create a new conversation in the database
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedPrompt.substring(0, 50) + (trimmedPrompt.length > 50 ? '...' : ''),
          initialMessage: messageContent,
          templateName: DEFAULT_TEMPLATE.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to start chat:", errorData.error || 'Unknown error');
        setIsStarterLoading(false);
        return;
      }

      const { conversation } = await response.json();
      if (!conversation || !conversation.id) {
        console.error("API did not return a valid conversation object.");
        setIsStarterLoading(false);
        return;
      }

      router.push(`/app/${conversation.id}?template=${encodeURIComponent(DEFAULT_TEMPLATE.name)}&prompt=${encodeURIComponent(trimmedPrompt)}&sendFirst=true&model=${encodeURIComponent(model)}`);
    } catch (error) {
      console.error('Error initiating chat:', error);
    } finally {
      setIsStarterLoading(false);
      setPrompt('');
      setUploadedImages([]); // Clear uploaded images after submitting
    }
  };


  const examplePrompts = [
    "A todo app with React and TypeScript",
    "E-commerce dashboard with Next.js",
    "Blog with Astro and Tailwind",
    "Chat app with React and Firebase",
    "Job board with Express and MongoDB",
  ];

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    Cookies.set("selectedModel", newModel, { expires: 30 });
  };

  const handleLogout = async () => {
    await signOut({
      redirect: true,
      callbackUrl: "/login"
    });

  };

  const handleUploadImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    clearError();
    const uploadedImage = await uploadImage(file);
    if (uploadedImage) {
      setUploadedImages(prev => [...prev, uploadedImage]);
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  return (
    <div className="min-h-screen bg-[#101012] text-white">
      <header className="flex justify-end items-center p-3">
        {
          status === "authenticated" && (
            <div className="flex items-center gap-4">
              <div className="text-sm">{session?.user?.email}</div>
              <Button
                className="border border-[#313133] rounded-xl bg-[#161618] shadow-sm p-3"
                variant="outline"
                onClick={handleLogout}
              >
                Sign Out
              </Button>
            </div>
          )
        }
      </header >

      <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-12">
        {/* Header */}
        <div className="space-y-2">

          <div className="flex items-center gap-2 flex-col  mt-8">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-medium tracking-tight"> Build any apps with Yev</h1>
              <Badge className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-0">
                Beta
              </Badge>
            </div>
            <p className="text-gray-400 text-lg">Yev builds complete, cross-platform web apps using AI.</p>
          </div>
        </div>

        {/* API Key Configuration */}
        {/* {!hasValidApiKey && (
          <div className="border border-yellow-500/30 rounded-xl bg-yellow-900/10 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <h3 className="text-lg font-medium text-yellow-400">API Key Required</h3>
            </div>
            <p className="text-yellow-200/80 mb-4">
              Please configure your OpenRouter API key to start building apps. Your key will be securely stored and used for AI model access.
            </p>
            {isLoadingApiKey ? (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking for existing API key...</span>
              </div>
            ) : (
              <APIKeyManager
                provider={DEFAULT_PROVIDER}
                onApiKeyChange={handleApiKeyChange}
              />
            )}
          </div>
        )} */}

        {/* Main prompt area */}
        <div className="w-full pt-4">
          <form onSubmit={handleSubmit} className="border border-[#313133] rounded-xl bg-[#161618] shadow-sm p-3">
            <div className="pb-3">
              <ModelSelector
                key={model}
                model={model}
                setModel={handleModelChange}
                modelList={modelList}
                apiKeys={apiKeys}
                modelLoading={isModelLoading}
              />
            </div>

            {hasValidApiKey ? <></> : <APIKeyManager
              provider={DEFAULT_PROVIDER}
              onApiKeyChange={handleApiKeyChange}
            />}

            <div className="border border-[#313133] rounded-xl bg-[#161618] shadow-sm">
              {/* Image preview area */}
              {uploadedImages.length > 0 && (
                <div className="mb-3 p-3 bg-[#1a1a1c] rounded-lg border border-[#313133]">
                  <div className="flex flex-wrap gap-2">
                    {uploadedImages.map((image, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={image.url}
                          alt={image.filename}
                          className="w-20 h-20 object-cover rounded border border-[#313133]"
                        />
                        <button
                          onClick={() => removeImage(index)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 rounded-b truncate">
                          {image.filename}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload error display */}
              {uploadError && (
                <div className="mb-3 p-2 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-sm">
                  {uploadError}
                </div>
              )}

              <div className="p-3 relative">
                <Textarea
                  ref={textareaRef}
                  placeholder="An app that helps me plan my day"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={async (event) => {
                    const items = event.clipboardData?.items;
                    if (!items) return;

                    for (const item of Array.from(items)) {
                      if (item.type.startsWith('image/')) {
                        event.preventDefault();
                        clearError();

                        const file = item.getAsFile();
                        if (file) {
                          const uploadedImage = await uploadImage(file);
                          if (uploadedImage) {
                            setUploadedImages(prev => [...prev, uploadedImage]);
                          }
                        }
                        break;
                      }
                    }
                  }}
                  className="min-h-[56px] max-h-[250px] resize-none border-0 p-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-500 text-sm pr-12 overflow-y-auto"
                  translate="no"
                  style={{
                    transition: "height 0.1s ease",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={!hasValidApiKey}
                />
                {(prompt.length > 0 || isStarterLoading) && hasValidApiKey && (
                  <div className="absolute top-3 right-3">
                    <Button
                      type="submit"
                      size="icon"
                      className="h-10 w-10 rounded-full bg-blue-500 hover:bg-blue-600"
                      disabled={isStarterLoading || enhancingPrompt || !prompt.trim()}
                    >
                      {isStarterLoading ? (
                        <Icons.spinner className="w-5 h-5 text-[#101012] animate-spin" />
                      ) : (
                        <ArrowUp className="w-5 h-5 text-[#101012]" />
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="flex justify-start p-3 mt-4">
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-[#969798] hover:text-[#f3f6f6] hover:bg-[#212122]"
                    disabled={showingError || isUploading || !hasValidApiKey}
                    onClick={handleUploadImage}
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Image className="w-4 h-4" />
                    )}
                  </Button>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
                    onClick={() =>
                      enhancePrompt(prompt, setPrompt, model, {
                        name: "Qwen: Qwen3 8B (free)",
                        apiKey: process.env.OPENAI_API_KEY,
                      })
                    }
                    disabled={enhancingPrompt || prompt.length === 0 || !hasValidApiKey}
                  >
                    <Icons.sparkles
                      className={`w-4 h-4 ${enhancingPrompt ? "animate-pulse" : ""
                        }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Example Prompts */}
        <div className="space-y-3 pt-10">
          <div className="text-sm text-gray-400">Try building</div>
          <div className="flex flex-wrap gap-2 flex-row items-center justify-center">
            {examplePrompts.map((example, index) => (
              <button
                key={index}
                className="px-3 py-1.5 text-sm bg-[#161618] border border-[#313133] rounded-full hover:bg-[#1e1e20] transition-colors disabled:opacity-50"
                onClick={() => setPrompt(example)}
                disabled={!hasValidApiKey}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {/* Start coding section */}
        <div className="space-y-6 pt-12">
          <h2 className="text-sm font-medium text-gray-200">
            Or start a blank app with your favorite stack
          </h2>

          <div className="flex items-center space-x-6 overflow-x-auto pb-2 justify-center">
            <div className="flex items-center gap-6">
              {STARTER_TEMPLATES.map((template) => (
                <Link
                  key={template.name}
                  href={hasValidApiKey ? `/${template.name}` : "#"}
                  className={`flex flex-col items-center gap-2 group hover:bg-gray-900 rounded-lg p-4 transition-colors justify-center ${!hasValidApiKey ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  aria-label={template.label}
                >
                  <div className="w-8 h-8 flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity">
                    {Icons[template.icon as keyof typeof Icons]({
                      className: "w-8 h-8",
                      style: { maskType: "alpha" },
                    })}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div >
  );
}

export default function ChatPage() {
  return (
    <AuthenticatedLayout>
      <Chat />
    </AuthenticatedLayout>
  );
}
