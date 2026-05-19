import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NIM Document Research Assistant",
  description: "Portabler RAG Assistent für dokumentenbasierte Recherche.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
