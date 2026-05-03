import { useState } from "react";
import { useLocation } from "wouter";
import { useListFamilyUsers } from "@workspace/api-client-react";
import { setAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function SignIn() {
  const [, setLocation] = useLocation();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  
  const { data: users, isLoading } = useListFamilyUsers();

  const handleSignIn = () => {
    if (!selectedUserId || !users) return;
    
    const user = users.find(u => u.id === selectedUserId);
    if (!user || !user.clientId) return;

    setAuth({
      clientId: user.clientId,
      familyUserId: user.id
    });
    
    setLocation("/today");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary/10 p-4 rounded-full mb-4">
            <Heart className="w-8 h-8 text-primary fill-primary" />
          </div>
          <h1 className="text-3xl font-serif text-foreground font-medium mb-2">Chajinel Family</h1>
          <p className="text-muted-foreground text-center text-sm max-w-xs">
            A calm window into your loved one's daily care.
          </p>
        </div>

        <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-xl text-center font-serif">Welcome back</CardTitle>
            <CardDescription className="text-center">
              Please select your family account to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center p-4 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span>Loading accounts...</span>
                </div>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="w-full h-12 bg-white/50 dark:bg-black/50">
                    <SelectValue placeholder="Select your name" />
                  </SelectTrigger>
                  <SelectContent>
                    {users?.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.firstName} {user.lastName} ({user.relationship})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Button 
              className="w-full h-12 text-base font-medium shadow-sm transition-all hover:shadow-md"
              disabled={!selectedUserId || isLoading}
              onClick={handleSignIn}
            >
              Sign In
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
