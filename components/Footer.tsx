import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex flex-col items-center gap-4 md:flex-row md:gap-6">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} PickMyClass - US Only Service
            </p>
            <div className="flex items-center gap-4 text-sm">
              <Link
                href="/legal/terms"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Terms of Service
              </Link>
              <span className="text-muted-foreground/50">•</span>
              <Link
                href="/legal/privacy"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center md:text-right">
            Not affiliated with Arizona State University
          </p>
        </div>
      </div>
    </footer>
  )
}
