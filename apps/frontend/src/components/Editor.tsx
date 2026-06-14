import { ChangeEvent, type CSSProperties, type ElementType, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

const tools: Array<{ id: StoryboardTool; label: string; icon: ElementType }> = [
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
  canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#f8fbff" },
  frames: []
};

type PlaybackState = {
  playing: boolean;
  currentMs: number;
  startedAt: number;
  updatedBy?: string;
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
  const frames = Array.isArray(incoming.frames) && incoming.frames.length > 0 ? incoming.frames : [firstFrame()];

  return {
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      background: incoming.canvas?.background ?? defaultDocument.canvas.background
    },
    frames: frames.map((frame) => ({
      ...frame,
      title: frame.title || "Untitled shot",
      notes: frame.notes ?? "",
      elements: Array.isArray(frame.elements) ? frame.elements : []
    }))
  };
}

function formatTime(ms: number) {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function Editor({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { token, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<StoryboardDocument>(defaultDocument);
  const [activeFrameId, setActiveFrameId] = useState<string>("");
  const [activeTool, setActiveTool] = useState<StoryboardTool>("select");
  const [stroke, setStroke] = useState("#06101f");
  const [fill, setFill] = useState("#d9ecff");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [draftElement, setDraftElement] = useState<StoryboardElement | null>(null);
  const [history, setHistory] = useState<StoryboardDocument[]>([]);
  const [redoStack, setRedoStack] = useState<StoryboardDocument[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [playbackStartedAt, setPlaybackStartedAt] = useState(Date.now());
  const [playbackBy, setPlaybackBy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stageSize, setStageSize] = useState({ width: 960, height: 540 });
  const socketRef = useRef<Socket | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedNodeRef = useRef<Konva.Node | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const playbackBaseMsRef = useRef(0);
  const suppressAudioEventRef = useRef(false);

  const activeFrame = useMemo(
    () => document.frames.find((frame) => frame.id === activeFrameId) ?? document.frames[0],
    [document.frames, activeFrameId]
  );
  const selectedElement = useMemo(
    () => activeFrame?.elements.find((element) => element.id === selectedElementId) ?? null,
    [activeFrame?.elements, selectedElementId]
  );

  const duration = Math.max(10000, ...document.frames.map((frame) => frame.endMs));
  const canvasScale = Math.min(stageSize.width / CANVAS_WIDTH, stageSize.height / CANVAS_HEIGHT);
  const stageWidth = Math.round(CANVAS_WIDTH * canvasScale);
  const stageHeight = Math.round(CANVAS_HEIGHT * canvasScale);
  const playheadPercent = clamp((currentMs / duration) * 100, 0, 100);

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

  useLayoutEffect(() => {
    const node = stageWrapRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const maxWidth = Math.max(320, rect.width - 28);
      const maxHeight = Math.max(220, rect.height - 28);
      const widthByHeight = maxHeight * (16 / 9);
      const heightByWidth = maxWidth * (9 / 16);
      setStageSize(
        widthByHeight <= maxWidth
          ? { width: widthByHeight, height: maxHeight }
          : { width: maxWidth, height: heightByWidth }
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
    socket.on("project:playback", (state: PlaybackState) => {
      const elapsed = state.playing ? Math.max(0, Date.now() - (state.startedAt || Date.now())) : 0;
      const safeMs = clamp(state.currentMs + elapsed, 0, duration);
      playbackBaseMsRef.current = safeMs;
      setPlaying(state.playing);
      setCurrentMs(safeMs);
      setPlaybackStartedAt(Date.now());
      setPlaybackBy(state.updatedBy ?? "");
      if (audioRef.current) {
        suppressAudioEventRef.current = true;
        audioRef.current.currentTime = safeMs / 1000;
        if (state.playing) {
          void audioRef.current.play().catch(() => undefined);
        } else {
          audioRef.current.pause();
        }
        window.setTimeout(() => {
          suppressAudioEventRef.current = false;
        }, 300);
      }
    });
    socket.on("connect_error", (error) => setLoadError(`实时连接失败：${error.message}`));
    socket.on("error:message", (message: string) => setLoadError(message));
    return () => {
      socket.disconnect();
    };
  }, [projectId, token, duration]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const next = clamp(playbackBaseMsRef.current + (Date.now() - playbackStartedAt), 0, duration);
      setCurrentMs(next);
      if (next >= duration) {
        setPlaying(false);
        broadcastPlayback(false, duration);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, playbackStartedAt]);

  useEffect(() => {
    const frameAtPlayhead = document.frames.find((frame) => currentMs >= frame.startMs && currentMs < frame.endMs);
    if (frameAtPlayhead && frameAtPlayhead.id !== activeFrameId && playing) {
      setActiveFrameId(frameAtPlayhead.id);
    }
  }, [currentMs, document.frames, playing, activeFrameId]);

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

  const broadcastPlayback = (nextPlaying: boolean, nextMs: number) => {
    const state: PlaybackState & { projectId: string } = {
      projectId,
      playing: nextPlaying,
      currentMs: clamp(nextMs, 0, duration),
      startedAt: Date.now(),
      updatedBy: user?.displayName
    };
    socketRef.current?.emit("project:playback", state);
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

  const updateElement = (element: StoryboardElement) => {
    if (!activeFrame) return;
    const frame = {
      ...activeFrame,
      elements: activeFrame.elements.map((item) => (item.id === element.id ? element : item))
    };
    updateFrame(frame, "Updated element");
  };

  const addElement = (element: StoryboardElement) => {
    const frame = activeFrame;
    if (!frame) return;
    updateFrame({ ...frame, elements: [...frame.elements, element] }, `Added ${element.tool}`);
    setSelectedElementId(element.id);
    setActiveTool("select");
  };

  const pointer = () => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return { x: 0, y: 0 };
    return { x: pos.x / canvasScale, y: pos.y / canvasScale };
  };

  const makeElement = (start: { x: number; y: number }, end: { x: number; y: number }): StoryboardElement => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.max(24, Math.abs(end.x - start.x));
    const height = Math.max(24, Math.abs(end.y - start.y));

    if (activeTool === "brush" || activeTool === "eraser") {
      return {
        id: uid("path"),
        type: "path",
        tool: activeTool,
        x: 0,
        y: 0,
        points: [start.x, start.y, end.x, end.y],
        stroke: activeTool === "eraser" ? document.canvas.background : stroke,
        strokeWidth: activeTool === "eraser" ? strokeWidth * 3 : strokeWidth
      };
    }
    if (activeTool === "movement") {
      return {
        id: uid("arrow"),
        type: "preset",
        tool: "movement",
        x: 0,
        y: 0,
        points: [start.x, start.y, end.x, end.y],
        stroke,
        strokeWidth: Math.max(4, strokeWidth),
        preset: "pan"
      };
    }
    if (activeTool === "ellipse") {
      return { id: uid("ellipse"), type: "shape", tool: activeTool, x, y, width, height, stroke, fill, strokeWidth };
    }
    if (activeTool === "text") {
      return {
        id: uid("text"),
        type: "text",
        tool: "text",
        x: start.x,
        y: start.y,
        width: Math.max(220, width),
        height: Math.max(72, height),
        text: "双击或在右侧编辑文字",
        stroke,
        fill,
        strokeWidth: 1
      };
    }
    if (activeTool === "shot") {
      return {
        id: uid("shot"),
        type: "preset",
        tool: "shot",
        x,
        y,
        width: Math.max(180, width),
        height: Math.max(96, height),
        stroke: "#1d72e8",
        fill: "#d9ecff",
        strokeWidth: 3,
        text: "CU",
        preset: "close-up"
      };
    }
    return {
      id: uid(activeTool === "camera" ? "camera" : "rect"),
      type: "shape",
      tool: activeTool === "camera" ? "camera" : "rect",
      x,
      y,
      width,
      height,
      stroke,
      fill: activeTool === "camera" ? "#ffffff00" : fill,
      strokeWidth: activeTool === "camera" ? 4 : strokeWidth
    };
  };

  const handlePointerDown = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!activeFrame) return;
    if (activeTool === "select") {
      if (event.target === event.target.getStage() || event.target.name() === "canvas-background") {
        selectedNodeRef.current = null;
        setSelectedElementId(null);
      }
      return;
    }
    const pos = pointer();
    drawStartRef.current = pos;
    const draft = makeElement(pos, { x: pos.x + 1, y: pos.y + 1 });
    setDraftElement(draft);
  };

  const handlePointerMove = () => {
    if (!drawStartRef.current || !draftElement) return;
    const pos = pointer();
    if (draftElement.type === "path") {
      setDraftElement({ ...draftElement, points: [...(draftElement.points ?? []), pos.x, pos.y] });
      return;
    }
    setDraftElement(makeElement(drawStartRef.current, pos));
  };

  const handlePointerUp = () => {
    if (!draftElement) return;
    addElement(draftElement);
    setDraftElement(null);
    drawStartRef.current = null;
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
    setCurrentMs(frame.startMs);
    broadcastPlayback(false, frame.startMs);
  };

  const deleteFrame = () => {
    if (!activeFrame || document.frames.length === 1) return;
    const frames = document.frames.filter((frame) => frame.id !== activeFrame.id);
    commitDocument({ ...document, frames }, "Deleted frame");
    setActiveFrameId(frames[0].id);
    setCurrentMs(frames[0].startMs);
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

  const removeSelected = () => {
    if (!activeFrame || !selectedElementId) return;
    updateFrame({
      ...activeFrame,
      elements: activeFrame.elements.filter((element) => element.id !== selectedElementId)
    }, "Deleted element");
    setSelectedElementId(null);
    selectedNodeRef.current = null;
  };

  const activeFramePatch = (patch: Partial<StoryboardFrame>) => {
    if (!activeFrame) return;
    updateFrame({ ...activeFrame, ...patch }, "Updated timing");
  };

  const togglePlayback = () => {
    const nextPlaying = !playing;
    playbackBaseMsRef.current = currentMs;
    setPlaying(nextPlaying);
    setPlaybackStartedAt(Date.now());
    if (audioRef.current) {
      suppressAudioEventRef.current = true;
      audioRef.current.currentTime = currentMs / 1000;
      if (nextPlaying) void audioRef.current.play().catch(() => undefined);
      else audioRef.current.pause();
      window.setTimeout(() => {
        suppressAudioEventRef.current = false;
      }, 300);
    }
    broadcastPlayback(nextPlaying, currentMs);
  };

  const seekTo = (nextMs: number, keepPlaying = playing) => {
    const safe = clamp(nextMs, 0, duration);
    playbackBaseMsRef.current = safe;
    setCurrentMs(safe);
    setPlaybackStartedAt(Date.now());
    const frame = document.frames.find((item) => safe >= item.startMs && safe < item.endMs);
    if (frame) setActiveFrameId(frame.id);
    if (audioRef.current) audioRef.current.currentTime = safe / 1000;
    broadcastPlayback(keepPlaying, safe);
  };

  const seekFromTimeline = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = timelineTrackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    seekTo(percent * duration);
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
          <input className="width-slider" type="range" min={1} max={28} value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} title="线宽" />
          <button className="tool" onClick={undo} title="撤销"><Undo2 size={18} /></button>
          <button className="tool" onClick={redo} title="重做"><Redo2 size={18} /></button>
          <button className="tool" onClick={save} title="保存"><Save size={18} /></button>
          <label className="tool" title="上传音轨">
            <Upload size={18} />
            <input type="file" accept="audio/*" hidden onChange={uploadAudio} />
          </label>
        </div>

        <div className="canvas-zone">
          <div className="stage-wrap" ref={stageWrapRef}>
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              scaleX={canvasScale}
              scaleY={canvasScale}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            >
              <Layer>
                <Rect name="canvas-background" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill={document.canvas.background} />
                {activeFrame.elements.map((element) => (
                  <StoryboardNode
                    key={element.id}
                    element={element}
                    selected={selectedElementId === element.id}
                    onSelect={(node) => {
                      if (activeTool !== "select") return;
                      selectedNodeRef.current = node;
                      setSelectedElementId(element.id);
                    }}
                    onChange={updateElement}
                  />
                ))}
                {draftElement && (
                  <StoryboardNode
                    element={{ ...draftElement, opacity: 0.82 }}
                    selected={false}
                    onSelect={() => undefined}
                    onChange={() => undefined}
                  />
                )}
                <Transformer ref={transformerRef} rotateEnabled enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]} />
              </Layer>
            </Stage>
          </div>
          <aside className="inspector">
            <h3>{activeFrame.title}</h3>
            <label>标题<input value={activeFrame.title} onChange={(event) => activeFramePatch({ title: event.target.value })} /></label>
            <div className="inspector-grid">
              <label>开始 ms<input type="number" value={activeFrame.startMs} onChange={(event) => activeFramePatch({ startMs: Number(event.target.value) })} /></label>
              <label>结束 ms<input type="number" value={activeFrame.endMs} onChange={(event) => activeFramePatch({ endMs: Number(event.target.value) })} /></label>
            </div>
            <label>备注<textarea value={activeFrame.notes} onChange={(event) => activeFramePatch({ notes: event.target.value })} /></label>
            {selectedElement && (
              <div className="element-panel">
                <h4>选中元素</h4>
                {selectedElement.type === "text" || selectedElement.tool === "shot" ? (
                  <label>文字<textarea value={selectedElement.text ?? ""} onChange={(event) => updateElement({ ...selectedElement, text: event.target.value })} /></label>
                ) : null}
                <div className="inspector-grid">
                  <label>X<input type="number" value={Math.round(selectedElement.x)} onChange={(event) => updateElement({ ...selectedElement, x: Number(event.target.value) })} /></label>
                  <label>Y<input type="number" value={Math.round(selectedElement.y)} onChange={(event) => updateElement({ ...selectedElement, y: Number(event.target.value) })} /></label>
                  <label>宽<input type="number" value={Math.round(selectedElement.width ?? 0)} onChange={(event) => updateElement({ ...selectedElement, width: Number(event.target.value) })} /></label>
                  <label>高<input type="number" value={Math.round(selectedElement.height ?? 0)} onChange={(event) => updateElement({ ...selectedElement, height: Number(event.target.value) })} /></label>
                </div>
                <button className="secondary-button danger" onClick={removeSelected}>
                  <Trash2 size={16} />
                  删除元素
                </button>
              </div>
            )}
            <div className="history-list">
              <h4>版本</h4>
              {versions.slice(0, 4).map((version) => (
                <button key={version.id} onClick={() => rollback(version.id)}>{version.label}</button>
              ))}
            </div>
            <div className="history-list">
              <h4>工作记录</h4>
              {changes.slice(0, 5).map((change) => (
                <span key={change.id}>{change.user?.displayName}: {change.summary}</span>
              ))}
            </div>
          </aside>
        </div>

        <div className="timeline">
          <div className="transport">
            <button className="tool transport-play" onClick={togglePlayback} title={playing ? "暂停并同步给所有人" : "播放并同步给所有人"}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="time-readout">
              <strong>{formatTime(currentMs)}</strong>
              <span>/ {formatTime(duration)}</span>
              {playbackBy && <small>{playbackBy}</small>}
            </div>
            <button className="secondary-button" onClick={addFrame}>新增分镜</button>
            <button className="secondary-button danger" onClick={deleteFrame}>删除分镜</button>
            {project.audioPath && (
              <audio
                ref={audioRef}
                controls
                src={project.audioPath}
                onPlay={() => {
                  if (!suppressAudioEventRef.current && !playing) togglePlayback();
                }}
                onPause={() => {
                  if (!suppressAudioEventRef.current && playing) togglePlayback();
                }}
              />
            )}
          </div>
          <div className="timeline-board">
            <div className="timeline-ruler">
              {Array.from({ length: 11 }).map((_, index) => (
                <span key={index} style={{ left: `${index * 10}%` }}>{formatTime((duration * index) / 10)}</span>
              ))}
            </div>
            <div className="timeline-track" ref={timelineTrackRef} onClick={seekFromTimeline}>
              <div className="timeline-playhead" style={{ left: `${playheadPercent}%` }} />
              {document.frames.map((frame) => (
                <button
                  key={frame.id}
                  className={frame.id === activeFrame.id ? "timeline-clip active" : "timeline-clip"}
                  style={{
                    left: `${(frame.startMs / duration) * 100}%`,
                    width: `${Math.max(3, ((frame.endMs - frame.startMs) / duration) * 100)}%`
                  } as CSSProperties}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveFrameId(frame.id);
                    seekTo(frame.startMs, false);
                  }}
                  title={`${frame.startMs}ms - ${frame.endMs}ms`}
                >
                  <strong>{frame.title}</strong>
                  <span>{formatTime(frame.startMs)} - {formatTime(frame.endMs)}</span>
                </button>
              ))}
            </div>
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
    return <Circle {...common} radiusX={(element.width ?? 120) / 2} radiusY={(element.height ?? 90) / 2} stroke={selected ? "#1d72e8" : element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} />;
  }
  if (element.tool === "movement") {
    return <Arrow {...common} x={0} y={0} points={element.points ?? []} pointerLength={34} pointerWidth={34} stroke={selected ? "#1d72e8" : element.stroke} fill={selected ? "#1d72e8" : element.stroke} strokeWidth={element.strokeWidth} lineCap="round" lineJoin="round" />;
  }
  if (element.type === "text") {
    return <Text {...common} text={element.text ?? "Text"} fontSize={52} fontStyle="600" fill={element.stroke ?? "#06101f"} width={element.width ?? 420} height={element.height ?? 120} padding={8} />;
  }
  if (element.tool === "shot") {
    return (
      <>
        <Rect {...common} width={element.width ?? 260} height={element.height ?? 140} cornerRadius={6} stroke={selected ? "#1d72e8" : element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} shadowBlur={selected ? 14 : 0} shadowColor="#1d72e8" />
        <Text x={element.x + 22} y={element.y + 38} text={element.text ?? "CU"} fontStyle="bold" fontSize={46} fill="#08214a" listening={false} />
      </>
    );
  }
  return <Rect {...common} width={element.width ?? 180} height={element.height ?? 120} stroke={selected ? "#1d72e8" : element.stroke} fill={element.fill} strokeWidth={element.strokeWidth} dash={element.tool === "camera" ? [24, 14] : undefined} cornerRadius={element.tool === "camera" ? 0 : 4} shadowBlur={selected ? 12 : 0} shadowColor="#1d72e8" />;
}
