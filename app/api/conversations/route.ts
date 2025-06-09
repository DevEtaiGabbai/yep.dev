// app/api/conversations/route.ts
import { authOptions } from '@/lib/auth';
import { MAX_FREE_PROJECT } from '@/lib/constants';
import { createConversation, getUserConversations } from '@/lib/services/conversationService';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const conversations = await getUserConversations(session.user.id);
    return NextResponse.json({ conversations });
  } catch (error: any) {
    console.error('Error in GET /api/conversations:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch conversations' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.user.id || session.user.email;
    const requestData = await request.json();
    const { title, initialMessage, templateName, projectId, sendFirst = true } = requestData;

    // Check subscription status and project limit for free users
    const { db } = await import('@/lib/db');
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        projects: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.isSubscribed && user.projects.length >= MAX_FREE_PROJECT) {
      return NextResponse.json(
        {
          error: 'Project limit reached',
          message: 'Free users can create up to 5 projects. Upgrade to Pro for unlimited projects.',
          requiresUpgrade: true
        },
        { status: 403 }
      );
    }

    const conversation = await createConversation(
      userId,
      title,
      projectId,
      templateName,
      sendFirst,
      initialMessage // Pass the initial message to be stored
    );

    return NextResponse.json({
      success: true,
      conversation,
      message: 'Conversation created successfully'
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { error: 'Failed to create conversation' },
      { status: 500 }
    );
  }
}
