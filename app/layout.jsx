import "./globals.css";

export const metadata = {
  title: "Read Lens",
  description: "Local-first research helper for tweets, LinkedIn posts, and web links.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
