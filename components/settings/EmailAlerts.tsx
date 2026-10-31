/** Global email-alert switch: optimistic while saving, then use the refreshed Settings loader. */
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { errorFields, log } from "@/lib/log";

interface EmailAlertsProps {
  notificationsEnabled: boolean;
  deliveryBlocked: boolean;
}

export function EmailAlerts({ notificationsEnabled, deliveryBlocked }: EmailAlertsProps) {
  const router = useRouter();
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled = pendingEnabled ?? notificationsEnabled;
  const saving = pendingEnabled !== null;

  const handleToggle = async () => {
    setPendingEnabled(!enabled);
    setError(null);

    try {
      const response = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications_enabled: !enabled }),
      });

      if (!response.ok) throw new Error("Failed to update email alert preference");

      await router.invalidate({ sync: true });
    } catch (cause) {
      log("Settings").error("Failed to update email alert preference", errorFields(cause));
      setError("Could not save your email alert preference. Please try again.");
    } finally {
      // Clearing the optimistic value also rolls back to the loaded preference on failure.
      setPendingEnabled(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email alerts</CardTitle>
        <CardDescription>
          Pause or resume email alerts for all your watched classes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="email-alerts-enabled">Email me when a watched class changes</Label>
          <button
            id="email-alerts-enabled"
            type="button"
            role="switch"
            aria-label="Email me when a watched class changes"
            aria-checked={enabled}
            aria-busy={saving}
            disabled={saving}
            onClick={handleToggle}
            className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? "bg-primary" : "bg-input"}`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none block size-5 rounded-full bg-background shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
            />
          </button>
        </div>
        {deliveryBlocked && (
          <p className="text-sm text-muted-foreground">
            Alerts cannot be delivered to this email address because a message bounced or was marked
            as spam.
          </p>
        )}
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
