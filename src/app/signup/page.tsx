import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout, SignupForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthLayout>
  );
}
