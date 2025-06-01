"use client";

import { useSession } from "next-auth/react";
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function HomePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Set new height based on content (with a min of 44px)
    const newHeight = Math.max(44, Math.min(textarea.scrollHeight, 250));
    textarea.style.height = `${newHeight}px`;
  }, [prompt]);

  useEffect(() => {
    if (status === "loading") return;

    if (session) {
      router.push("/chat");

    } else {
      router.push("/login");
    }

  }, [session, status, router]);

  // Show a loading state while checking authentication
  return (

    <div className="flex min-h-screen items-center justify-center p-4 md:p-8 bg-[#101012]">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Yep Chat Bot</h1>
        <p className="text-gray-500">Checking authentication...</p>
      </div>
    </div>
  );
}
