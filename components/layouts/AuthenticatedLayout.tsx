"use client";

import { AppSidebar } from "@/app/components/sidebar/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8 bg-[#101012]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-white">Yep Chat Bot</h1>
          <p className="text-gray-500">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "22rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="flex-1 h-screen overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
