import { FormEvent, useState } from "react";
import { Clapperboard, KeyRound, Mail, UserPlus } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../store";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((state) => state.setSession);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login" ? { emailOrPhone, password } : { emailOrPhone, password, displayName };
      const { data } = await api.post(endpoint, payload);
      setSession(data.token, data.user);
    } catch (err: any) {
      setError(err.response?.data?.message ?? "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="auth-title">
          <Clapperboard size={32} />
          <h1>Storyboard Studio</h1>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>
            账号
            <span>
              <Mail size={16} />
              <input value={emailOrPhone} onChange={(event) => setEmailOrPhone(event.target.value)} placeholder="邮箱或手机号" required />
            </span>
          </label>
          {mode === "register" && (
            <label>
              昵称
              <span>
                <UserPlus size={16} />
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="协作中显示的名字" required />
              </span>
            </label>
          )}
          <label>
            密码
            <span>
              <KeyRound size={16} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="至少 8 位" required />
            </span>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}</button>
        </form>
        <button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "还没有账号，去注册" : "已有账号，去登录"}
        </button>
      </section>
    </main>
  );
}
