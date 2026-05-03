import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Dashboard from "@/pages/Dashboard";
import Clients from "@/pages/Clients";
import ClientIntake from "@/pages/ClientIntake";
import ClientDetail from "@/pages/ClientDetail";
import Caregivers from "@/pages/Caregivers";
import CaregiverIntake from "@/pages/CaregiverIntake";
import CaregiverDetail from "@/pages/CaregiverDetail";
import Schedule from "@/pages/Schedule";
import Visits from "@/pages/Visits";
import Payroll from "@/pages/Payroll";
import PayPeriodDetail from "@/pages/PayPeriodDetail";
import Compliance from "@/pages/Compliance";
import LaborRules from "@/pages/LaborRules";
import AuditLog from "@/pages/AuditLog";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/clients/new" component={ClientIntake} />
      <Route path="/clients/:id" component={ClientDetail} />
      <Route path="/clients" component={Clients} />
      <Route path="/caregivers/new" component={CaregiverIntake} />
      <Route path="/caregivers/:id" component={CaregiverDetail} />
      <Route path="/caregivers" component={Caregivers} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/visits" component={Visits} />
      <Route path="/payroll" component={Payroll} />
      <Route path="/payroll/:id" component={PayPeriodDetail} />
      <Route path="/compliance" component={Compliance} />
      <Route path="/labor-rules" component={LaborRules} />
      <Route path="/audit-log" component={AuditLog} />
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