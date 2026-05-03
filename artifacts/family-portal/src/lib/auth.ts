import { useState, useEffect } from "react";

const AUTH_KEY = "careos_family_auth";

export interface AuthState {
  clientId: string;
  familyUserId: string;
}

export function getAuth(): AuthState | null {
  try {
    const data = localStorage.getItem(AUTH_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthState) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  // Dispatch custom event to update hooks across the app
  window.dispatchEvent(new Event("careos_auth_changed"));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  window.dispatchEvent(new Event("careos_auth_changed"));
}

export function useAuth() {
  const [auth, setAuthState] = useState<AuthState | null>(getAuth());

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthState(getAuth());
    };
    window.addEventListener("careos_auth_changed", handleAuthChange);
    return () => window.removeEventListener("careos_auth_changed", handleAuthChange);
  }, []);

  return auth;
}
