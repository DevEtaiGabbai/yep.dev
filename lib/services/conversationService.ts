import { db as prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface Conversation {
  id: string;
  title?: string;
  messages: Message[];
  projectId?: string;
  userId: string;
  templateName?: string;
  sendFirst: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function createConversation(
  userId: string, 
  title?: string, 
  projectId?: string,
  templateName?: string,
  sendFirst: boolean = false,
  initialMessage?: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
): Promise<Conversation> {
  const conversation = await prisma.conversation.create({
    data: {
      id: uuidv4(),
      title: title || 'New Chat',
      userId,
      projectId,
      templateName,
      sendFirst,
      messages: initialMessage ? {
        create: {
          id: uuidv4(),
          role: 'user',
          content: typeof initialMessage === 'string' 
            ? initialMessage 
            : JSON.stringify(initialMessage)
        }
      } : undefined
    } as any, // Type assertion while IDE catches up with new Prisma types
    include: {
      messages: true,
    },
  });

  return {
    id: conversation.id,
    title: conversation.title || undefined,
    messages: conversation.messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    })),
    projectId: conversation.projectId || undefined,
    userId: conversation.userId,
    templateName: (conversation as any).templateName || undefined,
    sendFirst: (conversation as any).sendFirst || false,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    title: conversation.title || undefined,
    messages: conversation.messages.map(m => {
      let content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
      try {
        const parsed = JSON.parse(m.content);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
          content = parsed;
        } else {
          content = m.content;
        }
      } catch {
        content = m.content;
      }

      return {
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        content
      };
    }),
    projectId: conversation.projectId || undefined,
    userId: conversation.userId,
    templateName: (conversation as any).templateName || undefined,
    sendFirst: (conversation as any).sendFirst || false,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
}

export async function getUserConversations(userId: string): Promise<Conversation[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      userId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  return conversations.map(conversation => ({
    id: conversation.id,
    title: conversation.title || undefined,
    messages: conversation.messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    })),
    projectId: conversation.projectId || undefined,
    userId: conversation.userId,
    templateName: (conversation as any).templateName || undefined,
    sendFirst: (conversation as any).sendFirst || false,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  }));
}

export async function addMessage(conversationId: string, message: Omit<Message, 'id'>): Promise<Message> {
  const contentForDB = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);

  const dbMessage = await prisma.message.create({
    data: {
      id: uuidv4(),
      role: message.role,
      content: contentForDB,
      conversationId,
    },
  });

  await prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data: {
      updatedAt: new Date(),
    },
  });

  return {
    id: dbMessage.id,
    role: dbMessage.role as 'user' | 'assistant' | 'system',
    content: message.content
  };
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
  await prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data: {
      title,
      updatedAt: new Date(),
    },
  });
}

export async function updateConversationProject(conversationId: string, projectId: string): Promise<void> {
  await prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data: {
      projectId,
      updatedAt: new Date(),
    },
  });
}
