import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { projectRouter } from "./routes/projects.js";
import { config } from "./config.js";
import { createSocketServer } from "./socket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.resolve(config.uploadDir)));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/projects", projectRouter);

const frontendDist = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res, next) => {
  const indexFile = path.join(frontendDist, "index.html");
  res.sendFile(indexFile, (error) => {
    if (error) next();
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ message: "请求参数无效", issues: error.flatten() });
  }
  if (error instanceof Error) {
    return res.status(400).json({ message: error.message });
  }
  res.status(500).json({ message: "服务器错误" });
});

const server = http.createServer(app);
createSocketServer(server);

server.listen(config.port, () => {
  console.log(`Storyboard server listening on http://localhost:${config.port}`);
});
