import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAdmin, requireAuth, requireOwner, splitIdentifier } from "../auth.js";
import { config } from "../config.js";
import { emptyDocument, toJson } from "../document.js";
import { prisma } from "../db.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");
const uploadRoot = path.resolve(config.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.-]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 1024 * 1024 * 200 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      cb(new Error("创建项目必须上传音轨文件"));
      return;
    }
    cb(null, true);
  }
});

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, phone: true, displayName: true, role: true, createdAt: true }
  });
  res.json({ users });
});

adminRouter.patch("/users/:userId/role", requireOwner, async (req, res) => {
  const userId = param(req.params.userId);
  const input = z.object({ role: z.enum(["USER", "ADMIN"]) }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: input.role },
    select: { id: true, email: true, phone: true, displayName: true, role: true }
  });
  res.json({ user });
});

adminRouter.post("/users", async (req, res) => {
  const input = z.object({
    emailOrPhone: z.string().trim().min(3),
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(8),
    role: z.enum(["USER", "ADMIN"]).default("USER")
  }).parse(req.body);
  const { email, phone } = splitIdentifier(input.emailOrPhone);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: { email, phone, displayName: input.displayName, passwordHash, role: input.role },
    select: { id: true, email: true, phone: true, displayName: true, role: true }
  });
  res.status(201).json({ user });
});

adminRouter.get("/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { id: true, displayName: true } },
      members: { include: { user: { select: { id: true, displayName: true, email: true, phone: true } } } }
    }
  });
  res.json({ projects });
});

adminRouter.post("/projects", requireOwner, audioUpload.single("audio"), async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional()
  }).parse(req.body);

  if (!req.file) {
    return res.status(400).json({ message: "创建项目必须上传音轨" });
  }

  const project = await prisma.project.create({
    data: {
      name: input.name,
      description: input.description ?? "",
      audioPath: `/uploads/${req.file.filename}`,
      audioFileName: req.file.originalname,
      audioMime: req.file.mimetype,
      audioSize: req.file.size,
      createdById: req.user!.id,
      document: toJson(emptyDocument()),
      members: {
        create: { userId: req.user!.id, role: "MANAGER" }
      }
    }
  });

  res.status(201).json({ project });
});

adminRouter.patch("/projects/:projectId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const input = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional()
  }).parse(req.body);

  const project = await prisma.project.update({
    where: { id: projectId },
    data: input
  });

  res.json({ project });
});

adminRouter.delete("/projects/:projectId", async (req, res) => {
  await prisma.project.delete({ where: { id: param(req.params.projectId) } });
  res.status(204).send();
});

adminRouter.post("/projects/:projectId/members", async (req, res) => {
  const projectId = param(req.params.projectId);
  const input = z.object({
    userId: z.string().min(1),
    role: z.enum(["VIEWER", "EDITOR", "MANAGER"]).default("EDITOR")
  }).parse(req.body);

  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: input.userId } },
    create: { projectId, userId: input.userId, role: input.role },
    update: { role: input.role },
    include: { user: { select: { id: true, displayName: true, email: true, phone: true } } }
  });

  res.status(201).json({ member });
});

adminRouter.delete("/projects/:projectId/members/:userId", async (req, res) => {
  const projectId = param(req.params.projectId);
  const userId = param(req.params.userId);
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId } }
  });
  res.status(204).send();
});
