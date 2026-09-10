import type { ReactNode } from "react";

// The App Router needs a root layout. This service has no UI of its own —
// the admin panel lives in ../esthetics-frontend and talks to /api/admin/*.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
