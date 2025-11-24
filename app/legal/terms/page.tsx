import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Terms of Service - PickMyClass',
  description: 'Terms of Service for PickMyClass',
};

export default function TermsOfServicePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col p-4 md:p-8">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">Terms of Service</CardTitle>
              <p className="text-sm text-muted-foreground">Last Updated: October 24, 2025</p>
            </CardHeader>
            <CardContent className="prose prose-zinc dark:prose-invert max-w-none space-y-6">
              <section>
                <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
                <p>
                  By accessing or using PickMyClass (the &quot;Service&quot;), you agree to be bound
                  by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms,
                  you may not use the Service.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">2. Eligibility</h2>
                <p>You must meet the following requirements to use this Service:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>You must be at least 18 years of age</li>
                  <li>You must be a resident of the United States</li>
                  <li>You must have the legal capacity to enter into this agreement</li>
                </ul>
                <p className="font-semibold text-amber-600 dark:text-amber-400">
                  This Service is available only to users located in the United States. By using
                  this Service, you represent that you are a US resident.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">3. Service Description</h2>
                <p>
                  PickMyClass provides a class availability monitoring service for Arizona State
                  University (ASU) students. The Service allows you to:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Monitor class sections for seat availability</li>
                  <li>Receive email notifications when seats become available</li>
                  <li>Receive notifications when instructors are assigned to classes</li>
                </ul>
                <p>
                  The Service operates by periodically checking ASU&apos;s class search system and
                  notifying users of changes. We do not guarantee real-time updates or the accuracy
                  of information provided by ASU&apos;s systems.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">4. User Responsibilities</h2>
                <p>You agree to:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Provide accurate and current email address</li>
                  <li>Maintain the security of your account credentials</li>
                  <li>Not use the Service for any unlawful purpose</li>
                  <li>Not attempt to interfere with or disrupt the Service</li>
                  <li>Not create multiple accounts to circumvent service limitations</li>
                  <li>Not use automated systems (bots) to interact with the Service</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">5. Service Limitations</h2>
                <p>You acknowledge and agree that:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    The Service does NOT register you for classes - it only notifies you of
                    availability
                  </li>
                  <li>
                    Notifications may be delayed and seats may fill before you receive notification
                  </li>
                  <li>
                    We check class availability periodically (approximately every hour) and cannot
                    guarantee immediate notifications
                  </li>
                  <li>The Service may be unavailable due to maintenance or technical issues</li>
                  <li>We may limit the number of classes you can monitor</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">6. No Affiliation with ASU</h2>
                <p className="font-semibold">
                  PickMyClass is an independent service and is NOT affiliated with, endorsed by, or
                  sponsored by Arizona State University. ASU trademarks and data are used for
                  informational purposes only.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">7. Intellectual Property</h2>
                <p>
                  The Service, including its code, design, and content (excluding ASU data), is
                  owned by the PickMyClass Team. You may not copy, modify, distribute, or reverse
                  engineer any part of the Service without permission.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">8. Termination</h2>
                <p>
                  We reserve the right to suspend or terminate your access to the Service at any
                  time for:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Violation of these Terms</li>
                  <li>Abusive or excessive use of the Service</li>
                  <li>Any reason at our sole discretion</li>
                </ul>
                <p>You may terminate your account at any time through the Settings page.</p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">9. Disclaimer of Warranties</h2>
                <p className="font-semibold uppercase">
                  The Service is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without
                  warranties of any kind, either express or implied.
                </p>
                <p>We do not warrant that:</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>The Service will be uninterrupted, timely, secure, or error-free</li>
                  <li>The information provided will be accurate, reliable, or correct</li>
                  <li>Any defects or errors will be corrected</li>
                  <li>The Service will meet your requirements</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">10. Limitation of Liability</h2>
                <p className="font-semibold uppercase">
                  To the maximum extent permitted by law, PickMyClass Team shall not be liable for
                  any indirect, incidental, special, consequential, or punitive damages, including
                  but not limited to:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Loss of profits, data, or use</li>
                  <li>Loss of enrollment opportunities</li>
                  <li>Missed class registrations</li>
                  <li>Any damages arising from your use of or inability to use the Service</li>
                </ul>
                <p className="font-semibold">
                  Our total liability to you for all claims shall not exceed $100 USD or the amount
                  you paid for the Service in the past 12 months, whichever is greater.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">11. Indemnification</h2>
                <p>
                  You agree to indemnify and hold harmless PickMyClass Team from any claims,
                  damages, or expenses arising from:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Your use of the Service</li>
                  <li>Your violation of these Terms</li>
                  <li>Your violation of any rights of another party</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold">12. Changes to Terms</h2>
                <p>
                  We reserve the right to modify these Terms at any time. We will notify users of
                  material changes via email or through the Service. Your continued use of the
                  Service after changes constitutes acceptance of the new Terms.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">13. Governing Law</h2>
                <p>
                  These Terms shall be governed by and construed in accordance with the laws of the
                  United States and the State of Arizona, without regard to conflict of law
                  principles. Any disputes shall be resolved in the courts of Arizona.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold">14. Contact Information</h2>
                <p>For questions about these Terms, please contact us at:</p>
                <p className="font-mono text-sm bg-muted p-3 rounded">support@pickmyclass.app</p>
              </section>

              <section className="border-t pt-6">
                <p className="text-sm text-muted-foreground">
                  By creating an account and using PickMyClass, you acknowledge that you have read,
                  understood, and agree to be bound by these Terms of Service.
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
