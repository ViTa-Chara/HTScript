import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Server as SocketServer } from "socket.io";
import type { StoryboardDocument } from "@storyboard/shared";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { toJson } from "./document.js";

type SocketUser = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: "USER" | "ADMIN" | "OWNER";
};

const projectPresence = new Map<string, Map<string, SocketUser>>();

export function createSocketServer(server: Server) {
  const io = new SocketServer(server, {
    cors: { origin: config.corsOrigin, credentials: true }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, config.jwtSecret) as { sub?: string };
      if (!payload.sub) throw new Error("Missing subject");
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, displayName: true, email: true, phone: true, role: true }
      });
      if (!user) throw new Error("Missing user");
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as SocketUser;

    socket.on("project:join", async ({ projectId }: { projectId: string }) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { members: { where: { userId: user.id } } }
      });
      if (!project) return socket.emit("error:message", "项目不存在");
      if (!["ADMIN", "OWNER"].includes(user.role) && project.createdById !== user.id && project.members.length === 0) {
        return socket.emit("error:message", "无权访问项目");
      }

      socket.join(`project:${projectId}`);
      socket.data.projectId = projectId;
      const presence = projectPresence.get(projectId) ?? new Map<string, SocketUser>();
      presence.set(socket.id, user);
      projectPresence.set(projectId, presence);
      io.to(`project:${projectId}`).emit("presence:update", Array.from(presence.values()));
      socket.emit("project:document", project.document);
    });

    socket.on("project:patch", async ({ projectId, document, summary }: { projectId: string; document: StoryboardDocument; summary?: string }) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { members: { where: { userId: user.id } } }
      });
      if (!project) return;
      const memberRole = project.members[0]?.role;
      const editable = ["ADMIN", "OWNER"].includes(user.role) || project.createdById === user.id || memberRole === "EDITOR" || memberRole === "MANAGER";
      if (!editable) return socket.emit("error:message", "没有编辑权限");

      await prisma.project.update({ where: { id: projectId }, data: { document: toJson(document) } });
      await prisma.storyboardChange.create({
        data: {
          projectId,
          userId: user.id,
          type: "BULK_UPDATE",
          summary: summary ?? "Realtime storyboard edit",
          snapshot: toJson(document)
        }
      });
      socket.to(`project:${projectId}`).emit("project:document", document);
    });

    socket.on("disconnect", () => {
      const projectId = socket.data.projectId as string | undefined;
      if (!projectId) return;
      const presence = projectPresence.get(projectId);
      if (!presence) return;
      presence.delete(socket.id);
      if (presence.size === 0) {
        projectPresence.delete(projectId);
      } else {
        io.to(`project:${projectId}`).emit("presence:update", Array.from(presence.values()));
      }
    });
  });

  return io;
}
