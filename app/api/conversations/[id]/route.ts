import { authOptions } from '@/lib/auth';
import { addMessage, getConversation, updateConversationTitle, updateConversationProject } from '@/lib/services/conversationService';
import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';

// Get a single conversation
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = params;
    
    // Get the conversation with all messages
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Check if the user owns this conversation
    const userId = session.user.id || session.user.email;
    if (conversation.userId !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversation' },
      { status: 500 }
    );
  }
}

// Update conversation title or link project
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const conversationId = params.id;
    const body = await request.json();
    const { title, projectId } = body;
    
    // Verify ownership first
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }
    
    if (conversation.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Handle title update
    if (title) {
      if (typeof title !== 'string') {
        return NextResponse.json(
          { error: 'Title must be a string' },
          { status: 400 }
        );
      }
      await updateConversationTitle(conversationId, title);
    }

    // Handle project linking
    if (projectId) {
      await updateConversationProject(conversationId, projectId);
    }

    // If neither title nor projectId provided
    if (!title && !projectId) {
      return NextResponse.json(
        { error: 'Title or projectId is required' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/conversations/[id]:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update conversation' },
      { status: 500 }
    );
  }
} 