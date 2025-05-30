// app/api/models/route.ts
import { LLMManager } from '@/app/lib/modules/llm/manager';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const cookieStore = cookies();
    const apiKeysJson = cookieStore.get('apiKeys')?.value;
    const providerSettingsJson = cookieStore.get('providerSettings')?.value;

    const apiKeys = apiKeysJson ? JSON.parse(apiKeysJson) : {};
    const providerSettings = providerSettingsJson ? JSON.parse(providerSettingsJson) : {};

    const manager = LLMManager.getInstance();
    const modelList = await manager.updateModelList({
      apiKeys,
      providerSettings,
    });

    return NextResponse.json({ modelList });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
