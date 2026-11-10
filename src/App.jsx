import { lazy, Suspense, useCallback, useEffect, useState } from "react";

const CodeEditor = lazy(() => import("./CodeEditor.jsx"));
const languages = ["javascript", "python", "html", "css", "markdown", "text"];
const blank = "// Start writing your code here.\n";

function AuthPanel({ authMode, setAuthMode, authError, setAuthError, authBusy, submitAuth }) {
  return <section className="auth-card">
    <div className="auth-heading"><span className="auth-icon">{authMode === "register" ? "✳" : "↗"}</span><div><h2>{authMode === "register" ? "Create your account" : "Welcome back"}</h2><p>{authMode === "register" ? "Register to open your workspace." : "Sign in to return to your workspace."}</p></div></div>
    <form onSubmit={submitAuth} className="auth-form">
      {authMode === "register" && <label>Your name<input name="name" autoComplete="name" maxLength="40" required placeholder="Ada Lovelace" /></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" maxLength="254" required placeholder="you@example.com" /></label>
      <label>Password<input name="password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} minLength="10" maxLength="72" required placeholder="At least 10 characters" /></label>
      {authError && <p className="form-error" role="alert">{authError}</p>}
      <button className="button button-primary auth-submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "register" ? "Create account" : "Sign in"}<span>→</span></button>
    </form>
    <p className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to CodeShare?"} <button type="button" onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}>{authMode === "register" ? "Sign in" : "Create an account"}</button></p>
    <p className="auth-note"><span>▣</span> Your password is hashed before storage.</p>
  </section>;
}

async function api(path, options = {}) {
  const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const token = sessionStorage.getItem("codeshare_token");
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: "omit",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Request failed. Please try again.");
  return body;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("register");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [snippets, setSnippets] = useState([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(blank);
  const [language, setLanguage] = useState("javascript");
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    if (!sessionStorage.getItem("codeshare_token")) { setAuthReady(true); return; }
    api("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => sessionStorage.removeItem("codeshare_token"))
      .finally(() => setAuthReady(true));
  }, []);

  const loadSnippets = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api(`/snippets?search=${encodeURIComponent(query)}&page=${page}&limit=30`);
      setSnippets(data.snippets);
      setPages(Math.max(1, data.pages));
    } catch (error) { setNotice(error.message); }
  }, [query, page, user]);

  useEffect(() => {
    const timeout = setTimeout(loadSnippets, 180);
    return () => clearTimeout(timeout);
  }, [loadSnippets]);
  useEffect(() => { localStorage.setItem("theme", theme); }, [theme]);

  async function submitAuth(event) {
    event.preventDefault(); setAuthError(""); setAuthBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const path = authMode === "register" ? "/auth/register" : "/auth/login";
      const data = await api(path, { method: "POST", body: JSON.stringify({
        ...(authMode === "register" ? { name: form.get("name") } : {}),
        email: form.get("email"), password: form.get("password"),
      }) });
      sessionStorage.setItem("codeshare_token", data.token);
      setUser(data.user);
      formElement.reset();
    } catch (error) { setAuthError(error.message); }
    finally { setAuthBusy(false); }
  }

  async function logout() {
    sessionStorage.removeItem("codeshare_token");
    setUser(null);
    setNotice("You have signed out.");
    resetEditor();
  }

  function resetEditor() {
    setTitle(""); setCode(blank); setLanguage("javascript"); setEditingId(null);
  }

  async function saveSnippet(event) {
    event.preventDefault(); setNotice(""); setBusy(true);
    if (!title.trim() || !code.trim()) {
      setNotice("Add a title and some code before saving.");
      setBusy(false);
      return;
    }
    try {
      await api(editingId ? `/snippets/${editingId}` : "/snippets", {
        method: editingId ? "PUT" : "POST", body: JSON.stringify({ title, code, language }),
      });
      setNotice(editingId ? "Snippet updated." : "Snippet saved and shared.");
      resetEditor(); await loadSnippets();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  function editSnippet(snippet) {
    setEditingId(snippet.id); setTitle(snippet.title); setCode(snippet.code); setLanguage(snippet.language || "javascript");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSnippet(snippet) {
    if (!window.confirm(`Delete “${snippet.title}”?`)) return;
    try { await api(`/snippets/${snippet.id}`, { method: "DELETE" }); setNotice("Snippet deleted."); await loadSnippets(); }
    catch (error) { setNotice(error.message); }
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setNotice("Copy failed. Check clipboard permissions."); }
  }

  async function exportZip() {
    if (!snippets.length) { setNotice("There are no snippets to export."); return; }
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const first = await api("/snippets?page=1&limit=100");
      const all = [...first.snippets];
      for (let currentPage = 2; currentPage <= first.pages; currentPage += 1) {
        const next = await api(`/snippets?page=${currentPage}&limit=100`);
        all.push(...next.snippets);
      }
      const extensions = { javascript: "js", python: "py", html: "html", css: "css", markdown: "md", text: "txt" };
      for (const item of all) {
        const safe = item.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 70) || "snippet";
        zip.file(`${safe}-${item.id}.${extensions[item.language] || "txt"}`, item.code);
      }
      const link = document.createElement("a"); link.href = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      link.download = "codeshare-snippets.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      setNotice(error.message || "Could not create the ZIP archive.");
    }
  }

  async function deleteMySnippets() {
    if (!window.confirm("Delete all of your snippets? This cannot be undone.")) return;
    try {
      const result = await api("/snippets/mine/all", { method: "DELETE" });
      setNotice(`${result.deleted} of your snippets deleted.`);
      await loadSnippets();
    } catch (error) { setNotice(error.message); }
  }

  if (!authReady) return <div className="loading-screen">Opening your workspace…</div>;

  return <div className={`app-shell ${theme}`}>
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark">&lt;/&gt;</span><span>code<span className="brand-light">share</span></span></a>
      <div className="top-actions">
        {user && <span className="connection"><i /> Your workspace</span>}
        <button className="icon-button theme-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle color theme">{theme === "dark" ? "☼" : "☾"}</button>
        {user && <><span className="user-name">{user.name}</span><button className="button button-quiet" onClick={logout}>Sign out</button></>}
      </div>
    </header>

    {!user ? <main id="top" className="layout auth-gate">
      <section className="intro">
        <p className="eyebrow"><span className="live-dot" /> YOUR CODE WORKSPACE</p>
        <h1>Ideas move faster<br />when <span>code is shared.</span></h1>
        <p className="intro-copy">Create an account or sign in to open your workspace, save code, and share snippets with the signed-in community.</p>
        <div className="intro-meta"><span><b>01</b> Create your account</span><span><b>02</b> Save and share snippets</span></div>
      </section>
      <AuthPanel authMode={authMode} setAuthMode={setAuthMode} authError={authError} setAuthError={setAuthError} authBusy={authBusy} submitAuth={submitAuth} />
    </main> : <main id="top" className="layout">
      <section className="intro">
        <p className="eyebrow"><span className="live-dot" /> A quieter place for good code</p>
        <h1>Ideas move faster<br />when <span>code is shared.</span></h1>
        <p className="intro-copy">Capture a thought, keep a useful snippet, and share it with the signed-in community.</p>
        <div className="intro-meta"><span><b>⌘</b> Your snippets, always within reach</span><span><b>↗</b> Shareable with everyone</span></div>
      </section>

      <section className="workspace">
        <div className="section-heading"><div><p className="eyebrow">THE WORKSPACE</p><h2>{editingId ? "Refine your snippet" : "Start with a snippet"}</h2></div><span className="private-tag">SIGNED IN</span></div>
        <form className="editor-card" onSubmit={saveSnippet}>
          <div className="editor-topline"><span className="window-dots"><i/><i/><i/></span><span>{editingId ? "EDITING SNIPPET" : "UNTITLED SNIPPET"}</span><label className="language-select"><span>LANGUAGE</span><select value={language} onChange={(event) => setLanguage(event.target.value)}>{languages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
          <input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength="120" placeholder="Give your snippet a name…" aria-label="Snippet title" />
          <div className="editor-wrap"><Suspense fallback={<div className="editor-loading">Loading code editor…</div>}><CodeEditor value={code} onChange={setCode} language={language} theme={theme === "dark" ? "dark" : "light"} /></Suspense></div>
          <div className="editor-footer"><span>{code.length.toLocaleString()} characters</span><div><button className="button button-quiet" type="button" onClick={() => copy(code)}>Copy code</button>{editingId && <button className="button button-quiet" type="button" onClick={resetEditor}>Cancel</button>}<button className="button button-primary" type="submit" disabled={!user || busy}>{busy ? "Saving…" : editingId ? "Update snippet" : "Save snippet"}<span>→</span></button></div></div>
        </form>
        {notice && <p className="notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></p>}
      </section>

      <section className="saved-section">
        <div className="saved-heading"><div><p className="eyebrow">FROM THE COMMUNITY</p><h2>Saved snippets <span className="count">{snippets.length}</span></h2></div><div className="saved-tools"><label className="search-box"><span>⌕</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search snippets…" /></label>{user && <button className="button button-quiet export-button" onClick={deleteMySnippets}>Delete mine</button>}<button className="button button-quiet export-button" onClick={exportZip}>↓ <span>Export all</span></button></div></div>
        <div className="snippet-grid">{snippets.map((snippet) => <article className="snippet-card" key={snippet.id}><div className="snippet-card-head"><span className="language-pill">{snippet.language}</span><time>{new Date(snippet.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></div><h3>{snippet.title}</h3><p className="snippet-author">by <span>{snippet.author}</span></p><pre><code>{snippet.code}</code></pre><footer><button className="text-action" onClick={() => copy(snippet.code)}>Copy code <span>↗</span></button>{user?.id === snippet.ownerId && <div><button className="text-action" onClick={() => editSnippet(snippet)}>Edit</button><button className="text-action danger-action" onClick={() => deleteSnippet(snippet)}>Delete</button></div>}</footer></article>)}
          {!snippets.length && <div className="empty-state"><span>⌘</span><h3>{query ? "No matching snippets" : "A clean slate."}</h3><p>{query ? "Try another search term." : "The next useful snippet could be yours."}</p></div>}
        </div>
        {pages > 1 && <nav className="pagination" aria-label="Snippet pages"><button className="button button-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button className="button button-quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button></nav>}
      </section>
    </main>}
    <footer className="site-footer"><span><b className="footer-mark">&lt;/&gt;</b> CodeShare</span><span>Made for the things worth keeping.</span><span>© {new Date().getFullYear()} CodeShare</span></footer>
  </div>;
}
