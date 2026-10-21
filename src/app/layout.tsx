import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
        <div className="relative mx-auto min-h-screen w-full max-w-[390px] bg-[var(--app-bg)] sm:border-x sm:border-slate-800">
          {children}
        </div>
      </body>
    </html>
  );
}
