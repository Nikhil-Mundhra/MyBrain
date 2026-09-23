import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subject 0960 | Brain MRI Viewer",
  description: "Interactive structural brain MRI viewer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
