import { getApiKeysFromRequest } from '@/lib/api-keys';
import { MAX_TOKENS_NO_SUMMARY } from '@/lib/constants';
import { CONTINUE_PROMPT, WORK_DIR } from '@/lib/prompt';
import { createSummary } from '@/lib/server/create-summary';
import { getFilePaths, selectContext } from '@/lib/server/select-context';
import { extractPropertiesFromMessage } from '@/lib/server/serverUtils';
import { streamText, type Messages, type StreamingOptions } from '@/lib/server/stream-text';
import SwitchableStream from '@/lib/server/switchable-stream';
import { addMessage, getConversation } from '@/lib/services/conversationService';
import { countMessageTokens } from '@/lib/tokenizer';
import type { ContextAnnotation, FileMap, IProviderSetting, ProgressAnnotation } from '@/lib/types/index';
import { createDataStream, generateId } from 'ai';

const MAX_RESPONSE_SEGMENTS = 10;
const MAX_TOKENS = 65536;

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

export async function POST(request: Request) {
  try {
    const requestData = await request.json();
    const { messages, files, promptId, contextOptimization, conversationId, selectedModel, apiKeys: clientApiKeys } = requestData as {
      messages: Messages;
      files: any;
      promptId?: string;
      contextOptimization: boolean;
      conversationId?: string;
      selectedModel?: string;
      apiKeys?: Record<string, string>;
    };

    if (messages.length === 0) {
      console.error("API Chat Route: No messages provided in request");
      throw new Error("No messages provided");
    }

    if (!conversationId) {
      console.warn("API Chat Route: No conversationId provided - responses won't be saved to database");
    }

    // Check if this is a refresh and conversation already has messages
    if (conversationId) {
      try {
        const existingConversation = await getConversation(conversationId);

        // If conversation exists and already has at least 2 messages (user + assistant response)
        if (existingConversation && existingConversation.messages.length >= 2) {
          const existingUserMessages = existingConversation.messages.filter(m => m.role === 'user');
          const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0];

          // Check if the new message already exists in the conversation
          if (lastUserMessage && existingUserMessages.some(m => m.content === lastUserMessage.content)) {
            // Return the existing messages from the database instead of generating a new response
            const dataStream = createDataStream({
              async execute(dataStream) {
                dataStream.writeData({
                  type: 'progress',
                  label: 'response',
                  status: 'complete',
                  order: 1,
                  message: 'Using existing response',
                } satisfies ProgressAnnotation);

                // Get the last assistant message in the conversation
                const lastAssistantMessage = existingConversation.messages
                  .filter(m => m.role === 'assistant')
                  .pop();

                if (lastAssistantMessage) {
                  dataStream.write(`0:${lastAssistantMessage.content}\n`);
                } else {
                  dataStream.write(`0:No previous response found.\n`);
                }
              }
            });

            return new Response(dataStream, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                Connection: 'keep-alive',
                'Cache-Control': 'no-cache',
                'Text-Encoding': 'chunked',
              },
            });
          }
        }
      } catch (error) {
        console.error("API Chat Route: Error checking existing conversation:", error);
      }
    }

    const cookieHeader = request.headers.get('Cookie');

    // Get API keys from client request
    const apiKeys = getApiKeysFromRequest(clientApiKeys);

    const providerSettings: Record<string, IProviderSetting> = JSON.parse(
      parseCookies(cookieHeader || '').providers || '{}',
    );

    const stream = new SwitchableStream();

    const cumulativeUsage = {
      completionTokens: 0,
      promptTokens: 0,
      totalTokens: 0,
    };
    const encoder: TextEncoder = new TextEncoder();
    let progressCounter: number = 1;

    const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0];
    const modelForTokenizer = selectedModel || extractPropertiesFromMessage(lastUserMessage).model;

    // Determine model family for token counting
    const modelFamily = modelForTokenizer?.toLowerCase().includes('gemini')
      ? 'gemini'
      : modelForTokenizer?.toLowerCase().includes('claude')
        ? 'claude'
        : modelForTokenizer?.toLowerCase().includes('gpt')
          ? 'gpt'
          : 'default';

    // Count tokens accurately using the appropriate tokenizer
    const totalTokenCount = countMessageTokens(messages, modelFamily as any);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        // Save user message to conversation if conversationId is provided
        if (conversationId && lastUserMessage) {
          try {
            // Check if this exact message already exists in the conversation to prevent duplicates
            const existingConversation = await getConversation(conversationId);
            const messageText = typeof lastUserMessage.content === 'string'
              ? lastUserMessage.content
              : JSON.stringify(lastUserMessage.content);

            const messageAlreadyExists = existingConversation?.messages.some(msg => {
              if (msg.role !== 'user') return false;

              const existingContent = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content);

              return existingContent === messageText;
            });

            if (!messageAlreadyExists) {
              await addMessage(conversationId, {
                role: 'user',
                content: messageText
              });
            }
          } catch (error) {
            console.error('Failed to save user message:', error);
            // Continue processing even if user message save fails
          }
        }

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        if (messages.length > 3) {
          messageSliceId = messages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          // Skip summary creation if message is below token threshold
          const shouldCreateSummary = totalTokenCount > MAX_TOKENS_NO_SUMMARY;

          if (shouldCreateSummary) {
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Analysing Request',
            } satisfies ProgressAnnotation);

            // Create a summary of the chat
            summary = await createSummary({
              messages: [...messages],
              env: process.env,
              apiKeys,
              providerSettings,
              promptId,
              contextOptimization,
              onFinish(resp) {
                if (resp.usage) {
                  cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                  cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                  cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
                }
              },
            });
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'complete',
              order: progressCounter++,
              message: 'Analysis Complete',
            } satisfies ProgressAnnotation);

            dataStream.writeMessageAnnotation({
              type: 'chatSummary',
              summary,
              chatId: messages.slice(-1)?.[0]?.id,
            } as ContextAnnotation);
          }
          // Update context buffer
          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Determining Files to Read',
          } satisfies ProgressAnnotation);

          // Select context files
          filteredFiles = await selectContext({
            messages: [...messages],
            env: process.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            selectedModel,
            onFinish(resp) {
              if (resp.usage) {
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          // Process paths to ensure they're all relative
          const processedPaths = Object.keys(filteredFiles).map((key) => {
            let path = key;

            // First remove the work dir prefix if present
            if (path.startsWith(WORK_DIR)) {
              path = path.replace(WORK_DIR, '');
            }

            // Make sure we don't have any leading slashes to ensure path is relative
            while (path.startsWith('/')) {
              path = path.substring(1);
            }

            return path;
          });

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: processedPaths,
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

        }

        const options: StreamingOptions = {
          toolChoice: 'none',
          onFinish: async ({ text: content, finishReason, usage }) => {
            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {

              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const lastUserMessage = messages.filter((x) => x.role == 'user').slice(-1)[0];
            const { provider } = extractPropertiesFromMessage(lastUserMessage);
            const modelToUse = selectedModel || extractPropertiesFromMessage(lastUserMessage).model;

            messages.push({ id: generateId(), role: 'assistant', content });
            messages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${modelToUse}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages,
              env: process.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              summary,
              messageSliceId,
              selectedModel,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  console.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages,
          env: process.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          summary,
          messageSliceId,
          selectedModel,
        });

        (async () => {
          for await (const part of result.fullStream) {
            if (part.type === 'error') {
              const error: any = part.error;
              console.error(`${error}`);

              return;
            }
          }
        })();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error: any) => {
        console.log('Error /chat:', error);

        return `Custom error: ${error.message}`

      },
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "<div class=\\"__boltThought__\\">"\n`));
            }

            if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string' && chunk.startsWith('g')) {
            let content = chunk.split(':').slice(1).join(':');

            if (content.endsWith('\n')) {
              content = content.slice(0, content.length - 1);
            }

            transformedChunk = `0:${content}\n`;
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    console.error("Unhandled error in /chat API route:", error);
    console.error("Error stack:", error.stack);

    if (error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(error.message || 'Internal Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
