import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - PickMyClass',
  description: 'Privacy Policy for PickMyClass',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col p-4 md:p-8">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">Privacy Policy</CardTitle>
              <p className="text-sm text-muted-foreground">Last Updated: October 24, 2025</p>
            </CardHeader>
            <CardContent className="prose prose-zinc dark:prose-invert max-w-none space-y-6">
              <section>
                <h2 className="text-xl font-semibold">1. Introduction</h2>
                <p>
                  PickMyClass (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to
                  protecting your privacy. This Privacy Policy explains how we collect, use,
                  disclose, and safeguard your personal information when you use our Service.
                </p>
                <p className="font-semibold text-blue-600 dark:text-blue-400">
                  This Service is available only to users in the United States. This policy complies
                  with US federal laws and the California Consumer Privacy Act (CCPA).
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">2. Information We Collect</h2>

                <h3 className="text-lg font-semibold mt-4">2.1 Personal Information You Provide</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Email Address:</strong> Required for account creation and sending
                    notifications
                  </li>
                  <li>
                    <strong>Password:</strong> Stored securely using industry-standard encryption
                    (handled by Supabase Auth)
                  </li>
                  <li>
                    <strong>Class Preferences:</strong> The class sections you choose to monitor
                    (term, subject, catalog number, section number)
                  </li>
                  <li>
                    <strong>Age Verification:</strong> Confirmation that you are 18 years or older
                  </li>
                </ul>

                <h3 className="text-lg font-semibold mt-4">
                  2.2 Automatically Collected Information
                </h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Usage Data:</strong> Timestamps of when you add/remove class watches,
                    when notifications are sent
                  </li>
                  <li>
                    <strong>Session Data:</strong> Authentication session information stored in
                    cookies
                  </li>
                  <li>
                    <strong>Technical Data:</strong> IP address (for security purposes only, not
                    stored long-term)
                  </li>
                </ul>

                <h3 className="text-lg font-semibold mt-4">2.3 Information We Do NOT Collect</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>We do NOT collect your real name, phone number, or physical address</li>
                  <li>We do NOT use tracking pixels or analytics cookies</li>
                  <li>
                    We do NOT sell, rent, or share your data with third parties for marketing
                    purposes
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
                <p>We use your information only for the following purposes:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Provide the Service:</strong> Monitor class availability and send you
                    email notifications
                  </li>
                  <li>
                    <strong>Account Management:</strong> Authenticate your login, manage your
                    account settings
                  </li>
                  <li>
                    <strong>Service Improvements:</strong> Understand usage patterns to improve
                    reliability (aggregated data only)
                  </li>
                  <li>
                    <strong>Security:</strong> Detect and prevent abuse, fraud, or unauthorized
                    access
                  </li>
                  <li>
                    <strong>Legal Compliance:</strong> Respond to legal requests or enforce our
                    Terms of Service
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">4. How We Share Your Information</h2>
                <p>
                  We do NOT sell your personal information. We may share your information only in
                  these limited circumstances:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Service Providers:</strong> We use third-party services to operate:
                    <ul className="list-circle pl-6 mt-2 space-y-1">
                      <li>
                        Supabase (database and authentication) - see{' '}
                        <a
                          href="https://supabase.com/privacy"
                          className="text-blue-600 dark:text-blue-400 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          their privacy policy
                        </a>
                      </li>
                      <li>
                        Resend (email delivery) - see{' '}
                        <a
                          href="https://resend.com/legal/privacy-policy"
                          className="text-blue-600 dark:text-blue-400 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          their privacy policy
                        </a>
                      </li>
                      <li>
                        Cloudflare Workers (hosting) - see{' '}
                        <a
                          href="https://www.cloudflare.com/privacypolicy/"
                          className="text-blue-600 dark:text-blue-400 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          their privacy policy
                        </a>
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Legal Requirements:</strong> If required by law, court order, or
                    government request
                  </li>
                  <li>
                    <strong>Business Transfers:</strong> If the Service is acquired or merged (you
                    will be notified)
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">5. Cookie Policy</h2>
                <p>
                  We use cookies only for essential functionality. By using our Service, you consent
                  to the use of these cookies.
                </p>

                <h3 className="text-lg font-semibold mt-4">5.1 Essential Cookies</h3>
                <table className="min-w-full border border-border mt-2">
                  <thead className="bg-muted">
                    <tr>
                      <th className="border border-border px-4 py-2 text-left">Cookie Name</th>
                      <th className="border border-border px-4 py-2 text-left">Purpose</th>
                      <th className="border border-border px-4 py-2 text-left">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-border px-4 py-2 font-mono text-sm">
                        sb-*-auth-token
                      </td>
                      <td className="border border-border px-4 py-2">
                        Supabase authentication session
                      </td>
                      <td className="border border-border px-4 py-2">7 days (session)</td>
                    </tr>
                  </tbody>
                </table>

                <h3 className="text-lg font-semibold mt-4">5.2 Cookie Characteristics</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>HttpOnly:</strong> Yes (prevents JavaScript access for security)
                  </li>
                  <li>
                    <strong>Secure:</strong> Yes (transmitted only over HTTPS)
                  </li>
                  <li>
                    <strong>SameSite:</strong> Lax (prevents cross-site request forgery)
                  </li>
                </ul>

                <h3 className="text-lg font-semibold mt-4">5.3 What We Do NOT Use</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>No analytics cookies (Google Analytics, etc.)</li>
                  <li>No advertising cookies</li>
                  <li>No third-party tracking pixels</li>
                  <li>No social media cookies</li>
                </ul>

                <p className="mt-4">
                  <strong>How to Disable Cookies:</strong> You can configure your browser to refuse
                  all cookies or alert you when cookies are sent. However, disabling cookies will
                  prevent you from logging in and using the Service.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">6. Data Retention and Deletion</h2>

                <h3 className="text-lg font-semibold mt-4">6.1 How Long We Keep Your Data</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Account Data:</strong> Until you delete your account
                  </li>
                  <li>
                    <strong>Class Watches:</strong> Until you remove them or delete your account
                  </li>
                  <li>
                    <strong>Notification History:</strong> Kept for 1 year, then automatically
                    deleted
                  </li>
                  <li>
                    <strong>Disabled Accounts:</strong> Account disabled immediately upon request;
                    data retained for 30 days for business records, then permanently deleted
                  </li>
                </ul>

                <h3 className="text-lg font-semibold mt-4">6.2 Automatic Data Cleanup</h3>
                <p>We automatically delete old data to minimize retention:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    Class state history older than 6 months (for sections with no active watchers)
                  </li>
                  <li>Notification records older than 1 year</li>
                  <li>Disabled accounts older than 30 days</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">
                  7. Your Rights (California Residents - CCPA)
                </h2>
                <p className="font-semibold">
                  If you are a California resident, you have the following rights under the
                  California Consumer Privacy Act (CCPA):
                </p>

                <h3 className="text-lg font-semibold mt-4">7.1 Right to Know</h3>
                <p>
                  You have the right to request what personal information we have collected about
                  you in the past 12 months. Use the &quot;Export Data&quot; button in your{' '}
                  <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                    Settings
                  </Link>{' '}
                  page.
                </p>

                <h3 className="text-lg font-semibold mt-4">7.2 Right to Delete</h3>
                <p>
                  You have the right to request deletion of your personal information. Use the
                  &quot;Delete Account&quot; button in your{' '}
                  <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                    Settings
                  </Link>{' '}
                  page.
                </p>
                <p className="text-sm text-muted-foreground">
                  Note: We may retain certain information if required by law or necessary for
                  legitimate business purposes (e.g., fraud prevention, security).
                </p>

                <h3 className="text-lg font-semibold mt-4">7.3 Right to Opt-Out of Sale</h3>
                <p className="font-semibold text-green-600 dark:text-green-400">
                  We do NOT sell your personal information, so there is nothing to opt out of.
                </p>

                <h3 className="text-lg font-semibold mt-4">7.4 Right to Non-Discrimination</h3>
                <p>We will not discriminate against you for exercising any of your CCPA rights.</p>

                <h3 className="text-lg font-semibold mt-4">7.5 How to Exercise Your Rights</h3>
                <p>You can exercise your rights by:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    Using the self-service tools in your{' '}
                    <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                      Settings
                    </Link>{' '}
                    page (fastest)
                  </li>
                  <li>
                    Emailing us at:{' '}
                    <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
                      support@pickmyclass.app
                    </span>
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground mt-2">
                  We will respond to verified requests within 45 days.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">8. Data Security</h2>
                <p>We implement industry-standard security measures to protect your information:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Encryption:</strong> All data transmitted over HTTPS (TLS 1.3)
                  </li>
                  <li>
                    <strong>Password Storage:</strong> Passwords are hashed using bcrypt (handled by
                    Supabase)
                  </li>
                  <li>
                    <strong>Database Security:</strong> Row Level Security (RLS) policies prevent
                    unauthorized access
                  </li>
                  <li>
                    <strong>Access Control:</strong> Minimal employee access; service accounts use
                    least-privilege principle
                  </li>
                </ul>
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                  However, no method of transmission or storage is 100% secure. We cannot guarantee
                  absolute security.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">9. Children&apos;s Privacy</h2>
                <p className="font-semibold">
                  Our Service is NOT intended for users under 18 years of age. We do not knowingly
                  collect information from children under 18.
                </p>
                <p>
                  If you are a parent or guardian and believe your child has provided us with
                  personal information, please contact us at
                  <span className="font-mono text-sm bg-muted px-2 py-1 rounded ml-1">
                    support@pickmyclass.app
                  </span>{' '}
                  and we will delete it.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">10. Changes to This Privacy Policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. We will notify you of
                  material changes by:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    Posting the new Privacy Policy on this page with an updated &quot;Last
                    Updated&quot; date
                  </li>
                  <li>Sending an email notification to your registered email address</li>
                </ul>
                <p>
                  Your continued use of the Service after changes constitutes acceptance of the
                  updated Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">11. Contact Us</h2>
                <p>
                  If you have questions about this Privacy Policy or want to exercise your privacy
                  rights, contact us at:
                </p>
                <div className="bg-muted p-4 rounded space-y-2 mt-2">
                  <p>
                    <strong>Support & Legal Inquiries:</strong>{' '}
                    <span className="font-mono text-sm">support@pickmyclass.app</span>
                  </p>
                  <p>
                    <strong>Response Time:</strong> Within 45 days for CCPA requests
                  </p>
                </div>
              </section>

              <section className="border-t pt-6">
                <p className="text-sm text-muted-foreground">
                  By using PickMyClass, you acknowledge that you have read and understood this
                  Privacy Policy and agree to the collection, use, and disclosure of your
                  information as described.
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
