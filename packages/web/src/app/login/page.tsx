import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in | AgentOps",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return <LoginPageInner searchParams={searchParams} />;
}

async function LoginPageInner({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">AgentOps</h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
