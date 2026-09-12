"use strict";

(function () {
  if (window.__unidralToolbar) return;
  window.__unidralToolbar = true;

  var apiBase = "/__unidral/api";
  var siteConfig = null;
  var configLoading = null;
  var rules = [];
  var consoleLogs = [];
  var inspectMode = false;
  var selectedElement = null;
  var activeTab = "elements";

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (key === "style" && typeof props[key] === "object") {
          for (var s in props[key]) node.style[s] = props[key][s];
        } else if (key === "className") {
          node.className = props[key];
        } else if (key === "onclick") {
          node.onclick = props[key];
        } else if (key === "oninput") {
          node.oninput = props[key];
        } else if (key === "onchange") {
          node.onchange = props[key];
        } else if (key === "value") {
          node.value = props[key];
        } else if (key === "checked") {
          node.checked = props[key];
        } else if (key === "placeholder") {
          node.placeholder = props[key];
        } else if (key === "title") {
          node.title = props[key];
        } else if (key === "id") {
          node.id = props[key];
        } else {
          node.setAttribute(key, props[key]);
        }
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function log(msg, type) {
    consoleLogs.push({ time: new Date().toISOString(), msg: String(msg), type: type || "log" });
    if (consoleLogs.length > 200) consoleLogs.shift();
    if (activeTab === "console") renderConsole();
  }

  function loadSiteConfig() {
    if (configLoading) return configLoading;
    var host = location.host;
    configLoading = fetch(apiBase + "/sites?host=" + encodeURIComponent(host))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = data.sites || data || [];
        var site = list.find(function (s) { return host.indexOf(s.subdomain) >= 0; }) || list[0];
        if (site) {
          siteConfig = site;
          loadRules(site.id);
        }
        return siteConfig;
      })
      .catch(function (e) {
        log("Failed to load site config: " + e.message, "error");
      });
    return configLoading;
  }

  function loadRules(siteId) {
    fetch(apiBase + "/sites/" + siteId + "/rules")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        rules = data.rules || data || [];
        if (activeTab === "rules") renderRules();
      })
      .catch(function (e) { log("Failed to load rules: " + e.message, "error"); });
  }

  function saveRule(rule) {
    var url = apiBase + "/sites/" + siteConfig.id + "/rules";
    var method = rule.id ? "PUT" : "POST";
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    }).then(function (r) { return r.json(); });
  }

  function deleteRule(ruleId) {
    return fetch(apiBase + "/sites/" + siteConfig.id + "/rules/" + ruleId, {
      method: "DELETE"
    });
  }

  function cssPath(node) {
    if (!node || node.nodeType !== 1) return "";
    if (node.id) return "#" + node.id;
    var parts = [];
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === "string") {
        var cls = node.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (cls) part += "." + cls;
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(node) + 1;
          part += ":nth-of-type(" + idx + ")";
        }
      }
      parts.unshift(part);
      node = parent;
      if (parts.length > 10) break;
    }
    return parts.join(" > ");
  }

  function toggleInspect() {
    inspectMode = !inspectMode;
    document.body.style.cursor = inspectMode ? "crosshair" : "";
    if (inspectMode) {
      document.addEventListener("click", handleInspectClick, true);
      document.addEventListener("mouseover", handleInspectHover, true);
      document.addEventListener("mouseout", handleInspectOut, true);
    } else {
      document.removeEventListener("click", handleInspectClick, true);
      document.removeEventListener("mouseover", handleInspectHover, true);
      document.removeEventListener("mouseout", handleInspectOut, true);
      clearHighlight();
    }
    renderHeader();
  }

  function isToolbarNode(node) {
    while (node) {
      if (node.id === "unidral-root") return true;
      node = node.parentElement;
    }
    return false;
  }

  function handleInspectHover(e) {
    if (isToolbarNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    clearHighlight();
    highlight(e.target);
  }

  function handleInspectOut(e) {
    if (isToolbarNode(e.target)) return;
    clearHighlight();
  }

  function handleInspectClick(e) {
    if (isToolbarNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    selectedElement = e.target;
    inspectMode = false;
    document.body.style.cursor = "";
    document.removeEventListener("click", handleInspectClick, true);
    document.removeEventListener("mouseover", handleInspectHover, true);
    document.removeEventListener("mouseout", handleInspectOut, true);
    clearHighlight();
    activeTab = "elements";
    renderHeader();
    renderContent();
    log("Selected: " + cssPath(selectedElement));
  }

  var highlightEl = null;
  function highlight(node) {
    clearHighlight();
    if (!node || node.nodeType !== 1) return;
    highlightEl = document.createElement("div");
    highlightEl.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:1px solid #e5484d;background:rgba(229,72,77,0.1);transition:all 0.05s;";
    var rect = node.getBoundingClientRect();
    highlightEl.style.left = rect.left + "px";
    highlightEl.style.top = rect.top + "px";
    highlightEl.style.width = rect.width + "px";
    highlightEl.style.height = rect.height + "px";
    document.body.appendChild(highlightEl);
  }

  function clearHighlight() {
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
  }

  function buildDomTree(node, depth, container) {
    if (depth > 3) return;
    if (!node || node.nodeType !== 1) return;
    if (isToolbarNode(node)) return;

    var row = el("div", {
      className: "unidral-tree-row",
      onclick: function (e) {
        e.stopPropagation();
        selectedElement = node;
        renderContent();
      }
    });

    var indent = el("span", { className: "unidral-tree-indent" });
    indent.style.width = (depth * 12) + "px";

    var tag = el("span", { className: "unidral-tree-tag" }, node.tagName.toLowerCase());
    if (node.id) {
      tag.appendChild(el("span", { className: "unidral-tree-attr" }, "#" + node.id));
    }
    if (node.className && typeof node.className === "string") {
      var cls = node.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) tag.appendChild(el("span", { className: "unidral-tree-attr" }, "." + cls));
    }

    row.appendChild(indent);
    row.appendChild(tag);
    container.appendChild(row);

    var children = node.children;
    for (var i = 0; i < children.length && i < 20; i++) {
      var childContainer = el("div", { className: "unidral-tree-children" });
      container.appendChild(childContainer);
      buildDomTree(children[i], depth + 1, childContainer);
    }
  }

  var root = null;
  var headerEl = null;
  var contentEl = null;

  function init() {
    root = document.createElement("div");
    root.id = "unidral-root";
    root.style.cssText = "all:initial;position:fixed;bottom:0;left:0;right:0;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    document.body.appendChild(root);

    var style = document.createElement("style");
    style.textContent = getCSS();
    root.appendChild(style);

    var panel = el("div", { className: "unidral-panel" });
    root.appendChild(panel);

    headerEl = el("div", { className: "unidral-header" });
    panel.appendChild(headerEl);

    contentEl = el("div", { className: "unidral-content" });
    panel.appendChild(contentEl);

    renderHeader();
    renderContent();

    loadSiteConfig();
  }

  function renderHeader() {
    headerEl.innerHTML = "";
    var collapsed = contentEl.style.display === "none";

    var tabs = [
      { id: "elements", label: "Elements" },
      { id: "rules", label: "Rules" },
      { id: "console", label: "Console" },
    ];

    tabs.forEach(function (tab) {
      var btn = el("button", {
        className: "unidral-tab" + (activeTab === tab.id && !collapsed ? " active" : ""),
        onclick: function () {
          activeTab = tab.id;
          contentEl.style.display = "block";
          renderHeader();
          renderContent();
        }
      }, tab.label);
      headerEl.appendChild(btn);
    });

    var inspectBtn = el("button", {
      className: "unidral-icon-btn" + (inspectMode ? " active" : ""),
      title: "Inspect element",
      onclick: function (e) { e.stopPropagation(); toggleInspect(); }
    });
    inspectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>';
    headerEl.appendChild(inspectBtn);

    var collapseBtn = el("button", {
      className: "unidral-icon-btn",
      title: collapsed ? "Expand" : "Collapse",
      onclick: function (e) {
        e.stopPropagation();
        contentEl.style.display = collapsed ? "block" : "none";
        renderHeader();
      }
    });
    collapseBtn.innerHTML = collapsed
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 15l-6-6-6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M6 9l6 6 6-6"/></svg>';
    headerEl.appendChild(collapseBtn);
  }

  function renderContent() {
    contentEl.innerHTML = "";
    if (activeTab === "elements") renderElements();
    else if (activeTab === "rules") renderRules();
    else if (activeTab === "console") renderConsole();
  }

  function renderElements() {
    var container = el("div", { className: "unidral-tab-content" });

    if (selectedElement) {
      var info = el("div", { className: "unidral-info-bar" });
      info.appendChild(el("span", { className: "unidral-info-label" }, "Selected: "));
      info.appendChild(el("code", { className: "unidral-info-path" }, cssPath(selectedElement)));
      container.appendChild(info);

      var details = el("div", { className: "unidral-details" });
      details.appendChild(el("div", { className: "unidral-detail-row" }, [
        el("span", { className: "unidral-detail-key" }, "Tag: "),
        el("span", { className: "unidral-detail-val" }, selectedElement.tagName.toLowerCase())
      ]));
      if (selectedElement.id) {
        details.appendChild(el("div", { className: "unidral-detail-row" }, [
          el("span", { className: "unidral-detail-key" }, "ID: "),
          el("span", { className: "unidral-detail-val" }, selectedElement.id)
        ]));
      }
      if (selectedElement.className && typeof selectedElement.className === "string") {
        details.appendChild(el("div", { className: "unidral-detail-row" }, [
          el("span", { className: "unidral-detail-key" }, "Class: "),
          el("span", { className: "unidral-detail-val" }, selectedElement.className)
        ]));
      }
      var rect = selectedElement.getBoundingClientRect();
      details.appendChild(el("div", { className: "unidral-detail-row" }, [
        el("span", { className: "unidral-detail-key" }, "Size: "),
        el("span", { className: "unidral-detail-val" }, Math.round(rect.width) + "x" + Math.round(rect.height))
      ]));
      container.appendChild(details);

      var createRuleBtn = el("button", {
        className: "unidral-action-btn",
        onclick: function () {
          activeTab = "rules";
          renderHeader();
          renderContent();
          setTimeout(function () {
            var selectorInput = contentEl.querySelector("[data-field=selector]");
            if (selectorInput) selectorInput.value = cssPath(selectedElement);
          }, 10);
        }
      }, "Create rule from selection");
      container.appendChild(createRuleBtn);
    }

    var treeHeader = el("div", { className: "unidral-tree-header" }, "DOM Tree");
    container.appendChild(treeHeader);

    var tree = el("div", { className: "unidral-tree" });
    buildDomTree(document.body, 0, tree);
    container.appendChild(tree);

    contentEl.appendChild(container);
  }

  function renderRules() {
    var container = el("div", { className: "unidral-tab-content" });

    if (!siteConfig) {
      container.appendChild(el("div", { className: "unidral-empty" }, "Loading site config..."));
      contentEl.appendChild(container);
      return;
    }

    var form = el("form", {
      className: "unidral-rule-form",
      onsubmit: function (e) {
        e.preventDefault();
        var rule = {
          name: form.querySelector("[data-field=name]").value,
          selector: form.querySelector("[data-field=selector]").value,
          action: form.querySelector("[data-field=action]").value,
          event: form.querySelector("[data-field=event]").value,
          code: form.querySelector("[data-field=code]").value,
          path_pattern: form.querySelector("[data-field=path]").value || "*",
          enabled: true
        };
        saveRule(rule).then(function () {
          log("Rule saved: " + rule.name);
          loadRules(siteConfig.id);
          form.reset();
        }).catch(function (err) {
          log("Failed to save rule: " + err.message, "error");
        });
      }
    });

    form.appendChild(el("input", {
      "data-field": "name",
      className: "unidral-input",
      placeholder: "Rule name",
      type: "text"
    }));

    form.appendChild(el("input", {
      "data-field": "selector",
      className: "unidral-input",
      placeholder: "CSS selector (e.g. #login-btn)",
      type: "text"
    }));

    var row = el("div", { className: "unidral-form-row" });
    var actionSelect = el("select", { "data-field": "action", className: "unidral-select" });
    ["bind", "replace", "redirect"].forEach(function (a) {
      actionSelect.appendChild(el("option", { value: a }, a));
    });
    row.appendChild(actionSelect);

    var eventSelect = el("select", { "data-field": "event", className: "unidral-select" });
    ["click", "submit", "change", "input"].forEach(function (ev) {
      eventSelect.appendChild(el("option", { value: ev }, ev));
    });
    row.appendChild(eventSelect);

    var pathInput = el("input", {
      "data-field": "path",
      className: "unidral-input",
      placeholder: "Path pattern (* = all)",
      type: "text",
      value: "*"
    });
    row.appendChild(pathInput);
    form.appendChild(row);

    form.appendChild(el("textarea", {
      "data-field": "code",
      className: "unidral-textarea",
      placeholder: "// JavaScript code to execute when the rule triggers",
      rows: 3
    }));

    form.appendChild(el("button", { className: "unidral-save-btn", type: "submit" }, "Add rule"));
    container.appendChild(form);

    if (rules.length > 0) {
      var list = el("div", { className: "unidral-rules-list" });
      rules.forEach(function (rule) {
        var item = el("div", { className: "unidral-rule-item" + (rule.enabled === false ? " disabled" : "") });

        var info = el("div", { className: "unidral-rule-info" });
        info.appendChild(el("div", { className: "unidral-rule-name" }, rule.name || "(unnamed)"));
        info.appendChild(el("div", { className: "unidral-rule-meta" },
          (rule.selector || "?") + " · " + (rule.action || "?") + " · " + (rule.path_pattern || "*")));
        item.appendChild(info);

        var actions = el("div", { className: "unidral-rule-actions" });

        actions.appendChild(el("button", {
          className: "unidral-mini-btn",
          onclick: function () {
            saveRule(Object.assign({}, rule, { enabled: rule.enabled === false }))
              .then(function () { loadRules(siteConfig.id); })
              .catch(function (err) { log("Toggle failed: " + err.message, "error"); });
          }
        }, rule.enabled === false ? "Enable" : "Disable"));

        actions.appendChild(el("button", {
          className: "unidral-mini-btn danger",
          onclick: function () {
            if (confirm("Delete rule?")) {
              deleteRule(rule.id)
                .then(function () { loadRules(siteConfig.id); log("Rule deleted"); })
                .catch(function (err) { log("Delete failed: " + err.message, "error"); });
            }
          }
        }, "Delete"));

        item.appendChild(actions);
        list.appendChild(item);
      });
      container.appendChild(list);
    } else {
      container.appendChild(el("div", { className: "unidral-empty" }, "No rules configured"));
    }

    contentEl.appendChild(container);
  }

  function renderConsole() {
    var container = el("div", { className: "unidral-tab-content" });

    if (consoleLogs.length === 0) {
      container.appendChild(el("div", { className: "unidral-empty" }, "No logs yet"));
    } else {
      consoleLogs.forEach(function (entry) {
        var line = el("div", { className: "unidral-log-line " + (entry.type || "log") });
        line.appendChild(el("span", { className: "unidral-log-time" }, entry.time.split("T")[1].split(".")[0]));
        line.appendChild(el("span", { className: "unidral-log-msg" }, entry.msg));
        container.appendChild(line);
      });
    }

    var clearBtn = el("button", {
      className: "unidral-clear-btn",
      onclick: function () {
        consoleLogs = [];
        renderConsole();
      }
    }, "Clear");
    container.insertBefore(clearBtn, container.firstChild);

    contentEl.appendChild(container);
  }

  function getCSS() {
    return `
#unidral-root, #unidral-root * {
  all: initial;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.unidral-panel {
  position: relative;
  background: #0a0a0a;
  color: #e0e0e0;
  border-top: 1px solid #1a1a1a;
  font-size: 12px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
}
.unidral-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 32px;
  background: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
  flex-shrink: 0;
}
.unidral-tab {
  background: none;
  border: none;
  color: #888;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}
.unidral-tab:hover { color: #ccc; background: rgba(255,255,255,0.05); }
.unidral-tab.active { color: #e5484d; background: rgba(229,72,77,0.1); }
.unidral-icon-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}
.unidral-icon-btn:hover { color: #ccc; background: rgba(255,255,255,0.05); }
.unidral-icon-btn.active { color: #e5484d; background: rgba(229,72,77,0.1); }
.unidral-content {
  overflow-y: auto;
  max-height: 288px;
  padding: 8px;
}
.unidral-tab-content { display: flex; flex-direction: column; gap: 8px; }
.unidral-info-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #111;
  border-radius: 4px;
  font-size: 11px;
}
.unidral-info-label { color: #888; }
.unidral-info-path { color: #e5484d; font-family: 'SF Mono', Consolas, monospace; }
.unidral-details {
  background: #111;
  border-radius: 4px;
  padding: 8px;
  font-size: 11px;
}
.unidral-detail-row { display: flex; gap: 4px; padding: 2px 0; }
.unidral-detail-key { color: #888; min-width: 50px; }
.unidral-detail-val { color: #ccc; word-break: break-all; }
.unidral-action-btn {
  background: rgba(229,72,77,0.1);
  border: 1px solid rgba(229,72,77,0.3);
  color: #e5484d;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.unidral-action-btn:hover { background: rgba(229,72,77,0.2); }
.unidral-tree-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #666;
  padding: 4px 0;
}
.unidral-tree { font-family: 'SF Mono', Consolas, monospace; font-size: 11px; }
.unidral-tree-row {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 1px 0;
  cursor: pointer;
  border-radius: 2px;
}
.unidral-tree-row:hover { background: rgba(255,255,255,0.05); }
.unidral-tree-indent { flex-shrink: 0; }
.unidral-tree-tag { color: #e5484d; }
.unidral-tree-attr { color: #888; }
.unidral-tree-children { margin-left: 12px; }
.unidral-rule-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #111;
  border-radius: 4px;
  padding: 10px;
}
.unidral-input, .unidral-select {
  background: #0a0a0a;
  border: 1px solid #222;
  color: #ddd;
  padding: 5px 8px;
  border-radius: 3px;
  font-size: 11px;
  outline: none;
}
.unidral-input:focus, .unidral-select:focus { border-color: #e5484d; }
.unidral-textarea {
  background: #0a0a0a;
  border: 1px solid #222;
  color: #ddd;
  padding: 5px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'SF Mono', Consolas, monospace;
  resize: vertical;
  outline: none;
}
.unidral-textarea:focus { border-color: #e5484d; }
.unidral-form-row { display: flex; gap: 6px; }
.unidral-form-row > * { flex: 1; }
.unidral-save-btn {
  background: #e5484d;
  border: none;
  color: #fff;
  padding: 6px 12px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  align-self: flex-start;
}
.unidral-save-btn:hover { background: #c93d42; }
.unidral-rules-list { display: flex; flex-direction: column; gap: 4px; }
.unidral-rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #111;
  border-radius: 4px;
  padding: 6px 10px;
}
.unidral-rule-item.disabled { opacity: 0.5; }
.unidral-rule-info { flex: 1; min-width: 0; }
.unidral-rule-name { font-size: 11px; color: #ddd; }
.unidral-rule-meta { font-size: 10px; color: #666; font-family: 'SF Mono', Consolas, monospace; }
.unidral-rule-actions { display: flex; gap: 4px; }
.unidral-mini-btn {
  background: #1a1a1a;
  border: 1px solid #222;
  color: #888;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
}
.unidral-mini-btn:hover { color: #ccc; border-color: #333; }
.unidral-mini-btn.danger:hover { color: #e5484d; border-color: #e5484d; }
.unidral-empty { color: #555; font-size: 11px; padding: 8px; text-align: center; }
.unidral-log-line {
  display: flex;
  gap: 6px;
  padding: 2px 4px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 10px;
  border-bottom: 1px solid #111;
}
.unidral-log-time { color: #555; flex-shrink: 0; }
.unidral-log-msg { color: #aaa; word-break: break-all; }
.unidral-log-line.error .unidral-log-msg { color: #e5484d; }
.unidral-clear-btn {
  background: #1a1a1a;
  border: 1px solid #222;
  color: #888;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
  align-self: flex-end;
  margin-bottom: 4px;
}
.unidral-clear-btn:hover { color: #ccc; }
    `;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
