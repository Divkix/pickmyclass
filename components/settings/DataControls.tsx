import { useState } from "react";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorFields, log } from "@/lib/log";
import { trackBrowserAction } from "@/lib/telemetry/browser";

/** The settings Data tab's export and delete actions. */
export function DataControls() {
  const [exportLoading, setExportLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleExportData = async () => {
    setExportLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/user/export", {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pickmyclass-data-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      trackBrowserAction("data_exported", {});
      setMessage({ type: "success", text: "Data exported successfully!" });
    } catch (error) {
      log("Settings").error("Data export failed", errorFields(error));
      setMessage({ type: "error", text: "Failed to export data. Please try again." });
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <>
      {message && (
        <Alert
          variant={message.type === "error" ? "destructive" : "default"}
          role={message.type === "error" ? "alert" : "status"}
        >
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div>
        <h3 className="font-medium mb-2">Export Your Data</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Download all your personal data in JSON format. Includes your account info, class watches,
          and notification history.
        </p>
        <Button onClick={handleExportData} disabled={exportLoading} variant="outline">
          {exportLoading ? "Exporting..." : "Export Data (JSON)"}
        </Button>
      </div>

      <div className="pt-6 border-t border-destructive/20">
        <h3 className="font-medium text-destructive mb-2">Danger Zone</h3>
        <p className="text-sm text-muted-foreground mb-4">Deleting your account will:</p>
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

      <DeleteAccountModal open={showDeleteModal} onOpenChange={setShowDeleteModal} />
    </>
  );
}
