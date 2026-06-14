import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Circle, Text, Arrow, Transformer } from "react-konva";
import Konva from "konva";
import {
  ArrowLeft,
  Brush,
  Camera,
  Circle as CircleIcon,
  Eraser,
  FileClock,
  MousePointer2,
  MoveRight,
  Pause,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  Users
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type { PresenceUser, StoryboardDocument, StoryboardElement, StoryboardFrame, StoryboardTool } from "@storyboard/shared";
import { api, type Project } from "../api";
import { useAuth } from "../store";

const tools: Array<{ id: StoryboardTool; label: string; icon: React.ElementType }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "brush", label: "画笔", icon: Brush },
  { id: "eraser", label: "橡皮", icon: Eraser },
  { id: "rect", label: "矩形", icon: Square },
  { id: "ellipse", label: "椭圆", icon: CircleIcon },
  { id: "text", label: "文字", icon: Type },
  { id: "camera", label: "镜头框", icon: Camera },
  { id: "movement", label: "运动箭头", icon: MoveRight },
  { id: "shot", label: "分镜预设", icon: FileClock }
];

const defaultDocument: StoryboardDocument = {
  canvas: { width: 1280, height: 720, background: "#f8fbff" },
  frames: []
};

function uid(prefix = "item") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function firstFrame(): StoryboardFrame {
  return {
    id: uid("frame"),
    startMs: 0,
    endMs: 3000,
    title: "Opening shot",
    notes: "",
    elements: []
  };
}

function ensureDocument(value: unknown): StoryboardDocument {
  const incoming = (value && typeof value === "object" ? value : defaultDocument) as Partial<StoryboardDocument>;
  const canvas = incoming.canvas ?? defaultDocument.canvas;
  const frames = Array.isArray(incoming.frames) && incoming.frames.length > 0 ? incoming.frames : [firstFrame()];

  return {
    canvas: {
      width: canvas.width ?? defaultDocument.canvas.width,
      height: canvas.height ?? defaultDocument.canvas.height,
      background: canvas.background ?? defaultDocument.canvas.background
    },
    frames: frames.map((frame) => ({
      ...frame,
      title: frame.title || "Untitled shot",
      notes: frame.notes ?? "",
      elements: Array.isArray(frame.elements) ? frame.elements : []
    }))
  };
}

