import * as React from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { cx } from "@/components/ui";
import api, { getPageContent, onContentChange, getContent, setContentCache } from "@/lib-engine/api";


export function useContent(page) {
  const [sections, setSections] = React.useState(getPageContent(page));

  React.useEffect(() => {
    const update = () => setSections(getPageContent(page));
    update();
    return onContentChange(update);
  }, [page]);

  return sections;
}


export function EditableText({
  page,
  section,
  defaultText,
  as: Tag = "span",
  className = "",
  multiline = false,
}) {
  const sections = useContent(page);
  const admin = true;
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const displayText = sections[section] ?? defaultText;

  React.useEffect(() => {
    setValue(displayText);
  }, [displayText, editing]);

  async function handleSave() {
    if (value === displayText) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateContent(page, { [section]: value });
      
      const cache = getContent();
      const pageContent = cache[page] || { sections: {} };
      pageContent.sections = { ...(pageContent.sections || {}), [section]: value };
      cache[page] = pageContent;
      setContentCache({ ...cache });
      setEditing(false);
    } catch {
      
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await api.resetContent(page, section);
      
      const cache = getContent();
      const pageContent = cache[page] || { sections: {} };
      if (pageContent.sections) delete pageContent.sections[section];
      cache[page] = pageContent;
      setContentCache({ ...cache });
      setValue(defaultText);
      setEditing(false);
    } catch {
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-[4px] align-baseline">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cx(
              "w-full rounded-[6px] border border-accent bg-raised px-[8px] py-[6px] text-[12.5px] text-fg outline-none",
              className
            )}
            rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
            autoFocus
            disabled={saving}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={cx(
              "rounded-[6px] border border-accent bg-raised px-[8px] py-[4px] text-[12.5px] text-fg outline-none",
              className
            )}
            autoFocus
            disabled={saving}
          />
        )}
        <span className="flex items-center gap-[4px]">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] bg-accent text-white hover:bg-accentHover"
            title="Save"
          >
            <Check className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => { setValue(displayText); setEditing(false); }}
            disabled={saving}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-stroke bg-raised text-fg3 hover:text-fg"
            title="Cancel"
          >
            <X className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
          {value !== defaultText ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-stroke bg-raised text-fg3 hover:text-fg"
              title="Reset to default"
            >
              <RotateCcw className="h-[11px] w-[11px]" strokeWidth={2} />
            </button>
          ) : null}
        </span>
      </span>
    );
  }

  return (
    <Tag className={cx("group/edit relative inline", className)}>
      {displayText}
    </Tag>
  );
}


export function EditableSection({ page, section, children, className = "" }) {
  return (
    <div className={cx("group/section relative", className)}>
      {children}
    </div>
  );
}
