'use client'

import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarTrigger,
    useSidebar
} from "@/components/ui/sidebar";
import { Conversation } from "@/lib/services/conversationService";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { useEffect, useState } from "react";
import { NavUser } from "./nav-user";

// This is sample data
const data = {
    user: {
        name: "shadcn",
        email: "m@example.com",
        avatar: "/avatars/shadcn.jpg",
    },
    navMain: [],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const [activeItem, setActiveItem] = React.useState(data.navMain[0]);
    const { open, setOpen } = useSidebar();
    const router = useRouter();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
    const pathname = usePathname()
    const activeId = pathname.split('/').pop()

    useEffect(() => {
        async function fetchConversations() {
            try {
                const response = await fetch('/api/conversations');

                if (!response.ok) {
                    throw new Error('Failed to fetch conversations');
                }

                const data = await response.json();
                setConversations(data.conversations || []);
            } catch (error) {
                console.error('Error fetching conversations:', error);
            } finally {
                setIsLoading(false);
            }
        }

        fetchConversations();
    }, []);

    const handleConversationClick = (conversationId: string) => {
        router.push(`/chat/${conversationId}`);

    };


    const handleHomepageClick = () => {
        router.push('/');
    };

    return (
        <Sidebar
            collapsible="icon"
            className="overflow-hidden [&>[data-sidebar=sidebar]]:flex-row"
            {...props}
        >
            <Sidebar
                collapsible="none"
                className="!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r border-[#313133] flex flex-col"
            >
                <SidebarHeader className="p-2">
                    {!open && (
                        <SidebarTrigger className="-ml-1" onClick={() => setOpen(true)} />
                    )}
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent className="px-1.5 md:px-0"></SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter>
                    <SidebarMenu>
                        {data.navMain.map((item) => (
                            <SidebarMenuItem key={item.title}>
                                <SidebarMenuButton
                                    size="lg"
                                    onClick={() => {
                                        setActiveItem(item);
                                        setOpen(true);
                                    }}
                                    isActive={activeItem?.title === item.title}
                                    className="px-2.5 md:px-2"
                                >
                                    <Link href={item.url} target="_blank">
                                        {item.icon}
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                    <NavUser user={data.user} />
                </SidebarFooter>
            </Sidebar>

            <Sidebar collapsible="none" className="hidden flex-1 md:flex">
                <SidebarHeader className="gap-3.5 border-b border-[#313133] p-4">
                    <div className="flex w-full items-center justify-between">
                        <div className="text-base font-medium text-white cursor-pointer" onClick={handleHomepageClick} >Yep dev</div>
                        {open && (
                            <SidebarTrigger className="-ml-1" onClick={() => setOpen(false)} />
                        )}
                    </div>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup className="px-0">
                        <SidebarGroupLabel className="px-4 text-gray-400">Recent Conversations</SidebarGroupLabel>
                        <ScrollArea className="h-[calc(100vh_-_120px)]">
                            <SidebarGroupContent>
                                {isLoading ? (
                                    <p className="p-4 text-sm text-gray-400">Loading conversations...</p>
                                ) : conversations.length === 0 ? (
                                    <p className="p-4 text-sm text-gray-400">No conversations found</p>
                                ) : (
                                    <SidebarMenu>
                                        {conversations.map((conversation) => (
                                            <SidebarMenuItem key={conversation.id} className="pt-0 pb-1 pl-1 pr-1">
                                                <SidebarMenuButton
                                                    onClick={() => handleConversationClick(conversation.id)}
                                                    className={
                                                        cn('justify-start flex flex-col items-start hover:bg-[#28282a] active:bg-[#28282a] active:text-white hover:text-white rounded-md p-0', {
                                                            'bg-[#28282a] rounded-md shadow-sm': activeId === conversation.id
                                                        })
                                                    }
                                                >
                                                    <div
                                                        style={{
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}
                                                        className="pl-3 pt-1.5"
                                                    >
                                                        {conversation.title || 'Untitled Chat'}
                                                    </div>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                )}
                            </SidebarGroupContent>
                        </ScrollArea>
                    </SidebarGroup>
                </SidebarContent>
            </Sidebar>
        </Sidebar>
    );
}
