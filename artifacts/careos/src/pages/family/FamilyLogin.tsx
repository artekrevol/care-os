import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart } from "lucide-react";

type FamilyMe = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
};

export default function FamilyLogin() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/family/me?email=${encodeURIComponent(email.trim())}`);
      if (!r.ok) throw new Error("not found");
      const res = (await r.json()) as FamilyMe;
      localStorage.setItem("careos.family.user", JSON.stringify(res));
      navigate("/family/home");
    } catch {
      setError("No family account found for that email. Try daniel.park@example.com");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Heart className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">CareOS Family Portal</CardTitle>
          <CardDescription>Sign in to see updates about your loved one's care.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-family-email"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-family-login">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Demo accounts: daniel.park@example.com, maria.velasquez@example.com,
              adaeze.okafor@example.com
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
