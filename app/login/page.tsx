import { LoginForm } from "@/components/auth/LoginForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
  description: "Login to your account",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8 bg-[#101012]">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-black p-6 shadow-lg dark:border-gray-800 dark:bg-gray-950">
        <LoginForm callbackUrl={searchParams.callbackUrl} />
      </div>
    </div>
  );
}
