import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LEGAL_SITE_NAME, PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH } from "@/lib/siteLegal";
import syncpediaLogo from "@/assets/syncpedia-logo.webp";

export default function LegalPageLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/login" className="flex items-center gap-3">
            <img src={syncpediaLogo} alt={LEGAL_SITE_NAME} className="h-8 object-contain" width={128} height={32} />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to={PRIVACY_POLICY_PATH} className="hover:text-foreground">
              Privacy
            </Link>
            <Link to={TERMS_OF_SERVICE_PATH} className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-a:text-primary">
          {children}
        </article>
      </main>

      <footer className="border-t bg-background py-6 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} {LEGAL_SITE_NAME}. All rights reserved.</p>
        <p className="mt-2">
          <Link to={PRIVACY_POLICY_PATH} className="hover:underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link to={TERMS_OF_SERVICE_PATH} className="hover:underline">
            Terms of Service
          </Link>
        </p>
      </footer>
    </div>
  );
}
