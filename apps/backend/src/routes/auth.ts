import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { credentialsSchema, requireAuth, signToken, splitIdentifier } from "../auth.js";
import { prisma } from "../db.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  const { email, phone } = splitIdentifier(input.emailOrPhone);

  if (!email && !phone) {
    return res.status(400).json({ message: "请输入邮箱或手机号" });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email ?? undefined }, { phone: phone ?? undefined }] }
  });

  if (existing) {
    return res.status(409).json({ message: "该账号已注册" });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      phone,
      displayName: input.displayName || email || phone || "New user",
      passwordHash
    },
    select: { id: true, email: true, phone: true, displayName: true, role: true }
  });

  return res.status(201).json({ token: signToken(user.id), user });
});

authRouter.post("/login", async (req, res) => {
  const input = credentialsSchema.pick({ emailOrPhone: true, password: true }).parse(req.body);
  const { email, phone } = splitIdentifier(input.emailOrPhone);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: email ?? undefined }, { phone: phone ?? undefined }] }
  });

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return res.status(401).json({ message: "账号或密码错误" });
  }

  return res.json({
    token: signToken(user.id),
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: user.role
    }
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const input = z.object({ displayName: z.string().trim().min(1).max(80) }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { displayName: input.displayName },
    select: { id: true, email: true, phone: true, displayName: true, role: true }
  });
  res.json({ user });
});
