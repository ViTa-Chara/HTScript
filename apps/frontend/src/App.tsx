import { useEffect, useMemo, useState } from "react";
import { LogOut, Shield, SquareKanban } from "lucide-react";
import { api, type Project } from "./api";
import { useAuth } from "./store";
import { AuthScreen } from "./components/AuthScreen";
import { AdminPanel } from "./components/AdminPanel";
import { Editor } from "./components/Editor";
import { ProjectList } from "./components/ProjectList";

type View = "projects" | "admin" | "editor";

export function App() {
  const { user, loading, logout, bootstrap } = useAuth();
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const loadProjects = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { data } = await api.get("/projects");
      setProjects(data.projects);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, [user?.id]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  if (loading) return <div className="app-loading">加载工作台...</div>;
  if (!user) return <AuthScreen />;

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <SquareKanban size={22} />
          <span>Storyboard Studio</span>
        </div>
        <nav className="nav-tabs" aria-label="workspace navigation">
          <button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}>
            项目
          </button>
          {isAdmin && (
            <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
              <Shield size={16} />
              管理
            </button>
          )}
        </nav>
        <div className="account-strip">
          <span>{user.displayName}</span>
          <small>{user.role}</small>
          <button className="icon-button" onClick={logout} title="退出登录">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {view === "projects" && (
        <ProjectList
          busy={busy}
          projects={projects}
          reload={loadProjects}
          onOpen={(projectId) => {
            setActiveProjectId(projectId);
            setView("editor");
          }}
        />
      )}
      {view === "admin" && isAdmin && <AdminPanel onProjectChange={loadProjects} />}
      {view === "editor" && activeProject && (
        <Editor
          projectId={activeProject.id}
          onBack={() => {
            setView("projects");
            void loadProjects();
          }}
        />
      )}
    </div>
  );
}
