import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle
              cx="16"
              cy="16"
              r="12"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
            <path
              d="M12 12l8 8M20 12l-8 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold font-mono text-foreground mb-2">
          404
        </h1>
        <p className="text-sm text-muted mb-1">Page not found</p>
        <p className="text-xs text-muted/70 mb-6 max-w-xs">
          The page you are looking for does not exist or may have been moved.
        </p>
        <Link
          href="/"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
