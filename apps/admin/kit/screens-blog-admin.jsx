/* ==========================================================================
 * TRI-917 · Blog / CMS admin screen. Authoring for the consumer /blog stories:
 * list (drafts + published), create, edit, publish/unpublish, delete. Bodies are
 * edited in a friendly plain-text form (## heading · - bullet · > photo credit)
 * that the backend round-trips to/from the stored block array (src/content.ts).
 *
 * Same seam as the other admin screens: reads window.TK_ADMIN.blog (fixtures or
 * live-hydrated) and routes every mutation through window.TK_ADMIN_ACT →
 * window.TK_ADMIN_API, which surfaces 401/403/validation in the DS toast. Flag
 * off (USE_LIVE_API=false) → the optimistic callbacks run synchronously and the
 * screen is the fixture prototype (byte-identical build).
 * ======================================================================== */
const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, Drawer, StatusBadge, Badge, Button, IconButton, Icon, EmptyState,
  FormField, Input, Select, Textarea, Switch, Toast } = NS;

const BLOG_ADMIN_TAGS = ["Destinations", "Heritage & Culture", "Practical", "First-time in Ghana", "Seasons & Weather"];

function blogStatusBadge(p) {
  return p.status === "published"
    ? <span className="tk-badge tk-badge--confirmed">Published</span>
    : <Badge tone="neutral">Draft</Badge>;
}

// TRI-953 · Hero image field: upload a file → POST /api/admin/media (TRI-918/928)
// → cdn.tripkoach.com URL, mirroring the tour gallery upload. The CDN URL is the
// canonical value (controlled via onChange); pasting a URL directly still works.
// Flag off / offline (LIVE=false) → a local object-URL preview, nothing persisted.
function BlogHeroField({ post, live, onChange, onError }) {
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const fileRef = React.useRef(null);
  const hero = post.hero || "";
  const pick = () => { if (fileRef.current) fileRef.current.click(); };
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // let the same file be re-picked after an error
    if (!file) return;
    if (!live) {
      let preview = ""; try { preview = (window.URL || window.webkitURL).createObjectURL(file); } catch (_) {}
      onChange(preview);
      return;
    }
    setUploading(true); setProgress(0);
    window.TK_ADMIN_API.uploadMedia(file, (pct) => setProgress(pct))
      .then((url) => { setUploading(false); setProgress(100); onChange(url); })
      .catch((err) => { setUploading(false); onError && onError((err && err.message) || "Upload failed"); });
  };
  return (
    <div className="tk-field">
      <label className="tk-label" htmlFor="blog-hero">Hero image</label>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ flex: "none", width: 96, height: 64, borderRadius: 8, overflow: "hidden", background: "var(--brand-wash)", border: "1px solid var(--border)", display: "grid", placeItems: "center" }}>
          {hero ? <img src={hero} alt="" style={{ objectFit: "cover", width: "100%", height: "100%" }} /> : <Icon name="image" size={18} />}
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button type="button" size="sm" variant="secondary" iconStart="upload" onClick={pick} disabled={uploading}>
              {uploading ? "Uploading… " + progress + "%" : (hero ? "Replace image" : "Upload image")}
            </Button>
            {hero && !uploading ? <IconButton icon="trash-2" label="Remove hero image" variant="ghost" size="sm" onClick={() => onChange("")} /> : null}
          </div>
          <Input id="blog-hero" value={hero} onChange={(e) => onChange(e.target.value)} placeholder="…or paste https://cdn.tripkoach.com/img/posts/…-hero.jpg" iconStart="link" aria-label="Hero image URL" />
        </div>
      </div>
      <p className="tk-help">Upload a JPG, PNG, WebP, or GIF — it’s stored on the CDN. You can also paste an image URL.</p>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: "none" }} onChange={onFile} />
    </div>
  );
}

