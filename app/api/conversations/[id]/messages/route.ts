import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  addMessage,
  getConversation,
} from "@/lib/services/conversationService";

// Add a new message to a conversation
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = params;
    const requestData = await request.json();
    const { role, content } = requestData;

    // Validate the conversation exists and belongs to the user
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Verify user owns this conversation
    const userId = session.user.id || session.user.email;
    if (conversation.userId !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Add the message
    const message = await addMessage(id, { role, content });
    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Error adding message to conversation:", error);
    return NextResponse.json(
      { error: "Failed to add message" },
      { status: 500 }
    );
  }
}
