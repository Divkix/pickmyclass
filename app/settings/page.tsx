import { eq } from "drizzle-orm";
import Link from "next/link";
import { DataControls } from "@/app/settings/DataControls";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePageIdentity } from "@/lib/auth/page-session";
import { getDbFromEnv } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatAbsoluteDate } from "@/lib/utils/time-format";

export default async function SettingsPage() {
  const identity = await requirePageIdentity();

  const [account] = await getDbFromEnv()
    .select({ email: users.email, created_at: users.created_at })
    .from(users)
    .where(eq(users.id, identity.userId))
    .limit(1);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col p-4 md:p-8">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div>
            <h1 className="text-3xl font-semibold">Settings</h1>
            <p className="text-muted-foreground mt-1">Your account settings and privacy controls</p>
          </div>

          <Tabs defaultValue="account" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="privacy">Privacy</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Account Information</CardTitle>
                  <CardDescription>Your email and account details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Email Address</span>
                    <p className="text-lg font-mono">{account?.email}</p>
                  </div>

                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Account Created
                    </span>
                    <p className="text-lg">
                      {account ? formatAbsoluteDate(account.created_at) : "N/A"}
                    </p>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-2">
                      Want to change your email? This feature is coming soon.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="privacy" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Privacy & Legal</CardTitle>
                  <CardDescription>Review our policies and your rights</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-medium">Legal Documents</h3>
                    <div className="flex flex-col space-y-2">
                      <Link
                        href="/legal/terms"
                        className="text-primary hover:underline"
                        target="_blank"
                      >
                        Terms of Service →
                      </Link>
                      <Link
                        href="/legal/privacy"
                        className="text-primary hover:underline"
                        target="_blank"
                      >
                        Privacy Policy →
                      </Link>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <h3 className="font-medium mb-2">Your Privacy Rights (CCPA)</h3>
                    <p className="text-sm text-muted-foreground">
                      California residents have the right to:
                    </p>
                    <ul className="text-sm text-muted-foreground list-disc pl-5 mt-2 space-y-1">
                      <li>
                        Know what personal data we collect (use &quot;Export Data&quot; in Data tab)
                      </li>
                      <li>
                        Request deletion of your data (use &quot;Delete Account&quot; in Data tab)
                      </li>
                      <li>Opt-out of data sales (we do NOT sell your data)</li>
                    </ul>
                  </div>

                  <div className="pt-4 border-t">
                    <h3 className="font-medium mb-2">Cookies</h3>
                    <p className="text-sm text-muted-foreground">
                      See our{" "}
                      <Link
                        href="/legal/privacy#5-cookie-policy"
                        className="text-primary hover:underline"
                      >
                        Cookie Policy
                      </Link>
                      .
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Data Management</CardTitle>
                  <CardDescription>Export or delete your personal data</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <DataControls />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
