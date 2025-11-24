import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export const metadata = {
  title: 'Legal - PickMyClass',
  description: 'Legal documents and policies for PickMyClass',
};

export default function LegalPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col p-4 md:p-8">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Legal Documents</h1>
            <p className="text-muted-foreground mt-1">Our policies and legal information</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Link href="/legal/terms">
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle>Terms of Service</CardTitle>
                  <CardDescription>Our terms and conditions for using PickMyClass</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Learn about your rights and responsibilities, service limitations, eligibility
                    requirements (18+, US-only), and our liability disclaimers.
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-3 font-medium">
                    Read Terms →
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/legal/privacy">
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle>Privacy Policy</CardTitle>
                  <CardDescription>How we handle your personal information</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Understand what data we collect, how we use it, your CCPA rights (California
                    residents), cookie usage, and data retention policies.
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-3 font-medium">
                    Read Privacy Policy →
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>

          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg">Your Privacy Rights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                As a US service complying with the California Consumer Privacy Act (CCPA), you have
                the following rights:
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-2">
                <li>
                  <strong>Right to Know:</strong> Request what personal data we have collected about
                  you (available via{' '}
                  <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                    Settings
                  </Link>
                  )
                </li>
                <li>
                  <strong>Right to Delete:</strong> Request deletion of your personal information
                  (available via{' '}
                  <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                    Settings
                  </Link>
                  )
                </li>
                <li>
                  <strong>Right to Opt-Out:</strong> We do NOT sell your personal information
                </li>
              </ul>
            </CardContent>
          </Card>

          <div className="text-center text-sm text-muted-foreground border-t pt-6">
            <p>
              Questions about our legal policies?{' '}
              <a
                href="mailto:support@pickmyclass.app"
                className="text-blue-600 dark:text-blue-400 underline"
              >
                Contact us
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