export function Editor({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { token, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<StoryboardDocument>(defaultDocument);
  const [activeFrameId, setActiveFrameId] = useState<string>("");
  const [activeTool, setActiveTool] = useState<StoryboardTool>("select");
  const [stroke, setStroke] = useState("#111827");
  const [fill, setFill] = useState("#ffffff00");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<StoryboardDocument[]>([]);
  const [redoStack, setRedoStack] = useState<StoryboardDocument[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedNodeRef = useRef<Konva.Node | null>(null);

  const activeFrame = useMemo(
    () => document.frames.find((frame) => frame.id === activeFrameId) ?? document.frames[0],
    [document.frames, activeFrameId]
  );

  const duration = Math.max(10000, ...document.frames.map((frame) => frame.endMs));

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data: projectData } = await api.get(`/projects/${projectId}`);
      const ensured = ensureDocument(projectData.project.document);
      setProject(projectData.project);
      setDocument(ensured);
      setActiveFrameId((current) => current || ensured.frames[0]?.id || "");

      const [versionsResponse, changesResponse] = await Promise.allSettled([
        api.get(`/projects/${projectId}/versions`),
        api.get(`/projects/${projectId}/changes`)
      ]);
      if (versionsResponse.status === "fulfilled") setVersions(versionsResponse.value.data.versions);
      if (changesResponse.status === "fulfilled") setChanges(changesResponse.value.data.changes);
    } catch (error: any) {
      setLoadError(error.response?.data?.message ?? "编辑器加载失败，请检查项目权限或后端接口。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (!token) return;
    const socket = io("/", { auth: { token } });
    socketRef.current = socket;
    socket.emit("project:join", { projectId });
    socket.on("presence:update", setPresence);
    socket.on("project:document", (incoming: StoryboardDocument) => {
      const ensured = ensureDocument(incoming);
      setDocument(ensured);
      setActiveFrameId((current) => {
        if (current && ensured.frames.some((frame) => frame.id === current)) return current;
        return ensured.frames[0]?.id || "";
      });
    });
    socket.on("connect_error", (error) => setLoadError(`实时连接失败：${error.message}`));
    socket.on("error:message", (message: string) => setLoadError(message));
    return () => {
      socket.disconnect();
    };
  }, [projectId, token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!project) return;
      void api.patch(`/projects/${projectId}/document`, {
        document,
        type: "AUTO_BACKUP",
        summary: "Auto backup"
      }).then(() => refreshHistory());
    }, 30000);
    return () => window.clearInterval(interval);
  }, [projectId, project, document]);

  useEffect(() => {
    if (!transformerRef.current) return;
    if (selectedNodeRef.current) {
      transformerRef.current.nodes([selectedNodeRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedElementId, activeFrame?.elements]);

  const refreshHistory = async () => {
    const [versionsResponse, changesResponse] = await Promise.all([
      api.get(`/projects/${projectId}/versions`),
      api.get(`/projects/${projectId}/changes`)
    ]);
    setVersions(versionsResponse.data.versions);
    setChanges(changesResponse.data.changes);
  };

  const commitDocument = (next: StoryboardDocument, summary = "Storyboard edit", realtime = true) => {
    setHistory((items) => [...items.slice(-30), document]);
    setRedoStack([]);
    setDocument(next);
    if (realtime) socketRef.current?.emit("project:patch", { projectId, document: next, summary });
  };

  const updateFrame = (frame: StoryboardFrame, summary = "Updated frame") => {
    const next = {
      ...document,
      frames: document.frames.map((item) => (item.id === frame.id ? frame : item)).sort((a, b) => a.startMs - b.startMs)
    };
    commitDocument(next, summary);
  };

  const addElement = (element: StoryboardElement) => {
    const frame = activeFrame;
    if (!frame) return;
    updateFrame({ ...frame, elements: [...frame.elements, element] }, `Added ${element.tool}`);
    setSelectedElementId(element.id);
  };

  const pointer = () => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return { x: 0, y: 0 };
    const scale = stage.scaleX();
    return { x: (pos.x - stage.x()) / scale, y: (pos.y - stage.y()) / scale };
  };

  const handlePointerDown = () => {
    if (!activeFrame) return;
    const pos = pointer();
    setIsDrawing(true);
    if (activeTool === "brush" || activeTool === "eraser") {
      addElement({
        id: uid("path"),
        type: "path",
        tool: activeTool,
        x: 0,
        y: 0,
        points: [pos.x, pos.y],
        stroke: activeTool === "eraser" ? document.canvas.background : stroke,
        strokeWidth: activeTool === "eraser" ? strokeWidth * 3 : strokeWidth
      });
    } else if (activeTool === "rect" || activeTool === "camera") {
      addElement({
        id: uid("rect"),
        type: "shape",
        tool: activeTool,
        x: pos.x,
        y: pos.y,
        width: 220,
        height: activeTool === "camera" ? 124 : 140,
        stroke,
        fill: activeTool === "camera" ? "#ffffff00" : fill,
        strokeWidth: activeTool === "camera" ? 3 : strokeWidth
      });
    } else if (activeTool === "ellipse") {
      addElement({ id: uid("ellipse"), type: "shape", tool: activeTool, x: pos.x, y: pos.y, width: 180, height: 120, stroke, fill, strokeWidth });
    } else if (activeTool === "text") {
      addElement({ id: uid("text"), type: "text", tool: "text", x: pos.x, y: pos.y, text: "Text", stroke, strokeWidth: 1 });
    } else if (activeTool === "movement") {
      addElement({ id: uid("arrow"), type: "preset", tool: "movement", x: 0, y: 0, points: [pos.x, pos.y, pos.x + 180, pos.y], stroke: "#2563eb", strokeWidth: 6, preset: "pan" });
    } else if (activeTool === "shot") {
      addElement({ id: uid("shot"), type: "preset", tool: "shot", x: pos.x, y: pos.y, width: 240, height: 120, stroke: "#dc2626", fill: "#fee2e2", strokeWidth: 2, text: "CU", preset: "close-up" });
    }
  };

  const handlePointerMove = () => {
    if (!isDrawing || !activeFrame || !["brush", "eraser"].includes(activeTool)) return;
    const pos = pointer();
    const elements = [...activeFrame.elements];
    const last = elements[elements.length - 1];
    if (!last?.points) return;
    elements[elements.length - 1] = { ...last, points: [...last.points, pos.x, pos.y] };
    setDocument({
      ...document,
      frames: document.frames.map((frame) => (frame.id === activeFrame.id ? { ...activeFrame, elements } : frame))
    });
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    socketRef.current?.emit("project:patch", { projectId, document, summary: "Drew on frame" });
  };

  const save = async () => {
    await api.patch(`/projects/${projectId}/document`, { document, summary: "Manual save", type: "BULK_UPDATE" });
    await refreshHistory();
  };

  const uploadAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("audio", file);
    const { data } = await api.post(`/projects/${projectId}/audio`, form);
    setProject(data.project);
  };

  const addFrame = () => {
    const startMs = activeFrame ? activeFrame.endMs : 0;
    const frame: StoryboardFrame = {
      id: uid("frame"),
      startMs,
      endMs: startMs + 3000,
      title: `Shot ${document.frames.length + 1}`,
      notes: "",
      elements: []
    };
    commitDocument({ ...document, frames: [...document.frames, frame].sort((a, b) => a.startMs - b.startMs) }, "Created frame");
    setActiveFrameId(frame.id);
  };

  const deleteFrame = () => {
    if (!activeFrame || document.frames.length === 1) return;
    const frames = document.frames.filter((frame) => frame.id !== activeFrame.id);
    commitDocument({ ...document, frames }, "Deleted frame");
    setActiveFrameId(frames[0].id);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setRedoStack((items) => [document, ...items]);
    setHistory((items) => items.slice(0, -1));
    setDocument(previous);
    socketRef.current?.emit("project:patch", { projectId, document: previous, summary: "Undo" });
  };

  const redo = () => {
    const next = redoStack[0];
    if (!next) return;
    setHistory((items) => [...items, document]);
    setRedoStack((items) => items.slice(1));
    setDocument(next);
    socketRef.current?.emit("project:patch", { projectId, document: next, summary: "Redo" });
  };

  const rollback = async (versionId: string) => {
    const { data } = await api.post(`/projects/${projectId}/rollback/${versionId}`);
    const ensured = ensureDocument(data.project.document);
    setDocument(ensured);
    setActiveFrameId(ensured.frames[0]?.id ?? "");
    await refreshHistory();
  };

  const updateElement = (element: StoryboardElement) => {
    if (!activeFrame) return;
    const frame = {
      ...activeFrame,
      elements: activeFrame.elements.map((item) => (item.id === element.id ? element : item))
    };
    updateFrame(frame, "Moved element");
  };

  const removeSelected = () => {
    if (!activeFrame || !selectedElementId) return;
    updateFrame({
      ...activeFrame,
      elements: activeFrame.elements.filter((element) => element.id !== selectedElementId)
    }, "Deleted element");
    setSelectedElementId(null);
  };

  const activeFramePatch = (patch: Partial<StoryboardFrame>) => {
    if (!activeFrame) return;
    updateFrame({ ...activeFrame, ...patch }, "Updated timing");
  };

  if (loadError) {
    return (
      <div className="editor-error">
        <div>
          <h2>编辑器没有加载成功</h2>
          <p>{loadError}</p>
          <button className="primary-button" onClick={load}>重试</button>
          <button className="secondary-button" onClick={onBack}>返回项目</button>
        </div>
      </div>
    );
  }

  if (loading || !project || !activeFrame) return <div className="app-loading">加载编辑器...</div>;

  const scale = 0.66;

  return (
    <main className="editor-shell">
      <aside className="member-rail">
        <button className="icon-button" onClick={onBack} title="返回项目">
          <ArrowLeft size={19} />
        </button>
        <div className="rail-heading">
          <Users size={18} />
          <span>在线</span>
        </div>
        {presence.map((member, index) => (
          <div className="member-pill" key={`${member.id}-${index}`}>
            <span>{member.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{member.displayName}</strong>
              <small>{member.role}</small>
            </div>
          </div>
        ))}
        {presence.length === 0 && (
          <div className="member-pill">
            <span>{user?.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user?.displayName}</strong>
              <small>本机</small>
            </div>
          </div>
        )}
      </aside>

      <section className="editor-main">
        <div className="tool-bar">
          <strong>{project.name}</strong>
          <div className="tool-group">
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button key={tool.id} className={activeTool === tool.id ? "tool active" : "tool"} onClick={() => setActiveTool(tool.id)} title={tool.label}>
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
          <label className="color-chip" title="描边颜色">
            <input type="color" value={stroke} onChange={(event) => setStroke(event.target.value)} />
          </label>
          <label className="color-chip" title="填充颜色">
            <input type="color" value={fill.slice(0, 7) === "#ffffff" ? "#ffffff" : fill} onChange={(event) => setFill(event.target.value)} />
          </label>
          <input className="width-slider" type="range" min={1} max={20} value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} title="线宽" />
          <button className="tool" onClick={undo} title="撤销"><Undo2 size={18} /></button>
          <button className="tool" onClick={redo} title="重做"><Redo2 size={18} /></button>
          <button className="tool" onClick={save} title="保存"><Save size={18} /></button>
          <label className="tool" title="上传音轨">
            <Upload size={18} />
            <input type="file" accept="audio/*" hidden onChange={uploadAudio} />
          </label>
        </div>

        <div className="canvas-zone">
          <div className="stage-wrap">
            <Stage
              ref={stageRef}
              width={document.canvas.width * scale}
              height={document.canvas.height * scale}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            >
              <Layer>
                <Rect width={document.canvas.width} height={document.canvas.height} fill={document.canvas.background} />
                {activeFrame.elements.map((element) => (
                  <StoryboardNode
                    key={element.id}
                    element={element}
                    selected={selectedElementId === element.id}
                    onSelect={(node) => {
                      selectedNodeRef.current = node;
                      setSelectedElementId(element.id);
                    }}
                    onChange={updateElement}
                  />
                ))}
                <Transformer ref={transformerRef} rotateEnabled />
              </Layer>
            </Stage>
          </div>
          <aside className="inspector">
            <h3>{activeFrame.title}</h3>
            <label>标题<input value={activeFrame.title} onChange={(event) => activeFramePatch({ title: event.target.value })} /></label>
            <label>开始 ms<input type="number" value={activeFrame.startMs} onChange={(event) => activeFramePatch({ startMs: Number(event.target.value) })} /></label>
            <label>结束 ms<input type="number" value={activeFrame.endMs} onChange={(event) => activeFramePatch({ endMs: Number(event.target.value) })} /></label>
            <label>备注<textarea value={activeFrame.notes} onChange={(event) => activeFramePatch({ notes: event.target.value })} /></label>
            <button className="secondary-button danger" onClick={removeSelected} disabled={!selectedElementId}>
              <Trash2 size={16} />
              删除元素
            </button>
            <div className="history-list">
              <h4>版本</h4>
              {versions.slice(0, 6).map((version) => (
                <button key={version.id} onClick={() => rollback(version.id)}>{version.label}</button>
              ))}
            </div>
            <div className="history-list">
              <h4>工作记录</h4>
              {changes.slice(0, 6).map((change) => (
                <span key={change.id}>{change.user?.displayName}: {change.summary}</span>
              ))}
            </div>
          </aside>
        </div>

        <div className="timeline">
          <div className="transport">
            <button className="tool" onClick={() => setPlaying(!playing)} title={playing ? "暂停" : "播放"}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="secondary-button" onClick={addFrame}>新增分镜</button>
            <button className="secondary-button danger" onClick={deleteFrame}>删除分镜</button>
            {project.audioPath && <audio controls src={project.audioPath} />}
          </div>
          <div className="timeline-track" style={{ "--duration": duration } as React.CSSProperties}>
            {document.frames.map((frame) => (
              <button
                key={frame.id}
                className={frame.id === activeFrame.id ? "timeline-clip active" : "timeline-clip"}
                style={{
                  left: `${(frame.startMs / duration) * 100}%`,
                  width: `${Math.max(3, ((frame.endMs - frame.startMs) / duration) * 100)}%`
                }}
                onClick={() => setActiveFrameId(frame.id)}
                title={`${frame.startMs}ms - ${frame.endMs}ms`}
              >
                {frame.title}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function StoryboardNode({
  element,
  selected,
  onSelect,
  onChange
}: {
  element: StoryboardElement;
  selected: boolean;
  onSelect: (node: Konva.Node) => void;
  onChange: (element: StoryboardElement) => void;
}) {
  const common = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation ?? 0,
    opacity: element.opacity ?? 1,
    draggable: true,
    onClick: (event: Konva.KonvaEventObject<MouseEvent>) => onSelect(event.target),
    onTap: (event: Konva.KonvaEventObject<TouchEvent>) => onSelect(event.target),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onChange({ ...element, x: event.target.x(), y: event.target.y() }),
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
      const node = event.target;
      onChange({
        ...element,
        x: node.x(),
        y: node.y(),
        width: Math.max(20, (element.width ?? node.width()) * node.scaleX()),
        height: Math.max(20, (element.height ?? node.height()) * node.scaleY()),
        rotation: node.rotation()
      });
      node.scaleX(1);
      node.scaleY(1);
    }
  };

  if (element.type === "path") {
    return <Line {...common} x={0} y={0} points={element.points ?? []} stroke={element.stroke} strokeWidth={element.strokeWidth} tension={0.35} lineCap="round" lineJoin="round" globalCompositeOperation="source-over" />;
  }
  if (element.tool === "ellipse") {
    return <Circle {...common} radiusX={(element.width ?? 120) / 2} radiusY={(element.height ?? 90) / 2} stroke={element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} />;
  }
  if (element.tool === "movement") {
    return <Arrow {...common} x={0} y={0} points={element.points ?? []} pointerLength={18} pointerWidth={18} stroke={element.stroke} fill={element.stroke} strokeWidth={element.strokeWidth} />;
  }
  if (element.type === "text") {
    return <Text {...common} text={element.text ?? "Text"} fontSize={36} fill={element.stroke ?? "#111827"} width={element.width ?? 280} />;
  }
  if (element.tool === "shot") {
    return (
      <>
        <Rect {...common} width={element.width ?? 220} height={element.height ?? 120} cornerRadius={4} stroke={selected ? "#2563eb" : element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} />
        <Text x={element.x + 16} y={element.y + 34} text={element.text ?? "CU"} fontStyle="bold" fontSize={34} fill="#991b1b" listening={false} />
      </>
    );
  }
  return <Rect {...common} width={element.width ?? 180} height={element.height ?? 120} stroke={selected ? "#2563eb" : element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} dash={element.tool === "camera" ? [18, 10] : undefined} />;
}
