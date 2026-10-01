import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaj Command Center",
  description: "One dashboard for every repo, host, database, inbox and website across the business.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
