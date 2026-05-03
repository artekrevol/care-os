import { useAuth } from "@/lib/auth";
import { useListMessageThreads, useListThreadMessages, usePostThreadMessage, getListThreadMessagesQueryKey, getListMessageThreadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { MessageCircle, Send, Loader2, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";

export default function Messages() {
  const auth = useAuth();
  const clientId = auth?.clientId || "";
  const queryClient = useQueryClient();

  const { data: threads, isLoading: loadingThreads } = useListMessageThreads(
    { clientId },
    { query: { enabled: !!clientId, refetchInterval: 5000 } as any }
  );

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const activeThreadId = selectedThreadId || (threads && threads.length > 0 ? threads[0].id : null);

  const { data: messages, isLoading: loadingMessages } = useListThreadMessages(
    activeThreadId || "",
    { query: { enabled: !!activeThreadId, refetchInterval: 5000 } as any }
  );

  const postMessage = usePostThreadMessage();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = () => {
    if (!draft.trim() || !activeThreadId) return;

    postMessage.mutate({ id: activeThreadId, data: { body: draft } }, {
      onSuccess: () => {
        setDraft("");
        queryClient.invalidateQueries({ queryKey: getListThreadMessagesQueryKey(activeThreadId) });
        queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey({ clientId }) });
      }
    });
  };

  if (loadingThreads && !threads) {
    return (
      <div className="p-6 h-[calc(100vh-64px)] md:h-screen max-w-6xl mx-auto w-full flex">
        <Skeleton className="w-1/3 h-full rounded-xl mr-4" />
        <Skeleton className="w-2/3 h-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-64px)] md:h-screen max-w-6xl mx-auto w-full flex flex-col md:flex-row gap-4 overflow-hidden">
      
      {/* Thread List Sidebar */}
      <div className={`md:w-1/3 flex flex-col bg-card rounded-xl shadow-sm border overflow-hidden ${activeThreadId ? 'hidden md:flex' : 'flex flex-1'}`}>
        <div className="p-4 border-b bg-muted/30">
          <h2 className="text-xl font-serif font-medium text-foreground">Conversations</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads?.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm mt-10">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No messages yet
            </div>
          ) : (
            threads?.map(thread => (
              <button
                key={thread.id}
                onClick={() => setSelectedThreadId(thread.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  activeThreadId === thread.id 
                    ? "bg-primary/10 text-primary" 
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <div className="flex justify-between items-baseline mb-1">
                  <span className="font-medium truncate pr-2">{thread.topic}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {thread.lastMessageAt ? format(parseISO(thread.lastMessageAt), "MMM d") : ""}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {thread.subject || "No subject"}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Message Area */}
      <div className={`flex-1 flex flex-col bg-card rounded-xl shadow-sm border overflow-hidden ${!activeThreadId ? 'hidden md:flex' : 'flex'}`}>
        {activeThreadId ? (
          <>
            <div className="p-4 border-b bg-muted/30 flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                className="md:hidden -ml-2"
                onClick={() => setSelectedThreadId(null)}
              >
                &larr; Back
              </Button>
              <div>
                <h3 className="font-medium text-foreground">
                  {threads?.find(t => t.id === activeThreadId)?.topic}
                </h3>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loadingMessages ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                messages?.map(msg => {
                  const isFamily = msg.authorRole === "FAMILY";
                  return (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id} 
                      className={`flex gap-3 max-w-[85%] ${isFamily ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isFamily ? 'bg-primary/20 text-primary' : 'bg-secondary/50 text-secondary-foreground'}`}>
                        {isFamily ? <User className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className={`flex flex-col ${isFamily ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">{msg.authorName}</span>
                          <span className="text-[10px] text-muted-foreground/70">{format(parseISO(msg.createdAt), "h:mm a")}</span>
                        </div>
                        <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                          isFamily 
                            ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                            : 'bg-muted text-foreground rounded-tl-sm'
                        }`}>
                          {msg.body}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-background border-t">
              <div className="flex items-center gap-2">
                <Input 
                  placeholder="Type a message..." 
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="bg-card"
                />
                <Button 
                  size="icon" 
                  disabled={!draft.trim() || postMessage.isPending}
                  onClick={handleSend}
                >
                  {postMessage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <MessageCircle className="w-12 h-12 mb-4 opacity-20" />
            <p>Select a conversation to view messages</p>
          </div>
        )}
      </div>

    </div>
  );
}
