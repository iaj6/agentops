import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { ToastContainer } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KeyboardProvider } from "@/components/KeyboardProvider";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AgentOps",
    template: "%s | AgentOps",
  },
  description: "Mission control for autonomous agent runs",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <KeyboardProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto animate-in">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </div>
          <ToastContainer />
          <GlobalCommandPalette />
        </KeyboardProvider>
      </body>
    </html>
  );
}
