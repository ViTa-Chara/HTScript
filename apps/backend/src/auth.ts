import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";

export const credentialsSchema = z.object({
  emailOrPhone: z.string().trim().min(3),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).max(80).optional()
});

export const signToken = (userId: string) =>
  jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "14d" });

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string | null;
        phone: string | null;
        displayName: string;
        role: "USER" | "ADMIN" | "OWNER";
      };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "请先登录" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string };
    if (!payload.sub) throw new Error("Missing subject");

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, phone: true, displayName: true, role: true }
    });

    if (!user) {
      return res.status(401).json({ message: "登录已失效" });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "登录已失效" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !["ADMIN", "OWNER"].includes(req.user.role)) {
    return res.status(403).json({ message: "需要管理员权限" });
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "OWNER") {
    return res.status(403).json({ message: "需要站点所有者权限" });
  }
  next();
}

export function splitIdentifier(emailOrPhone: string) {
  const value = emailOrPhone.trim();
  if (value.includes("@")) {
    return { email: value.toLowerCase(), phone: null };
  }
  return { email: null, phone: value.replace(/\s+/g, "") };
}
