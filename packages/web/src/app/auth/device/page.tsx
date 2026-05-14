import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { DeviceApprovalForm } from "./DeviceApprovalForm";

export const metadata = {
  title: "Authorize device | AgentOps",
};

export default async function DeviceAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const user = await getRequestUser();
  if (!user) {
    redirect("/login?next=/auth/device");
  }

  const params = await searchParams;
  const prefill =
    typeof params.user_code === "string" ? params.user_code.toUpperCase() : "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Authorize device</h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as <span className="text-foreground">{user.email}</span>
          </p>
        </div>
        <DeviceApprovalForm prefill={prefill} />
      </div>
    </div>
  );
}
