export type Role = "USER" | "ADMIN" | "OWNER";

export type StoryboardTool =
  | "select"
  | "brush"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "camera"
  | "movement"
  | "shot"
  | "note";

export interface StoryboardElement {
  id: string;
  type: "path" | "shape" | "text" | "preset";
  tool: StoryboardTool;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  points?: number[];
  text?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  opacity?: number;
  preset?: "close-up" | "wide" | "pan" | "tilt" | "dolly" | "cut" | "fade";
}

export interface StoryboardFrame {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  notes: string;
  elements: StoryboardElement[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface StoryboardDocument {
  frames: StoryboardFrame[];
  canvas: {
    width: number;
    height: number;
    background: string;
  };
}

export interface PresenceUser {
  id: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  role: Role;
}
