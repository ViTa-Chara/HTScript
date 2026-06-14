import { create } from "zustand";
import { api, type User } from "./api";

type AuthState = {
  token: string | null;
  user: User | null;
  loading: boolean;
  setSession: (token: string, user: User) => void;
  logout: () => void;
  bootstrap: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem("storyboard_token"),
  user: localStorage.getItem("storyboard_user")
    ? JSON.parse(localStorage.getItem("storyboard_user")!)
    : null,
  loading: true,
  setSession: (token, user) => {
    localStorage.setItem("storyboard_token", token);
    localStorage.setItem("storyboard_user", JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem("storyboard_token");
    localStorage.removeItem("storyboard_user");
    set({ token: null, user: null });
  },
  bootstrap: async () => {
    const token = localStorage.getItem("storyboard_token");
    if (!token) {
      set({ loading: false, user: null, token: null });
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      localStorage.setItem("storyboard_user", JSON.stringify(data.user));
      set({ user: data.user, token, loading: false });
    } catch {
      localStorage.removeItem("storyboard_token");
      localStorage.removeItem("storyboard_user");
      set({ user: null, token: null, loading: false });
    }
  }
}));
