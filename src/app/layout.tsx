import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { VersionBadge } from "@/components/layout/VersionBadge";
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
  title: "Soccer Play Builder",
  description:
    "Create, animate, and share tactical patterns of play for soccer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex min-h-dvh justify-center bg-[var(--bg-base)]">
          <div className="relative flex min-h-dvh w-full max-w-[390px] flex-col bg-[var(--bg-base)] sm:border-x sm:border-slate-800">
            {children}
            <VersionBadge />
          </div>
        </div>
      </body>
    </html>
  );
}
