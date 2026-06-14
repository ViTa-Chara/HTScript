import type { StoryboardDocument, StoryboardFrame } from "@storyboard/shared";
import type { Prisma } from "@prisma/client";

export const emptyDocument = (): StoryboardDocument => ({
  canvas: {
    width: 1280,
    height: 720,
    background: "#f8fafc"
  },
  frames: []
});

export const normalizeFrame = (frame: StoryboardFrame): StoryboardFrame => ({
  ...frame,
  startMs: Math.max(0, Math.round(frame.startMs)),
  endMs: Math.max(Math.round(frame.startMs) + 1, Math.round(frame.endMs)),
  title: frame.title?.trim() || "Untitled shot",
  notes: frame.notes ?? "",
  elements: Array.isArray(frame.elements) ? frame.elements : []
});

export const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const fromJsonDocument = (value: unknown): StoryboardDocument =>
  value as StoryboardDocument;
