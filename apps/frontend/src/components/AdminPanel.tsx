import { FormEvent, useEffect, useState } from "react";
import { Crown, Trash2, UserCog, UsersRound } from "lucide-react";
import { api, type Project, type User } from "../api";
import { useAuth } from "../store";

export function AdminPanel({ onProjectChange }: { onProjectChange: () => Promise<void> }) {
  const current = useAuth((state) => state.user);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newUser, setNewUser] = useState({ emailOrPhone: "", displayName: "", password: "", role: "USER" });

  const load = async () => {
    const [usersResponse, projectsResponse] = await Promise.all([
      api.get("/admin/users"),
      api.get("/admin/projects")
    ]);
    setUsers(usersResponse.data.users);
    setProjects(projectsResponse.data.projects);
  };

  useEffect(() => {
    void load();
  }, []);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    await api.post("/admin/users", newUser);
    setNewUser({ emailOrPhone: "", displayName: "", password: "", role: "USER" });
    await load();
  };

  const updateRole = async (userId: string, role: "USER" | "ADMIN") => {
    await api.patch(`/admin/users/${userId}/role`, { role });
    await load();
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm("确认删除该项目？")) return;
    await api.delete(`/admin/projects/${projectId}`);
    await load();
    await onProjectChange();
  };

  const addMember = async (projectId: string, userId: string) => {
    if (!userId) return;
    await api.post(`/admin/projects/${projectId}/members`, { userId, role: "EDITOR" });
    await load();
    await onProjectChange();
  };

  return (
    <main className="admin-layout">
      <section className="admin-section">
        <div className="section-heading">
          <h2>
            <UsersRound size={20} />
            用户
          </h2>
        </div>
        <form className="inline-form" onSubmit={createUser}>
          <input value={newUser.emailOrPhone} onChange={(event) => setNewUser({ ...newUser, emailOrPhone: event.target.value })} placeholder="邮箱或手机号" required />
          <input value={newUser.displayName} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} placeholder="昵称" required />
          <input type="password" minLength={8} value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="初始密码" required />
          <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
            <option value="USER">成员</option>
            <option value="ADMIN">管理员</option>
          </select>
          <button className="primary-button">创建</button>
        </form>
        <div className="table-list">
          {users.map((user) => (
            <div className="table-row" key={user.id}>
              <span>{user.displayName}</span>
              <span>{user.email || user.phone}</span>
              <strong>{user.role}</strong>
              {current?.role === "OWNER" && user.role !== "OWNER" && (
                <button className="secondary-button" onClick={() => updateRole(user.id, user.role === "ADMIN" ? "USER" : "ADMIN")}>
                  <UserCog size={16} />
                  {user.role === "ADMIN" ? "撤销管理员" : "设为管理员"}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>
            <Crown size={20} />
            项目权限
          </h2>
        </div>
        <div className="table-list">
          {projects.map((project) => (
            <div className="project-admin-row" key={project.id}>
              <div>
                <h3>{project.name}</h3>
                <p>{project.members?.map((member) => `${member.user.displayName}(${member.role})`).join("、") || "暂无成员"}</p>
              </div>
              <select onChange={(event) => addMember(project.id, event.target.value)} defaultValue="">
                <option value="" disabled>添加成员</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.displayName}</option>
                ))}
              </select>
              <button className="icon-button danger" onClick={() => deleteProject(project.id)} title="删除项目">
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
