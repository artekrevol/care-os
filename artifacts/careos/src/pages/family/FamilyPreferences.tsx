import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListNotificationTypes,
  useListMyNotificationPreferences,
  useUpdateMyNotificationPreferences,
  getListMyNotificationPreferencesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { FamilyLayout, loadFamilyUser, type FamilyUser } from "./FamilyLayout";

type Channel = "EMAIL" | "SMS" | "PUSH" | "IN_APP";
const ALL_CHANNELS: Channel[] = ["EMAIL", "SMS", "PUSH", "IN_APP"];

type PrefDraft = {
  notificationTypeId: string;
  enabled: boolean;
  channels: Channel[];
};

export default function FamilyPreferences() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PrefDraft>>({});
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const u = loadFamilyUser();
    if (!u) {
      navigate("/family/login");
      return;
    }
    setUser(u);
  }, [navigate]);

  const headers = useMemo<Record<string, string>>(
    () =>
      user
        ? { "x-family-user-id": user.id, "x-user-role": "FAMILY" }
        : ({} as Record<string, string>),
    [user],
  );

  const { data: types, isLoading: typesLoading } = useListNotificationTypes();
  const { data: prefs, isLoading: prefsLoading } = useListMyNotificationPreferences({
    query: { enabled: !!user } as never,
    request: { headers },
  });
  const update = useUpdateMyNotificationPreferences({ request: { headers } });

  const familyTypes = useMemo(
    () => (types ?? []).filter((t) => (t.audienceRoles ?? []).includes("FAMILY")),
    [types],
  );

  useEffect(() => {
    if (!familyTypes.length) return;
    const next: Record<string, PrefDraft> = {};
    for (const t of familyTypes) {
      const existing = prefs?.find((p) => p.notificationTypeId === t.id);
      next[t.id] = {
        notificationTypeId: t.id,
        enabled: existing?.enabled ?? true,
        channels: (existing?.channels as Channel[]) ?? (t.defaultChannels as Channel[]),
      };
    }
    setDrafts(next);
  }, [familyTypes, prefs]);

  function toggleEnabled(id: string, v: boolean) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], enabled: v } }));
    setSaved(false);
  }
  function toggleChannel(id: string, ch: Channel) {
    setDrafts((d) => {
      const cur = d[id];
      const has = cur.channels.includes(ch);
      return {
        ...d,
        [id]: {
          ...cur,
          channels: has ? cur.channels.filter((c) => c !== ch) : [...cur.channels, ch],
        },
      };
    });
    setSaved(false);
  }

  async function save() {
    if (!user) return;
    const items = Object.values(drafts).map((d) => ({
      notificationTypeId: d.notificationTypeId,
      enabled: d.enabled,
      channels: d.channels,
    }));
    await update.mutateAsync({ data: items });
    queryClient.invalidateQueries({ queryKey: getListMyNotificationPreferencesQueryKey() });
    setSaved(true);
  }

  if (!user) return null;

  return (
    <FamilyLayout user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Notification preferences</h1>
          <p className="text-muted-foreground text-sm">
            Choose how you'd like to hear from the agency.
          </p>
        </div>

        {typesLoading || prefsLoading ? (
          <Skeleton className="h-64 rounded-lg" />
        ) : familyTypes.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No family notification types are available.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {familyTypes.map((t) => {
              const d = drafts[t.id];
              if (!d) return null;
              return (
                <Card key={t.id} data-testid={`pref-card-${t.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{t.label}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                      </div>
                      <Switch
                        checked={d.enabled}
                        onCheckedChange={(v) => toggleEnabled(t.id, v)}
                        data-testid={`switch-enabled-${t.id}`}
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {ALL_CHANNELS.map((ch) => {
                        const active = d.channels.includes(ch);
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => toggleChannel(t.id, ch)}
                            disabled={!d.enabled}
                            data-testid={`channel-${t.id}-${ch}`}
                            className={`text-xs rounded-full px-3 py-1 border transition ${
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground"
                            } ${!d.enabled ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            {ch}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={update.isPending} data-testid="button-save-preferences">
            {update.isPending ? "Saving…" : "Save preferences"}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </div>
    </FamilyLayout>
  );
}
