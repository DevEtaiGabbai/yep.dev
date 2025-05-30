import { RegisterForm } from "@/components/auth/RegisterForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register",
  description: "Create a new account",
};

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8 bg-[#101012]">
      <div className="mx-auto w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-black p-6 shadow-lg dark:border-gray-800 dark:bg-gray-950">
        <RegisterForm />
      </div>
    </div>
  );
}
