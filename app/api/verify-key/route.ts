import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(request: NextRequest) {
    try {
        const { apiKey } = await request.json();

        if (!apiKey || typeof apiKey !== 'string') {
            return NextResponse.json({ error: 'API key is required' }, { status: 400 });
        }

        // Test the API key with a simple request
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': request.headers.get('referer') || 'https://geminicoder.com',
                'X-Title': 'GeminiCoder',
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: 'Test message for API key verification'
                    }
                ],
                max_tokens: 1,
                temperature: 0
            }),
        });

        if (response.ok) {
            return NextResponse.json({ valid: true });
        } else {
            const errorData = await response.json().catch(() => ({}));
            return NextResponse.json({ 
                valid: false, 
                error: errorData.error?.message || 'Invalid API key' 
            });
        }
    } catch (error) {
        console.error('Error verifying API key:', error);
        return NextResponse.json({ 
            valid: false, 
            error: 'Failed to verify API key' 
        }, { status: 500 });
    }
} 