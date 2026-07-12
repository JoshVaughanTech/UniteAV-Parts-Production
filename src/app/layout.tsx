import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unite AV — Parts & Production",
  description: "BOM ingestion, inventory, and reorder management dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
