import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout/Layout";

// Pages
import SignIn from "@/pages/sign-in";
import Today from "@/pages/today";
import History from "@/pages/history";
import CarePlan from "@/pages/care-plan";
import Messages from "@/pages/messages";
import Documents from "@/pages/documents";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// Note: To set headers globally for customFetch, we might need a custom hook or interceptor.
// For now, the prompt suggests "look at how axios is configured...". The scaffold uses customFetch based on standard fetch.
// We will monkey-patch fetch locally to inject headers if auth exists.
const originalFetch = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const auth = localStorage.getItem("careos_family_auth");
  if (auth) {
    try {
      const parsed = JSON.parse(auth);
      if (parsed.familyUserId) {
        init = init || {};
        init.headers = {
          ...init.headers,
          "X-Family-User-Id": parsed.familyUserId,
          "X-Author-Role": "FAMILY"
        };
      }
    } catch (e) {
      // ignore
    }
  }
  return originalFetch(input, init);
};

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const auth = useAuth();
  
  if (!auth) {
    return <SignIn />;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  const auth = useAuth();

  return (
    <Switch>
      <Route path="/">
        {auth ? <ProtectedRoute component={Today} /> : <SignIn />}
      </Route>
      <Route path="/today"><ProtectedRoute component={Today} /></Route>
      <Route path="/history"><ProtectedRoute component={History} /></Route>
      <Route path="/care-plan"><ProtectedRoute component={CarePlan} /></Route>
      <Route path="/messages"><ProtectedRoute component={Messages} /></Route>
      <Route path="/documents"><ProtectedRoute component={Documents} /></Route>
      <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
