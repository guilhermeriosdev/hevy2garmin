import type { Metadata, Viewport } from "next";
import { NavBar } from "@/components/nav-bar";
import { authEnabled } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { clientErrorScript } from "@/lib/visit-counter";
import { I18nProvider } from "@/components/i18n-provider";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "hevy2garmin",
  description: "Sync your Hevy workouts to Garmin Connect",
};

export const viewport: Viewport = {
  themeColor: "#0A1720",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="dark">
      <head>
        {/* Optional error reports: forwarded only when a collector is configured. */}
        <script dangerouslySetInnerHTML={{ __html: clientErrorScript(withBasePath("/api/client-error")) }} />
      </head>
      <body className="bg-base text-text min-h-screen antialiased">
        <I18nProvider locale={locale}>
          <NavBar authEnabled={authEnabled()} />
          <div className="pb-20 md:pb-0">{children}</div>
        </I18nProvider>
      </body>
    </html>
  );
}
