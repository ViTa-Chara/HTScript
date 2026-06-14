import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { StoryboardDocument, StoryboardFrame } from "@storyboard/shared";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { fromJsonDocument, normalizeFrame, toJson } from "../document.js";
import { prisma } from "../db.js";

const uploadRoot = path.resolve(config.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 200 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      cb(new Error("只允许上传音频文件"));
      return;
    }
    cb(null, true);
  }
});

export const projectRouter = Router();

projectRouter.use(requireAuth);

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

async function canAccess(projectId: string, userId: string, admin = false) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: { where: { userId } }
    }
  });
  if (!project) return null;
  if (admin || project.createdById === userId || project.members.length > 0) return project;
  return null;
}

function canEdit(project: Awaited<ReturnType<typeof canAccess>>, userId: string, siteRole: string) {
  if (!project) return false;
  if (["ADMIN", "OWNER"].includes(siteRole) || project.createdById === userId) return true;
  const membership = project.members.find((m) => m.userId === userId);
  return membership?.role === "EDITOR" || membership?.role === "MANAGER";
}

projectRouter.get("/", async (req, res) => {
  const where = ["ADMIN", "OWNER"].includes(req.user!.role)
    ? {}
    : {
        OR: [
          { createdById: req.user!.id },
          { members: { some: { userId: req.user!.id } } }
        ]
      };

  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { id: true, displayName: true } },
      members: { include: { user: { select: { id: true, displayName: true, email: true, phone: true, role: true } } } },
      _count: { select: { versions: true, changes: true } }
    }
  });

  res.json({ projects });
});

projectRouter.get("/:projectId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!project) return res.status(404).json({ message: "项目不存在或无权访问" });

  const full = await prisma.project.findUnique({
    where: { id: project.id },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, email: true, phone: true, role: true } } } },
      createdBy: { select: { id: true, displayName: true } }
    }
  });
  res.json({ project: full });
});

projectRouter.post("/:projectId/audio", upload.single("audio"), async (req, res) => {
  const projectId = param(req.params.projectId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }
  if (!req.file) return res.status(400).json({ message: "请选择音轨文件" });

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      audioPath: `/uploads/${req.file.filename}`,
      audioFileName: req.file.originalname,
      audioMime: req.file.mimetype,
      audioSize: req.file.size
    }
  });

  res.json({ project: updated });
});

projectRouter.patch("/:projectId/document", async (req, res) => {
  const projectId = param(req.params.projectId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }

  const input = z.object({
    document: z.any(),
    summary: z.string().trim().max(500).default("Updated storyboard"),
    type: z.enum(["BULK_UPDATE", "AUTO_BACKUP"]).default("BULK_UPDATE")
  }).parse(req.body) as { document: StoryboardDocument; summary: string; type: "BULK_UPDATE" | "AUTO_BACKUP" };

  const cleanDocument: StoryboardDocument = {
    canvas: input.document.canvas ?? { width: 1280, height: 720, background: "#f8fafc" },
    frames: Array.isArray(input.document.frames) ? input.document.frames.map(normalizeFrame) : []
  };

  const [updated] = await prisma.$transaction([
    prisma.project.update({
      where: { id: projectId },
      data: { document: toJson(cleanDocument) }
    }),
    prisma.storyboardChange.create({
      data: {
        projectId,
        userId: req.user!.id,
        type: input.type,
        summary: input.summary,
        snapshot: toJson(cleanDocument)
      }
    }),
    prisma.projectVersion.create({
      data: {
        projectId,
        userId: req.user!.id,
        label: input.type === "AUTO_BACKUP" ? "Auto backup" : input.summary,
        snapshot: toJson(cleanDocument)
      }
    })
  ]);

  res.json({ project: updated });
});

