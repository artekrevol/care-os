import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";
import Login from "@/pages/Login";
import Schedule from "@/pages/Schedule";
import Visit from "@/pages/Visit";
import Profile from "@/pages/Profile";
import Messages from "@/pages/Messages";
import { loadSession, clearSession, type Session } from "@/lib/session";
import { api, type Me } from "@/lib/api";
import { installAutoFlush } from "@/lib/outbox";
import { ensurePushSubscriptionStatus, registerServiceWorker } from "@/lib/push";
import { toast } from "sonner";

const PUSH_FALLBACK_TOAST_KEY = "careos.pushFallbackShown";

function maybeNotifyPushFallback(): void {
  void ensurePushSubscriptionStatus().then((status) => {
    if (status === "denied" || status === "unsupported") {
      try {
        if (sessionStorage.getItem(PUSH_FALLBACK_TOAST_KEY) === "1") return;
        sessionStorage.setItem(PUSH_FALLBACK_TOAST_KEY, "1");
      } catch {
        // sessionStorage can throw in private browsing — fall through.
      }
      toast.message("Push notifications are off", {
        description:
          status === "denied"
            ? "We will email you instead for shift reminders and alerts."
            : "Your device does not support push. We will email you instead.",
      });
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; session: Session; me: Me };

function useAuth(): [AuthState, (s: Session | null) => void] {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const qc = useQueryClient();

  useEffect(() => {
    void registerServiceWorker();
    installAutoFlush();
  }, []);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      setState({ status: "anon" });
      return;
    }
    api<Me>("/m/me")
      .then((me) => {
        setState({ status: "authed", session: s, me });
        maybeNotifyPushFallback();
      })
      .catch(() => {
        clearSession();
        setState({ status: "anon" });
      });
  }, []);

  function setSession(s: Session | null) {
    if (!s) {
      clearSession();
      qc.clear();
      setState({ status: "anon" });
      return;
    }
    api<Me>("/m/me")
      .then((me) => {
        setState({ status: "authed", session: s, me });
        maybeNotifyPushFallback();
      })
      .catch(() => {
        clearSession();
        setState({ status: "anon" });
      });
  }

  return [state, setSession];
}

function Routes() {
  const [auth, setSession] = useAuth();

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[color:var(--color-muted)] text-sm">Loading…</div>
      </div>
    );
  }

  if (auth.status === "anon") {
    return (
      <Switch>
        <Route path="/login">
          <Login onAuthed={setSession} />
        </Route>
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      <Route path="/" >
        <Schedule me={auth.me} onLogout={() => setSession(null)} />
      </Route>
      <Route path="/visit/:id">
        {(params) => <Visit visitId={params.id} me={auth.me} />}
      </Route>
      <Route path="/profile">
        <Profile me={auth.me} onLogout={() => setSession(null)} />
      </Route>
      <Route path="/messages/:id">
        <Messages me={auth.me} />
      </Route>
      <Route path="/messages">
        <Messages me={auth.me} />
      </Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="min-h-screen bg-[color:var(--color-bg)] text-[color:var(--color-fg)]">
          <Routes />
        </div>
        <Toaster position="top-center" richColors theme="dark" />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
