import axios from "axios";

export const api = axios.create({
  baseURL: "/api"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("storyboard_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type User = {
  id: string;
  email?: string | null;
  phone?: string | null;
  displayName: string;
  role: "USER" | "ADMIN" | "OWNER";
};

export type Project = {
  id: string;
  name: string;
  description: string;
  audioPath?: string | null;
  audioFileName?: string | null;
  document: unknown;
  createdAt: string;
  updatedAt: string;
  members?: Array<{
    id: string;
    role: "VIEWER" | "EDITOR" | "MANAGER";
    user: User;
  }>;
};
