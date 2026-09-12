import * as React from "react";
import dynamic from "next/dynamic";


const CodeMirrorComponent = dynamic(() => import("@uiw/react-codemirror").then(m => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-[300px] items-center justify-center bg-panel text-[11px] text-fg4">
      Loading editor…
    </div>
  ),
});


let _extCache = {};
function useLanguageExtension(language) {
  const [ext, setExt] = React.useState(_extCache[language || "html"] || null);
  React.useEffect(() => {
    const lang = language || "html";
    if (_extCache[lang]) { setExt(_extCache[lang]); return; }
    const loads = {
      html: () => import("@codemirror/lang-html").then(m => [m.html()]),
      javascript: () => import("@codemirror/lang-javascript").then(m => [m.javascript()]),
      json: () => import("@codemirror/lang-json").then(m => [m.json()]),
      css: () => import("@codemirror/lang-css").then(m => [m.css()]),
      markdown: () => import("@codemirror/lang-markdown").then(m => [m.markdown()]),
      text: () => Promise.resolve([]),
    };
    const loader = loads[lang] || loads.text;
    loader().then((e) => { _extCache[lang] = e; setExt(e); }).catch(() => setExt([]));
  }, [language]);
  return ext;
}


export function CodeEditor({ value, onChange, height = "300px", readOnly = false, language = "html" }) {
  const extensions = useLanguageExtension(language);
  const [cmTheme, setCmTheme] = React.useState("dark");

  React.useEffect(() => {
    const check = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setCmTheme(t === "light" ? "light" : "dark");
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overflow-hidden rounded-[6px] border border-stroke">
      <CodeMirrorComponent
        value={value}
        height={height}
        theme={cmTheme}
        extensions={extensions || []}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          autocompletion: !readOnly,
        }}
      />
    </div>
  );
}


export function TemplateEditor({ value, onChange, height = "300px" }) {
  const [showPreview, setShowPreview] = React.useState(true);
  const { isDesktop } = useResponsive();

  return (
    <div>
      <div className="mb-[6px] flex items-center gap-[6px]">
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-[4px] rounded-[5px] border border-stroke bg-raised px-[8px] py-[3px] text-[11px] text-fg3 hover:text-fg hover:bg-pressed"
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>
      <div
        className={
          showPreview && isDesktop
            ? "grid grid-cols-2 gap-[8px]"
            : showPreview
            ? "flex flex-col gap-[8px]"
            : "block"
        }
      >
        <CodeEditor value={value} onChange={onChange} height={height} />
        {showPreview ? (
          <div
            className="overflow-hidden rounded-[6px] border border-stroke bg-white"
            style={{ height }}
          >
            <iframe
              srcDoc={value}
              title="Preview"
              className="h-full w-full border-none"
              sandbox="allow-scripts"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useResponsive() {
  const [isDesktop, setIsDesktop] = React.useState(true);
  React.useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return { isDesktop };
}
