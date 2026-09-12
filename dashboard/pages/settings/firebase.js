import * as React from "react";
import {
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  X,
  ChevronDown,
  FileText,
  Folder,
  Database,
} from "lucide-react";
import { SettingsShell, SettingsHeader, BackToOrganization } from "@/components/settings-shell";
import { api } from "@/lib-engine/api";
import { cx } from "@/components/ui";

const BAR_COLORS = [
  "#e5484d", "#a3a3a3", "#7a7a7a", "#575757", "#404040",
  "#e5484d", "#a3a3a3", "#7a7a7a", "#575757", "#404040",
];

export default function FirebaseSettingsPage() {
  const [collections, setCollections] = React.useState([]);
  const [projectId, setProjectId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [expandedColl, setExpandedColl] = React.useState(null);
  const [docs, setDocs] = React.useState([]);
  const [docsLoading, setDocsLoading] = React.useState(false);
  const [expandedDoc, setExpandedDoc] = React.useState(null);
  const [docData, setDocData] = React.useState(null);
  const [editingDoc, setEditingDoc] = React.useState(null);
  const [editValue, setEditValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  React.useEffect(() => {
    loadCollections();
  }, []);

  async function loadCollections() {
    setLoading(true);
    try {
      const res = await api.firebaseCollections();
      setCollections(res.collections || []);
      setProjectId(res.projectId || "");
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function toggleCollection(coll) {
    if (expandedColl === coll) {
      setExpandedColl(null);
      setDocs([]);
      setExpandedDoc(null);
      setDocData(null);
      return;
    }
    setExpandedColl(coll);
    setExpandedDoc(null);
    setDocData(null);
    setDocsLoading(true);
    try {
      const res = await api.firebaseDocs(coll);
      setDocs(res.docs || []);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }

  async function toggleDoc(coll, docId) {
    if (expandedDoc === docId) {
      setExpandedDoc(null);
      setDocData(null);
      return;
    }
    setExpandedDoc(docId);
    setDocData(null);
    setEditingDoc(null);
    try {
      const res = await api.firebaseDoc(coll, docId);
      setDocData(res.data);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  async function handleDeleteDoc(docId) {
    if (!confirm(`Delete document "${docId}" from "${expandedColl}"?`)) return;
    try {
      await api.firebaseDeleteDoc(expandedColl, docId);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      if (expandedDoc === docId) {
        setExpandedDoc(null);
        setDocData(null);
      }
      setMsg({ type: "success", text: `Deleted ${docId}` });
      loadCollections();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  async function handleDeleteCollection(coll) {
    if (!confirm(`Delete ALL documents in "${coll}"? This cannot be undone.`)) return;
    try {
      const res = await api.firebaseDeleteCollection(coll);
      setMsg({ type: "success", text: `Deleted ${res.deleted} documents from ${coll}` });
      if (expandedColl === coll) {
        setExpandedColl(null);
        setDocs([]);
        setExpandedDoc(null);
        setDocData(null);
      }
      loadCollections();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  async function handleSaveDoc() {
    if (!editingDoc || !expandedDoc) return;
    setSaving(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(editValue);
      } catch {
        setMsg({ type: "error", text: "Invalid JSON" });
        setSaving(false);
        return;
      }
      await api.firebaseUpdateDoc(expandedColl, expandedDoc, parsed);
      setDocData({ ...docData, ...parsed });
      setEditingDoc(null);
      setMsg({ type: "success", text: "Document updated" });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const maxCount = Math.max(1, ...collections.map((c) => c.count));
  const totalDocs = collections.reduce((sum, c) => sum + c.count, 0);

  return (
    <SettingsShell>
      <SettingsHeader crumb="Firebase" />
      <BackToOrganization />

      <div className="mx-auto w-full max-w-[960px] px-[16px] pb-[80px] pt-[14px] md:px-[24px]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-[8px] text-[17px] font-medium text-fg">
              <Database className="h-[16px] w-[16px] text-fg3" />
              Firebase
            </h1>
            <p className="mt-[2px] text-[12.5px] text-fg3">
              {projectId ? `Project: ${projectId}` : "Not configured"} — {totalDocs} documents across {collections.length} collections
            </p>
          </div>
          <button
            type="button"
            onClick={loadCollections}
            title="Reload"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-fg3 transition-colors hover:bg-line hover:text-fg"
          >
            <RefreshCw className={cx("h-[14px] w-[14px]", loading && "animate-spin")} />
          </button>
        </div>

        {msg ? (
          <div
            className={cx(
              "mt-[16px] rounded-[6px] px-[12px] py-[10px] text-[12.5px]",
              msg.type === "success" ? "bg-errorBg text-fg" : "bg-errorBg text-error"
            )}
          >
            {msg.text}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-[40px] flex items-center justify-center text-fg3">
            <Loader2 className="h-[20px] w-[20px] animate-spin" />
          </div>
        ) : (
          <div className="mt-[24px] space-y-[6px]">
            {collections.map((c, idx) => {
              const color = BAR_COLORS[idx % BAR_COLORS.length];
              const pct = (c.count / maxCount) * 100;
              const isExpanded = expandedColl === c.collection;
              return (
                <div key={c.collection} className="rounded-[6px] border border-line bg-surface">
                  {}
                  <div
                    className="group flex cursor-pointer items-center gap-[12px] p-[10px] transition-colors hover:bg-hover"
                    onClick={() => toggleCollection(c.collection)}
                  >
                    <Folder className="h-[14px] w-[14px] shrink-0 text-fg3" />
                    <span className="w-[140px] shrink-0 truncate font-mono text-[12px] text-fg2">{c.collection}</span>
                    <div className="relative h-[20px] flex-1 overflow-hidden rounded-[4px] bg-surface">
                      <div
                        className="h-full rounded-[4px] transition-all duration-300"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color, opacity: 0.7 }}
                      />
                      <span className="absolute left-[8px] top-0 flex h-full items-center text-[11px] font-medium text-fg">
                        {c.count} {c.count === 1 ? "doc" : "docs"}
                      </span>
                    </div>
                    {c.count > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteCollection(c.collection); }}
                        className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[4px] text-fg4 opacity-0 transition-opacity hover:bg-errorBorder hover:text-error group-hover:opacity-100"
                        title="Delete all docs"
                      >
                        <Trash2 className="h-[12px] w-[12px]" />
                      </button>
                    ) : null}
                    <ChevronDown
                      className={cx("h-[14px] w-[14px] shrink-0 text-fg4 transition-transform", isExpanded && "rotate-180")}
                    />
                  </div>

                  {}
                  {isExpanded ? (
                    <div className="border-t border-line p-[8px]">
                      {docsLoading ? (
                        <div className="flex items-center justify-center py-[16px] text-fg3">
                          <Loader2 className="h-[16px] w-[16px] animate-spin" />
                        </div>
                      ) : docs.length === 0 ? (
                        <div className="py-[12px] text-center text-[12px] text-fg3">No documents</div>
                      ) : (
                        <div className="space-y-[4px]">
                          {docs.map((d) => {
                            const docOpen = expandedDoc === d.id;
                            return (
                              <div
                                key={d.id}
                                className={cx(
                                  "rounded-[6px] border transition-colors",
                                  docOpen ? "border-stroke bg-line" : "border-line bg-surface hover:bg-hover"
                                )}
                              >
                                <div
                                  className="group flex cursor-pointer items-center gap-[8px] p-[8px]"
                                  onClick={() => toggleDoc(c.collection, d.id)}
                                >
                                  <FileText className="h-[12px] w-[12px] shrink-0 text-fg3" />
                                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg2">{d.id}</span>
                                  <ChevronDown
                                    className={cx("h-[12px] w-[12px] shrink-0 text-fg4 transition-transform", docOpen && "rotate-180")}
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(d.id); }}
                                    className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[3px] text-fg4 opacity-0 transition-opacity hover:bg-errorBorder hover:text-error group-hover:opacity-100"
                                  >
                                    <Trash2 className="h-[10px] w-[10px]" />
                                  </button>
                                </div>

                                {docOpen ? (
                                  <div className="border-t border-line p-[10px]">
                                    <div className="mb-[8px] flex items-center justify-between">
                                      <span className="text-[11px] font-medium uppercase tracking-wide text-fg4">
                                        Document data
                                      </span>
                                      {editingDoc ? (
                                        <div className="flex items-center gap-[6px]">
                                          <button
                                            type="button"
                                            onClick={() => setEditingDoc(false)}
                                            className="flex h-[24px] items-center gap-[4px] rounded-[5px] bg-pressed px-[8px] text-[11px] text-fg hover:bg-hover"
                                          >
                                            <X className="h-[10px] w-[10px]" /> Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={handleSaveDoc}
                                            disabled={saving}
                                            className="flex h-[24px] items-center gap-[4px] rounded-[5px] bg-errorBorder px-[8px] text-[11px] text-error hover:bg-errorBorder disabled:opacity-50"
                                          >
                                            {saving ? <Loader2 className="h-[10px] w-[10px] animate-spin" /> : <Save className="h-[10px] w-[10px]" />}
                                            Save
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditValue(JSON.stringify(docData, null, 2));
                                            setEditingDoc(true);
                                          }}
                                          disabled={!docData}
                                          className="flex h-[24px] items-center gap-[4px] rounded-[5px] bg-pressed px-[8px] text-[11px] text-fg hover:bg-hover disabled:opacity-50"
                                        >
                                          <Save className="h-[10px] w-[10px]" /> Edit
                                        </button>
                                      )}
                                    </div>

                                    {editingDoc ? (
                                      <textarea
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        rows={16}
                                        className="w-full rounded-[6px] border border-stroke bg-surface px-[10px] py-[8px] font-mono text-[11.5px] text-fg focus:border-accent/50 focus:outline-none"
                                      />
                                    ) : docData ? (
                                      <pre className="max-h-[360px] overflow-auto rounded-[6px] bg-surface p-[10px] font-mono text-[11px] leading-[16px] text-fg2">
                                        {JSON.stringify(docData, null, 2)}
                                      </pre>
                                    ) : (
                                      <div className="flex items-center justify-center py-[16px] text-fg3">
                                        <Loader2 className="h-[14px] w-[14px] animate-spin" />
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {collections.length === 0 ? (
              <div className="rounded-[8px] border border-line bg-surface p-[20px] text-center text-[12.5px] text-fg3">
                No collections found.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