function BlogAdmin({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const API = window.TK_ADMIN_API;
  const [rows, setRows] = React.useState(() => (window.TK_ADMIN && window.TK_ADMIN.blog) || []);
  const [edit, setEdit] = React.useState(null);   // { mode:'new'|'edit', post:{…} } | null
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  // Refresh the list from the live API (or fall back to the hydrated global).
  const refresh = React.useCallback(() => {
    if (LIVE && API && API.listBlog) {
      return API.listBlog().then((b) => {
        const posts = (b && (b.posts || b.items)) || (Array.isArray(b) ? b : []);
        setRows(posts);
        if (window.TK_ADMIN) window.TK_ADMIN.blog = posts;
      }, () => {});
    }
    setRows((window.TK_ADMIN && window.TK_ADMIN.blog) || []);
    return Promise.resolve();
  }, [LIVE, API]);

  const openNew = () => setEdit({ mode: "new", post: { status: "draft", tag: BLOG_ADMIN_TAGS[0], author: "TripKoach", bodyText: "" } });
  const openEdit = (row) => {
    if (LIVE && API && API.getBlog) {
      setBusy(true);
      API.getBlog(row.id).then((full) => { setBusy(false); setEdit({ mode: "edit", post: full || row }); }, () => { setBusy(false); setEdit({ mode: "edit", post: row }); });
    } else {
      setEdit({ mode: "edit", post: row });
    }
  };

  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  const save = () => {
    const post = edit.post;
    const rt = val("blog-readtime");
    const payload = {
      id: edit.mode === "edit" ? post.id : undefined,
      title: val("blog-title"),
      tag: post.tag || val("blog-tag") || null,
      excerpt: val("blog-excerpt"),
      hero: post.hero || "",   // controlled by BlogHeroField (upload → CDN URL, or pasted URL)
      heroAlt: val("blog-heroalt"),
      author: val("blog-author"),
      readTime: rt === "" ? null : +rt,
      bodyText: val("blog-body"),
      status: post.status === "published" ? "published" : "draft",
    };
    const slug = val("blog-slug").trim();
    if (slug) payload.slug = slug;
    window.TK_ADMIN_ACT(
      () => API.saveBlog(payload),
      () => { setToast(edit.mode === "edit" ? "Story saved" : "Story created"); setEdit(null); refresh(); },
    );
  };

  const togglePublish = (row) => window.TK_ADMIN_ACT(
    () => API.setBlogPublished(row.id, row.status !== "published"),
    () => { setToast(row.status === "published" ? "Moved to drafts" : "Published"); refresh(); },
  );
  const remove = (row) => {
    if (typeof window.confirm === "function" && !window.confirm('Delete "' + row.title + '"? This cannot be undone.')) return;
    window.TK_ADMIN_ACT(() => API.deleteBlog(row.id), () => { setToast("Story deleted"); refresh(); });
  };

  const post = edit && edit.post;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-tablewrap">
        <div className="tk-tabletools">
          <strong style={{ fontSize: 14 }}>{rows.length} {rows.length === 1 ? "story" : "stories"}</strong>
          <Button size="sm" iconStart="plus" style={{ marginInlineStart: "auto" }} onClick={openNew}>New story</Button>
        </div>
        <DataTable
          columns={[
            { key: "title", header: "Title", strong: true, render: r => (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "none", width: 40, height: 30, borderRadius: 6, overflow: "hidden", background: "var(--brand-wash)", display: "grid", placeItems: "center" }}>
                  {r.hero ? <img src={r.hero} alt="" width="40" height="30" style={{ objectFit: "cover", width: "100%", height: "100%" }} /> : <Icon name="image" size={14} />}
                </span>
                <span style={{ fontWeight: 700 }}>{r.title}</span>
              </span>) },
            { key: "tag", header: "Tag", render: r => r.tag ? <Badge tone="neutral">{r.tag}</Badge> : <span className="tk-caption">—</span> },
            { key: "status", header: "Status", render: r => blogStatusBadge(r) },
            { key: "date", header: "Published", render: r => <span className="tk-caption">{r.date || "—"}</span> },
            { key: "readTime", header: "Read", render: r => <span className="tk-caption">{r.readTime != null ? r.readTime + " min" : "—"}</span> },
          ]}
          rows={rows} getRowId={r => r.id || r.slug} onRowClick={openEdit}
          rowActions={(r) => (
            <span style={{ display: "inline-flex", gap: 2 }}>
              <IconButton icon="pencil" label={"Edit " + r.title} variant="ghost" size="sm" onClick={() => openEdit(r)} />
              <IconButton icon={r.status === "published" ? "eye-off" : "eye"} label={(r.status === "published" ? "Unpublish " : "Publish ") + r.title} variant="ghost" size="sm" onClick={() => togglePublish(r)} />
              <IconButton icon="trash-2" label={"Delete " + r.title} variant="ghost" size="sm" onClick={() => remove(r)} />
            </span>
          )}
          empty={<EmptyState icon="pencil" title="No stories yet" body="Write a guide or field note for the journal." action={<Button iconStart="plus" onClick={openNew}>New story</Button>} />} />
      </div>

      <Drawer open={!!edit} title={edit && edit.mode === "edit" ? "Edit story" : "New story"} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{edit && edit.mode === "edit" ? "Save story" : "Create story"}</Button></>}>
        {post && <>
          <FormField id="blog-title" label="Title" required><Input defaultValue={post.title} placeholder="Above the trees at Kakum…" /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField id="blog-tag" label="Tag"><Select defaultValue={post.tag || BLOG_ADMIN_TAGS[0]} onChange={(e) => setEdit({ ...edit, post: { ...post, tag: e.target.value } })} options={BLOG_ADMIN_TAGS.map(t => ({ value: t, label: t }))} /></FormField>
            <FormField id="blog-readtime" label="Read time (min)"><Input inputMode="numeric" defaultValue={post.readTime != null ? post.readTime : ""} placeholder="6" /></FormField>
          </div>
          <FormField id="blog-slug" label="Slug" help={edit.mode === "edit" ? "Changing the slug changes the story's URL." : "Leave blank to generate from the title."}><Input defaultValue={post.slug || ""} placeholder="kakum-canopy-walk" /></FormField>
          <FormField id="blog-excerpt" label="Excerpt" help="The summary shown on cards and at the top of the story."><Textarea defaultValue={post.excerpt} rows={3} placeholder="A one-paragraph teaser…" /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <BlogHeroField post={post} live={LIVE} onChange={(url) => setEdit({ ...edit, post: { ...post, hero: url } })} onError={(m) => setToast(m)} />
            <FormField id="blog-author" label="Author"><Input defaultValue={post.author || "TripKoach"} placeholder="TripKoach" /></FormField>
          </div>
          <FormField id="blog-heroalt" label="Hero alt text" help="Describe the image for screen readers."><Input defaultValue={post.heroAlt || ""} placeholder="A rope suspension bridge high in the forest canopy…" /></FormField>
          <FormField id="blog-body" label="Body" help="One idea per paragraph. Start a line with ## for a heading, - for a bullet, or > for a photo credit.">
            <Textarea defaultValue={post.bodyText != null ? post.bodyText : ""} rows={16} style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 13.5, lineHeight: 1.6 }} placeholder={"## What Kakum actually is\n\nAkwaaba. Most people come for the castles…\n\n- Wear closed shoes with grip.\n- Bring water and a small bag.\n\n> Hero photo: … via Wikimedia Commons, CC BY 4.0."} />
          </FormField>
          <Switch id="blog-published" label="Published (visible on the website)" checked={post.status === "published"} onChange={() => setEdit({ ...edit, post: { ...post, status: post.status === "published" ? "draft" : "published" } })} />
        </>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}
Object.assign(window, { BlogAdmin });
