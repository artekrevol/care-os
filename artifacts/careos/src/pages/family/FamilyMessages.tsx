import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useListMessageThreads,
  useListThreadMessages,
  usePostThreadMessage,
  useCreateMessageThread,
  getListMessageThreadsQueryKey,
  getListThreadMessagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { MessageSquarePlus, Send } from "lucide-react";
import { FamilyLayout, loadFamilyUser, type FamilyUser } from "./FamilyLayout";

export default function FamilyMessages() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const u = loadFamilyUser();
    if (!u) {
      navigate("/family/login");
      return;
    }
    setUser(u);
  }, [navigate]);

  const headers: Record<string, string> = user ? { "x-family-user-id": user.id } : {};
  const { data: threads, isLoading: threadsLoading } = useListMessageThreads(
    { clientId: user?.clientId },
    {
      query: { enabled: !!user } as never,
      request: { headers },
    },
  );

  useEffect(() => {
    if (threads && threads.length > 0 && !activeId) setActiveId(threads[0].id);
  }, [threads, activeId]);

  const { data: messages } = useListThreadMessages(activeId ?? "", {
    query: { enabled: !!activeId } as never,
    request: { headers },
  });

  const postMessage = usePostThreadMessage({
    request: {
      headers: user
        ? {
            "x-family-user-id": user.id,
            "x-user-role": "FAMILY",
            "x-user-name": `${user.firstName} ${user.lastName}`,
          }
        : {},
    },
  });

  const createThread = useCreateMessageThread({
    request: { headers },
  });

  if (!user) return null;

  async function send() {
    if (!activeId || !draft.trim() || !user) return;
    await postMessage.mutateAsync({
      id: activeId,
      data: { body: draft.trim(), attachments: [] },
    });
    setDraft("");
    queryClient.invalidateQueries({ queryKey: getListThreadMessagesQueryKey(activeId) });
    queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey({ clientId: user.clientId }) });
  }

  async function startThread() {
    if (!newSubject.trim() || !newBody.trim() || !user) return;
    const thread = await createThread.mutateAsync({
      data: {
        clientId: user.clientId,
        topic: "GENERAL",
        subject: newSubject.trim(),
        participants: [
          { userId: user.id, role: "FAMILY", name: `${user.firstName} ${user.lastName}` },
          { userId: "user_admin", role: "AGENCY", name: "Casey Admin" },
        ],
        initialMessage: {
          authorId: user.id,
          authorRole: "FAMILY",
          authorName: `${user.firstName} ${user.lastName}`,
          body: newBody.trim(),
        },
      },
    });
    setNewSubject("");
    setNewBody("");
    setCreating(false);
    queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey({ clientId: user.clientId }) });
    setActiveId(thread.id);
  }

  return (
    <FamilyLayout user={user}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Messages</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreating((v) => !v)}
            data-testid="button-new-thread"
          >
            <MessageSquarePlus className="h-4 w-4 mr-1" />
            New message
          </Button>
        </div>

        {creating && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                data-testid="input-new-subject"
              />
              <Textarea
                placeholder="What would you like to ask the agency?"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={3}
                data-testid="textarea-new-body"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={startThread} disabled={createThread.isPending} data-testid="button-send-new-thread">
                  Send
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-[260px_1fr] gap-4">
          <div className="space-y-2">
            {threadsLoading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : threads && threads.length > 0 ? (
              threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  data-testid={`thread-${t.id}`}
                  className={`w-full text-left rounded-lg border p-3 transition ${
                    activeId === t.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <p className="font-medium text-sm truncate">{t.subject ?? "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.lastMessageAt
                      ? format(new Date(t.lastMessageAt), "MMM d, h:mm a")
                      : "—"}
                  </p>
                </button>
              ))
            ) : (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  No conversations yet.
                </CardContent>
              </Card>
            )}
          </div>

          <Card className="min-h-[400px] flex flex-col">
            <CardContent className="p-4 flex-1 flex flex-col gap-3">
              {!activeId ? (
                <p className="text-sm text-muted-foreground text-center my-auto">
                  Select a conversation or start a new one.
                </p>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto space-y-3" data-testid="message-list">
                    {messages?.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.authorId === user.id ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                            m.authorId === user.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p className="text-xs opacity-70 mb-0.5">
                            {m.authorName} · {format(new Date(m.createdAt), "MMM d, h:mm a")}
                          </p>
                          <p>{m.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2 border-t">
                    <Textarea
                      placeholder="Type a message…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      data-testid="textarea-message-draft"
                    />
                    <Button
                      onClick={send}
                      disabled={postMessage.isPending || !draft.trim()}
                      data-testid="button-send-message"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </FamilyLayout>
  );
}
