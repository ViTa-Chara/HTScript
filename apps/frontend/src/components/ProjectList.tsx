import { FormEvent, useState } from "react";
import { FolderPlus, Music, PencilLine, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { api, type Project } from "../api";
import { useAuth } from "../store";

export function ProjectList({
  projects,
  busy,
  reload,
  onOpen
}: {
  projects: Project[];
  busy: boolean;
  reload: () => Promise<void>;
  onOpen: (projectId: string) => void;
}) {
  const user = useAuth((state) => state.user);
  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    await api.post("/admin/projects", { name, description });
    setName("");
    setDescription("");
    await reload();
  };

  return (
    <main className="page-grid">
      {isAdmin && (
        <form className="create-project" onSubmit={createProject}>
          <h2>创建项目</h2>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" required />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="项目说明" />
          <button className="primary-button">
            <FolderPlus size={18} />
            新建
          </button>
        </form>
      )}
      <section className="project-board">
        <div className="section-heading">
          <h2>项目</h2>
          <button className="icon-button" onClick={reload} disabled={busy} title="刷新">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div>
                <h3>{project.name}</h3>
                <p>{project.description || "暂无说明"}</p>
              </div>
              <div className="project-meta">
                <span>{formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: zhCN })}</span>
                {project.audioFileName && (
                  <span>
                    <Music size={14} />
                    {project.audioFileName}
                  </span>
                )}
              </div>
              <button className="secondary-button" onClick={() => onOpen(project.id)}>
                <PencilLine size={17} />
                打开编辑
              </button>
            </article>
          ))}
          {projects.length === 0 && <p className="empty-state">暂无可访问项目。</p>}
        </div>
      </section>
    </main>
  );
}
