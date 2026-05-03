import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Wifi, WifiOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import {
  onInstallAvailabilityChange,
  promptInstall,
  isStandalone,
  subscribeToPush,
} from "@/lib/pwa";

export function InstallPrompt() {
  const [installAvailable, setInstallAvailable] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const off = onInstallAvailabilityChange(setInstallAvailable);
    const on = () => setOnline(true);
    const off2 = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off2);
    const installedHandler = () => setInstalled(true);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      off();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off2);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("CareOS installed");
      setInstalled(true);
    } else if (outcome === "unavailable") {
      toast.info(
        "Install option not available right now. Open this site in Chrome / Edge / Safari (Add to Home Screen).",
      );
    }
  };

  const handleEnableNotifications = async () => {
    const res = await subscribeToPush();
    if (res.ok) toast.success("Notifications enabled");
    else toast.error(res.reason ?? "Could not enable notifications");
  };

  return (
    <div className="fixed bottom-3 right-3 z-40 flex items-center gap-2">
      <div
        className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
          online
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/20 text-amber-700 dark:text-amber-400"
        }`}
        title={online ? "Online" : "Offline — actions are queued"}
      >
        {online ? (
          <>
            <Wifi className="h-3 w-3" /> Online
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3" /> Offline
          </>
        )}
      </div>
      {!installed && installAvailable && (
        <Button size="sm" variant="default" onClick={handleInstall}>
          <Download className="h-4 w-4 mr-1" /> Install app
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={handleEnableNotifications}>
        <BellRing className="h-4 w-4 mr-1" /> Notifications
      </Button>
    </div>
  );
}
