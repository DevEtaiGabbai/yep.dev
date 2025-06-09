// app/api/enhancer/route.ts
import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const { message, model, provider, apiKeys } = await request.json();

    // Validate inputs
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Invalid or missing message' }, { status: 400 });
    }

    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'Invalid or missing model' }, { status: 400 });
    }

    if (!provider || typeof provider.name !== 'string') {
      return NextResponse.json({ error: 'Invalid or missing provider' }, { status: 400 });
    }

    // Get user's API key from client request
    const userApiKey = apiKeys?.OpenRouter;

    if (!userApiKey) {
      return NextResponse.json({
        error: 'OpenRouter API key not found. Please add your API key in settings.'
      }, { status: 401 });
    }

    // Create a ReadableStream
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userApiKey}`,
              'HTTP-Referer': request.headers.get('referer') || 'https://geminicoder.com',
              'X-Title': 'GeminiCoder',
            },
            body: JSON.stringify({
              // model: 'openai/gpt-4o-mini', // Always use this model for enhancing
              model: 'deepseek/deepseek-chat-v3-0324:free',

              temperature: 0.1,
              messages: [
                {
                  role: 'system',
                  content: 'You are a senior software principal architect, you should help the user analyse the user query and enrich it with the necessary context and constraints to make it more specific, actionable, and effective. You should also ensure that the prompt is self-contained and uses professional language. Your response should ONLY contain the enhanced prompt text. Do not include any explanations, metadata, or wrapper tags.'
                },
                {
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${typeof provider === 'string' ? provider : provider.name}]\n\n` +
                    `You are a professional prompt engineer specializing in crafting precise, effective prompts.
                    Your task is to enhance prompts by making them more specific, actionable, and effective.

                    I want you to improve the user prompt that is wrapped in \`<original_prompt>\` tags.

                    For valid prompts:
                    - Make instructions explicit and unambiguous
                    - Add relevant context and constraints
                    - Remove redundant information
                    - Maintain the core intent
                    - Ensure the prompt is self-contained
                    - Use professional language

                    For invalid or unclear prompts:
                    - Respond with clear, professional guidance
                    - Keep responses concise and actionable
                    - Maintain a helpful, constructive tone
                    - Focus on what the user should provide
                    - Use a standard template for consistency

                    IMPORTANT: Your response must ONLY contain the enhanced prompt text.
                    Do not include any explanations, metadata, or wrapper tags.

                    <original_prompt>
                      ${message}
                    </original_prompt>`
                }
              ],
              stream: true
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('Failed to get reader from response');
          }

          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (error) {
          console.error('Error in enhancer stream:', error);
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in enhancer API:', error);

    if (error instanceof Error && error.message?.includes('API key')) {
      return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
