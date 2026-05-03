import { useAuth } from "@/lib/auth";
import { 
  useListNotificationTypes, 
  useListMyNotificationPreferences, 
  useUpdateMyNotificationPreferences,
  getListMyNotificationPreferencesQueryKey,
  type NotificationChannel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bell, Smartphone, Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: types, isLoading: loadingTypes } = useListNotificationTypes();
  const { data: prefs, isLoading: loadingPrefs } = useListMyNotificationPreferences(
    { query: { enabled: !!auth } as any }
  );

  const updatePref = useUpdateMyNotificationPreferences();

  const familyTypes = types?.filter(t => t.audienceRoles.includes("FAMILY")) || [];

  const handleToggle = (typeId: string, currentEnabled: boolean, defaultChannels: NotificationChannel[]) => {
    updatePref.mutate(
      {
        data: [
          {
            notificationTypeId: typeId,
            enabled: !currentEnabled,
            channels: defaultChannels,
          },
        ],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyNotificationPreferencesQueryKey() });
          toast({ title: "Preferences updated", description: "Your notification settings have been saved." });
        }
      }
    );
  };

  if (loadingTypes || loadingPrefs) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto w-full space-y-6">
        <Skeleton className="h-8 w-48 mb-8" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-medium text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your notification preferences.</p>
      </div>

      <div className="space-y-6">
        <Card className="border-none shadow-md">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5 text-muted-foreground" />
              Notifications
            </CardTitle>
            <CardDescription>Choose what updates you want to receive about care visits.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {familyTypes.map((type) => {
                const pref = prefs?.find(p => p.notificationTypeId === type.id);
                const isEnabled = pref ? pref.enabled : true; // Assuming default true if not set

                return (
                  <li key={type.id} className="p-6 flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor={`toggle-${type.id}`} className="text-base font-medium text-foreground cursor-pointer">
                        {type.label}
                      </Label>
                      {type.description && (
                        <p className="text-sm text-muted-foreground mt-1 max-w-md">
                          {type.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3">
                        {type.defaultChannels.includes("EMAIL") && <Mail className="w-4 h-4 text-muted-foreground" />}
                        {type.defaultChannels.includes("SMS") && <Smartphone className="w-4 h-4 text-muted-foreground" />}
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Via {type.defaultChannels.join(", ").toLowerCase()}
                        </span>
                      </div>
                    </div>
                    <Switch 
                      id={`toggle-${type.id}`}
                      checked={isEnabled}
                      disabled={updatePref.isPending}
                      onCheckedChange={() => handleToggle(type.id, isEnabled, type.defaultChannels)}
                    />
                  </li>
                );
              })}
            </ul>
            {familyTypes.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No notification types available for your role.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
