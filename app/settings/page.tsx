'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const [user, setUser] = useState<{ email?: string; created_at?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.push('/login');
        return;
      }

      setUser(user);
      setLoading(false);
    };

    checkUser();
  }, [router]);

  const handleExportData = async () => {
    setExportLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/export', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pickmyclass-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setMessage({ type: 'success', text: 'Data exported successfully!' });
    } catch (error) {
      console.error('Export error:', error);
      setMessage({ type: 'error', text: 'Failed to export data. Please try again.' });
    } finally {
      setExportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 flex-col p-4 md:p-8">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground mt-1">Manage your account, privacy, and data</p>
          </div>

          {message && (
            <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

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
                    <label className="text-sm font-medium text-muted-foreground">
                      Email Address
                    </label>
                    <p className="text-lg font-mono">{user?.email}</p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Account Created
                    </label>
                    <p className="text-lg">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
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
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        target="_blank"
                      >
                        Terms of Service →
                      </Link>
                      <Link
                        href="/legal/privacy"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
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
                      We only use essential cookies for authentication. No tracking or analytics
                      cookies. See our{' '}
                      <Link
                        href="/legal/privacy#5-cookie-policy"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
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
                  <div>
                    <h3 className="font-medium mb-2">Export Your Data</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Download all your personal data in JSON format. Includes your account info,
                      class watches, and notification history.
                    </p>
                    <Button onClick={handleExportData} disabled={exportLoading} variant="outline">
                      {exportLoading ? 'Exporting...' : 'Export Data (JSON)'}
                    </Button>
                  </div>

                  <div className="pt-6 border-t border-destructive/20">
                    <h3 className="font-medium text-destructive mb-2">Danger Zone</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Deleting your account will:
                    </p>
                    <ul className="text-sm text-muted-foreground list-disc pl-5 mb-4 space-y-1">
                      <li>Immediately disable your account and sign you out</li>
                      <li>Stop all class monitoring and notifications</li>
                      <li>Retain data for 30 days (business records)</li>
                      <li>Permanently delete all data after 30 days</li>
                    </ul>
                    <Button onClick={() => setShowDeleteModal(true)} variant="destructive">
                      Delete Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DeleteAccountModal open={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </div>
  );
}
