import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { getRequestUser } from "@/lib/auth";

export const metadata = {
  title: "Change password | AgentOps",
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Use header-less call (cookie auth only). headers() is required by
  // Next 16 dynamic API contract; we just call it to opt into dynamic.
  await headers();
  const user = await getRequestUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Change password</h1>
          <p className="mt-1 text-sm text-muted">
            {user.mustChangePassword
              ? "Please set a new password to continue."
              : "Update your password."}
          </p>
        </div>
        <ChangePasswordForm next={next} forced={user.mustChangePassword} />
      </div>
    </div>
  );
}