projectRouter.post("/:projectId/frames", async (req, res) => {
  const projectId = param(req.params.projectId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }
  const input = z.object({ frame: z.any() }).parse(req.body) as { frame: StoryboardFrame };
  const document = fromJsonDocument(project!.document);
  const frame = normalizeFrame(input.frame);
  document.frames = [...(document.frames ?? []), frame].sort((a, b) => a.startMs - b.startMs);

  await prisma.project.update({ where: { id: project!.id }, data: { document: toJson(document) } });
  await prisma.storyboardChange.create({
    data: {
      projectId: project!.id,
      userId: req.user!.id,
      type: "CREATE_FRAME",
      frameId: frame.id,
      startMs: frame.startMs,
      endMs: frame.endMs,
      summary: `Created frame ${frame.title}`,
      snapshot: toJson(document)
    }
  });
  res.status(201).json({ frame, document });
});

projectRouter.patch("/:projectId/frames/:frameId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const frameId = param(req.params.frameId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }
  const input = z.object({ frame: z.any() }).parse(req.body) as { frame: StoryboardFrame };
  const document = fromJsonDocument(project!.document);
  const frame = normalizeFrame({ ...input.frame, id: frameId });
  document.frames = (document.frames ?? []).map((item) => (item.id === frameId ? frame : item)).sort((a, b) => a.startMs - b.startMs);

  await prisma.project.update({ where: { id: project!.id }, data: { document: toJson(document) } });
  await prisma.storyboardChange.create({
    data: {
      projectId: project!.id,
      userId: req.user!.id,
      type: "UPDATE_FRAME",
      frameId: frame.id,
      startMs: frame.startMs,
      endMs: frame.endMs,
      summary: `Updated frame ${frame.title}`,
      snapshot: toJson(document)
    }
  });
  res.json({ frame, document });
});

projectRouter.delete("/:projectId/frames/:frameId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const frameId = param(req.params.frameId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }
  const document = fromJsonDocument(project!.document);
  document.frames = (document.frames ?? []).filter((frame) => frame.id !== frameId);

  await prisma.project.update({ where: { id: project!.id }, data: { document: toJson(document) } });
  await prisma.storyboardChange.create({
    data: {
      projectId: project!.id,
      userId: req.user!.id,
      type: "DELETE_FRAME",
      frameId,
      summary: "Deleted frame",
      snapshot: toJson(document)
    }
  });
  res.status(204).send();
});

projectRouter.get("/:projectId/changes", async (req, res) => {
  const project = await canAccess(param(req.params.projectId), req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!project) return res.status(404).json({ message: "项目不存在或无权访问" });
  const changes = await prisma.storyboardChange.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, displayName: true } } }
  });
  res.json({ changes });
});

projectRouter.get("/:projectId/versions", async (req, res) => {
  const project = await canAccess(param(req.params.projectId), req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!project) return res.status(404).json({ message: "项目不存在或无权访问" });
  const versions = await prisma.projectVersion.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, displayName: true } } }
  });
  res.json({ versions });
});

projectRouter.post("/:projectId/rollback/:versionId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const versionId = param(req.params.versionId);
  const project = await canAccess(projectId, req.user!.id, ["ADMIN", "OWNER"].includes(req.user!.role));
  if (!canEdit(project, req.user!.id, req.user!.role)) {
    return res.status(403).json({ message: "没有编辑权限" });
  }
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId }
  });
  if (!version) return res.status(404).json({ message: "版本不存在" });

  const [updated] = await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { document: toJson(version.snapshot) } }),
    prisma.storyboardChange.create({
      data: {
        projectId,
        userId: req.user!.id,
        type: "ROLLBACK",
        summary: `Rolled back to ${version.label}`,
        snapshot: toJson(version.snapshot)
      }
    }),
    prisma.projectVersion.create({
      data: {
        projectId,
        userId: req.user!.id,
        label: `Rollback to ${version.label}`,
        snapshot: toJson(version.snapshot)
      }
    })
  ]);

  res.json({ project: updated });
});
