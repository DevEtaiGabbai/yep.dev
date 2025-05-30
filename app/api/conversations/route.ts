// app/api/conversations/route.ts
import { authOptions } from '@/lib/auth';
import { addMessage, createConversation, getUserConversations } from '@/lib/services/conversationService';
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
    const { title, initialMessage, templateName, projectId } = requestData;

    const conversation = await createConversation(userId, title, projectId);

    // If there's an initial message, add it to the conversation
    if (initialMessage) {
      try {
        await addMessage(conversation.id, {
          role: 'user',
          content: initialMessage,
        });
      } catch (messageError) {
        console.error("POST /api/conversations: Error adding initial message:", messageError);
        // Continue even if message add fails - the conversation was created
      }
    }

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
