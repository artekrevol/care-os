import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Send, Users } from "lucide-react";
import { api, type Me } from "@/lib/api";
import OfflineBanner from "@/components/OfflineBanner";
import BottomNav from "@/components/BottomNav";

type ThreadSummary = {
  id: string;
  clientId: string | null;
  caregiverId: string | null;
  topic: string;
  subject: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  participants: Array<{ userId: string; role: string; name: string }>;
  clientName?: string | null;
};

type Message = {
  id: string;
  threadId: string;
  authorId: string;
  authorRole: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Props = { me: Me };

export default function Messages({ me }: Props) {
  const [matchThread, params] = useRoute<{ id: string }>("/messages/:id");
  if (matchThread && params) {
    return <ThreadView me={me} threadId={params.id} />;
  }
  return <ThreadList me={me} />;
}

function ThreadList({ me: _me }: { me: Me }) {
  const threads = useQuery({
    queryKey: ["m", "threads"],
    queryFn: () => api<{ threads: ThreadSummary[] }>("/m/threads"),
    refetchInterval: 30_000,
  });
  return (
    <div className="min-h-screen flex flex-col">
      <header className="safe-top px-5 pb-3 sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <h1 className="text-xl font-bold pt-2">Messages</h1>
        <p className="text-xs text-[color:var(--color-muted)] flex items-center gap-1">
          <Users className="w-3 h-3" /> With your care coordinator only
        </p>
      </header>
      <OfflineBanner />
      <main className="flex-1 px-5 py-4 space-y-2 max-w-md mx-auto w-full">
        {threads.isLoading && (
          <div className="h-16 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />
        )}
        {!threads.isLoading && (threads.data?.threads ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted)]">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-50" />
            No conversations yet. Threads open up automatically when you start a
            visit, or your coordinator messages you.
          </div>
        )}
        {threads.data?.threads.map((t) => (
          <Link key={t.id} href={`/messages/${t.id}`}>
            <a className="block rounded-xl bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-3 active:scale-[0.99] transition">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold truncate">
                  {t.clientName
                    ? `${t.clientName}`
                    : t.subject ?? t.topic ?? "Conversation"}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 shrink-0">
                  {t.topic}
                </span>
              </div>
              <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                {t.lastMessageAt
                  ? format(parseISO(t.lastMessageAt), "MMM d, h:mm a")
                  : format(parseISO(t.createdAt), "MMM d, h:mm a")}
              </div>
            </a>
          </Link>
        ))}
      </main>
      <BottomNav />
    </div>
  );
}

function ThreadView({ me, threadId }: { me: Me; threadId: string }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [realtime, setRealtime] = useState<"polling" | "live">("polling");
  const messages = useQuery({
    queryKey: ["m", "thread", threadId],
    queryFn: () =>
      api<{ thread: ThreadSummary; messages: Message[] }>(
        `/m/threads/${threadId}/messages`,
      ),
    // Poll as a fallback only — when Pusher is configured we drop to a slower
    // resilience interval to handle reconnects after dropped sockets.
    refetchInterval: realtime === "live" ? 60_000 : 15_000,
  });

  // Real-time message delivery via Pusher when the server has it configured;
  // gracefully falls back to polling when getClientCredentials() returns null
  // (dev) or the dynamic import fails.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const r = await api<{
          credentials: { key: string; cluster: string } | null;
          authEndpoint: string | null;
        }>("/m/realtime/credentials");
        if (cancelled || !r.credentials || !r.authEndpoint) return;
        const PusherMod = await import("pusher-js");
        const Pusher = PusherMod.default;
        // Use a private channel: Pusher will POST to authEndpoint, where the
        // server verifies thread membership before signing. Without a valid
        // signature the broker rejects the subscription, so a caregiver
        // cannot read another thread's payloads even if they guess the id.
        const client = new Pusher(r.credentials.key, {
          cluster: r.credentials.cluster,
          authEndpoint: r.authEndpoint,
        });
        const channelName = `private-thread-${threadId}`;
        const ch = client.subscribe(channelName);
        const onCreated = () => {
          void qc.invalidateQueries({ queryKey: ["m", "thread", threadId] });
          void qc.invalidateQueries({ queryKey: ["m", "threads"] });
        };
        ch.bind("message.created", onCreated);
        ch.bind("pusher:subscription_succeeded", () => {
          if (!cancelled) setRealtime("live");
        });
        cleanup = () => {
          ch.unbind("message.created", onCreated);
          client.unsubscribe(channelName);
          client.disconnect();
        };
      } catch {
        /* offline / pusher unavailable — polling fallback continues */
      }
    })();
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [threadId, qc]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await api(`/m/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setBody("");
      await qc.invalidateQueries({ queryKey: ["m", "thread", threadId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  }

  const t = messages.data?.thread;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="safe-top px-4 pb-3 sticky top-0 z-10 bg-[color:var(--color-bg)]/95 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => setLocation("/messages")}
            className="p-2 -ml-2 rounded-lg hover:bg-[color:var(--color-surface)]"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold truncate">
              {t?.clientName ?? t?.subject ?? "Conversation"}
            </div>
            <div className="text-[10px] text-[color:var(--color-muted)]">
              {t?.topic ?? ""}
            </div>
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main className="flex-1 px-4 py-4 space-y-2 max-w-md mx-auto w-full overflow-y-auto">
        {(messages.data?.messages ?? []).map((m) => {
          const mine = m.authorRole === "CAREGIVER" && m.authorName.includes(me.firstName);
          return (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                mine
                  ? "ml-auto bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                  : "bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
              }`}
            >
              {!mine && (
                <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-0.5">
                  {m.authorName}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className={`text-[10px] mt-0.5 ${mine ? "opacity-80" : "text-[color:var(--color-muted)]"}`}>
                {format(parseISO(m.createdAt), "h:mm a")}
              </div>
            </div>
          );
        })}
        {messages.isLoading && (
          <div className="h-12 rounded-xl bg-[color:var(--color-surface)] animate-pulse" />
        )}
      </main>
      <div className="safe-bottom px-3 py-2 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 backdrop-blur flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message your coordinator…"
          rows={1}
          className="flex-1 px-3 py-2 rounded-xl bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm resize-none max-h-32"
        />
        <button
          onClick={send}
          disabled={sending || !body.trim()}
          className="h-10 w-10 rounded-xl bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] disabled:opacity-40 flex items-center justify-center"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
