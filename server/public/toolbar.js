(function() {
  "use strict";
  if (window.__UNIDRAL_TOOLBAR__) return;
  var config = window.__UNIDRAL_CONFIG__ || {};
  var siteId = config.s || null;
  var apiBase = (config.a || "/__unidral/api").replace(/\/+$/, "");
  if (!siteId) {
    return;
  }
  function decodeB64Json(b64) {
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }
  var rules = [];
  try {
    if (config.r) {
      rules = decodeB64Json(config.r) || [];
    } else if (Array.isArray(config.rules)) {
      rules = config.rules.slice();
    }
  } catch (e) {
    rules = Array.isArray(config.rules) ? config.rules.slice() : [];
  }
  var trackedElements = [];
  var ruleTemplates = [];
  var bindings = [];
  var boundByRule = new Map;
  var loadSeenByRule = new Map;
  var compiledByRule = new Map;
  var failuresByRule = new Map;
  var trippedRules = new Set;
  var reanchoredRules = new Set;
  var MAX_RULE_FAILURES = 5;
  var inspecting = false;
  var dirty = false;
  var highlighted = null;
  var reapplyQueued = false;
  var activeTab = "elements";
  var selectedElement = null;
  var consoleEntries = [];
  var consolePaused = false;
  var panelHeight = 320;
  var panelExpanded = false;
  var domSearchQuery = "";
  var modifiedElements = new WeakSet;
  var trackHighlightTarget = null;
  var trackHighlightTimer = null;
  var TRIGGERS = [ "click", "hover", "load", "submit", "custom" ];
  var LOAD_TEMPLATE = "element.addEventListener('click', (event) => {\n  // your code here\n});\n";
  var HANDLER_TEMPLATE = "// `element`, `event` and `unidral` are available here.\nconsole.log('rule fired on', element);\n";
  var HTML_TEMPLATE = '\x3c!-- Paste HTML with tags. <script> tags will be executed. --\x3e\n<div class="my-injected-block">Hello</div>\n';
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function(key) {
        if (key === "class") node.className = props[key]; else if (key === "text") node.textContent = props[key]; else if (key === "html") node.innerHTML = props[key]; else if (key === "style") node.setAttribute("style", props[key]); else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2).toLowerCase(), props[key]); else if (key === "value" && (tag === "input" || tag === "textarea" || tag === "select")) { if (props[key] !== null && props[key] !== undefined) node.value = props[key]; } else if (key === "checked" && tag === "input") { if (props[key]) node.checked = true; } else if (key === "selected" && tag === "option") { if (props[key]) node.selected = true; } else if (props[key] !== null && props[key] !== undefined) node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach(function(child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }
  function apiCall(method, path, body) {
    var headers = {
      "content-type": "application/json"
    };
    return fetch(apiBase + path, {
      method: method,
      headers: headers,
      credentials: "omit",
      body: body ? JSON.stringify(body) : undefined
    }).then(function(response) {
      return response.json().catch(function() {
        return {};
      }).then(function(payload) {
        if (!response.ok) throw new Error(payload.error || "Request failed (" + response.status + ")");
        return payload;
      });
    });
  }
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function pathMatches(pagePath) {
    if (!pagePath || pagePath === "*") return true;
    var current = window.location.pathname;
    if (pagePath.indexOf("*") !== -1) {
      var pattern = pagePath.split("*").map(escapeRegExp).join(".*");
      try {
        return new RegExp("^" + pattern + "$").test(current);
      } catch (err) {
        return false;
      }
    }
    return pagePath === current;
  }
  function currentSubdomainPrefix() {
    var host = window.location.hostname;
    var dashIdx = host.indexOf("--");
    if (dashIdx > 0) {
      return host.slice(0, dashIdx);
    }
    var parts = host.split(".");
    if (parts.length > 2) return parts[0];
    return "";
  }
  function fingerprintOf(element) {
    if (!element || element.nodeType !== 1) return null;
    var attr = function(name) {
      var value = element.getAttribute(name);
      return value ? value.trim().slice(0, 120) : null;
    };
    var siblings = element.parentElement ? Array.prototype.filter.call(element.parentElement.children, function(child) {
      return child.tagName === element.tagName;
    }) : [];
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120) || null,
      id: element.id || null,
      name: attr("name"),
      type: attr("type"),
      role: attr("role"),
      testId: attr("data-testid") || attr("data-test-id") || attr("data-test"),
      ariaLabel: attr("aria-label"),
      href: attr("href"),
      classes: (element.getAttribute("class") || "").split(/\s+/).filter(function(name) {
        return name && name.indexOf("unidral") !== 0;
      }).slice(0, 8),
      index: siblings.length ? siblings.indexOf(element) : null
    };
  }
  function scoreCandidate(element, fingerprint) {
    var score = 0;
    var attr = function(name) {
      var value = element.getAttribute(name);
      return value ? value.trim() : null;
    };
    if (fingerprint.id && element.id === fingerprint.id) score += 5;
    if (fingerprint.testId && (attr("data-testid") === fingerprint.testId || attr("data-test") === fingerprint.testId)) {
      score += 5;
    }
    if (fingerprint.ariaLabel && attr("aria-label") === fingerprint.ariaLabel) score += 4;
    if (fingerprint.name && attr("name") === fingerprint.name) score += 3;
    if (fingerprint.href && attr("href") === fingerprint.href) score += 3;
    if (fingerprint.text) {
      var text = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
      if (text === fingerprint.text) score += 3; else if (text && fingerprint.text.indexOf(text) !== -1) score += 1;
    }
    if (fingerprint.role && attr("role") === fingerprint.role) score += 1;
    if (fingerprint.type && attr("type") === fingerprint.type) score += 1;
    if (fingerprint.classes && fingerprint.classes.length) {
      var classList = (element.getAttribute("class") || "").split(/\s+/);
      fingerprint.classes.forEach(function(name) {
        if (classList.indexOf(name) !== -1) score += 1;
      });
    }
    return score;
  }
  function reanchor(rule) {
    var fingerprint = rule.fingerprint;
    if (!fingerprint) return [];
    var candidates;
    try {
      candidates = document.querySelectorAll(fingerprint.tag || "*");
    } catch (err) {
      return [];
    }
    var best = null;
    var bestScore = 0;
    Array.prototype.forEach.call(candidates, function(node) {
      if (isToolbarNode(node)) return;
      var score = scoreCandidate(node, fingerprint);
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    });
    if (best && bestScore >= 3) {
      if (!reanchoredRules.has(rule.id)) {
        reanchoredRules.add(rule.id);
        logToConsole("Rule re-anchored (selector no longer matches): " + rule.selector, "warn");
      }
      return [ best ];
    }
    return [];
  }
  function cssPath(element) {
    if (!element || element.nodeType !== 1) return "";
    if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) return "#" + element.id;
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var selector = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift("#" + node.id);
        break;
      }
      var classes = (node.getAttribute("class") || "").split(/\s+/).filter(function(name) {
        return name && name.indexOf("unidral") !== 0 && /^[A-Za-z_-][\w-]*$/.test(name);
      }).slice(0, 2);
      if (classes.length) selector += "." + classes.join(".");
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function(child) {
          return child.tagName === node.tagName;
        });
        if (siblings.length > 1) selector += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(selector);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      node = parent;
    }
    return parts.join(" > ");
  }
  function logToConsole(message, level) {
    if (consolePaused) return;
    var entry = {
      time: (new Date).toLocaleTimeString(),
      level: level || "info",
      message: String(message)
    };
    consoleEntries.push(entry);
    if (consoleEntries.length > 500) consoleEntries.shift();
    renderConsole();
  }
  var root = el("div", {
    id: "unidral-root"
  });
  var toastLayer = el("div", {
    class: "unidral-toasts"
  });
  var statusDot = el("span", {
    class: "unidral-dot"
  });
  var badgeTitle = el("span", {
    class: "unidral-title",
    text: "Unidral"
  });
  var countBadge = el("span", {
    class: "unidral-badge",
    text: ""
  });
  countBadge.style.display = "none";
  var caret = el("span", {
    class: "unidral-caret",
    html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;display:block"><path d="M4 10l4-4 4 4"/></svg>'
  });
  var collapsedBar = el("div", {
    class: "unidral-collapsed-bar"
  }, [ statusDot, badgeTitle, countBadge, caret ]);
  var resizeHandle = el("div", {
    class: "unidral-resize-handle",
    title: "Drag to resize"
  });
  var TAB_ICONS = {
    elements: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 2.5l8 5.5-8 5.5z" fill="currentColor" stroke="none"/></svg>',
    files: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 4v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H7L5.5 3h-3a1 1 0 0 0-1 1z"/></svg>',
    edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2l3 3-8 8H3v-3z"/><path d="M9 4l3 3"/></svg>',
    inject: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 14l4-4M6 10l6-6 2 2-6 6z"/><path d="M9 3l4 4"/></svg>',
    headers: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12M2 6h12M2 9h7M2 12h7"/></svg>',
    rules: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4h10M3 8h10M3 12h10"/><circle cx="1.5" cy="4" r="0.5" fill="currentColor"/><circle cx="1.5" cy="8" r="0.5" fill="currentColor"/><circle cx="1.5" cy="12" r="0.5" fill="currentColor"/></svg>',

    console: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4l3 3-3 3M8 11h6"/></svg>'
  };
  var tabButtons = {};
  [ "elements", "files", "edit", "inject", "headers", "rules", "console" ].forEach(function(name) {
    tabButtons[name] = el("button", {
      type: "button",
      class: "unidral-tab-btn unidral-tab-icon-btn" + (name === "elements" ? " unidral-tab-active" : ""),
      "data-tab": name,
      title: name.charAt(0).toUpperCase() + name.slice(1),
      html: TAB_ICONS[name],
      onclick: function() {
        switchTab(name);
      }
    });
  });
  var inspectBtn = el("button", {
    type: "button",
    class: "unidral-icon-btn",
    title: "Inspect element",
    html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 2l3 10.5 1.8-4.2 4.2-1.8z" fill="currentColor"/><path d="M9 9.5l4 4"/></svg>',
    onclick: toggleInspect
  });
  var exportBtn = el("button", {
    type: "button",
    class: "unidral-icon-btn",
    title: "Export DOM snapshot",
    html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2 13h12"/></svg>',
    onclick: exportDomSnapshot
  });
  var closeBtn = el("button", {
    type: "button",
    class: "unidral-icon-btn",
    title: "Collapse panel",
    "aria-label": "Collapse panel",
    html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    onclick: function() {
      setExpanded(false);
    }
  });
  var tabBar = el("div", {
    class: "unidral-tab-bar"
  }, [ el("div", {
    class: "unidral-tabs-left"
  }, [ tabButtons.elements, tabButtons.files, tabButtons.edit, tabButtons.inject, tabButtons.headers, tabButtons.rules, tabButtons.console ]), el("div", {
    class: "unidral-tabs-right"
  }, [ exportBtn, inspectBtn, closeBtn ]) ]);
  function exportDomSnapshot() {
    try {
      var snapshot = {
        url: window.location.href,
        timestamp: (new Date).toISOString(),
        title: document.title,
        doctype: function() {
          var dt = document.doctype;
          if (!dt) return "";
          return "<!DOCTYPE " + dt.name + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : "") + (dt.systemId ? ' "' + dt.systemId + '"' : "") + ">";
        }(),
        html: document.documentElement.outerHTML,
        meta: {
          charset: document.characterSet || "UTF-8",
          viewport: (document.querySelector("meta[name=viewport]") || {}).content || "",
          description: (document.querySelector("meta[name=description]") || {}).content || ""
        }
      };
      var json = JSON.stringify(snapshot, null, 2);
      var blob = new Blob([ json ], {
        type: "application/json"
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      var safeTitle = (document.title || "page").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      a.download = "dom_snapshot_" + safeTitle + "_" + Date.now() + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("DOM snapshot exported", "success");
      logToConsole("DOM snapshot exported: " + snapshot.url, "success");
    } catch (err) {
      toast("Export failed: " + err.message, "error");
      logToConsole("DOM export error: " + err.message, "error");
    }
  }
  var elementsTab = el("div", {
    class: "unidral-tab-content unidral-tab-content-active"
  });
  var filesTab = el("div", {
    class: "unidral-tab-content"
  });
  var editTab = el("div", {
    class: "unidral-tab-content"
  });
  var injectTab = el("div", {
    class: "unidral-tab-content"
  });
  var headersTab = el("div", {
    class: "unidral-tab-content"
  });
  var rulesTab = el("div", {
    class: "unidral-tab-content"
  });
  var consoleTab = el("div", {
    class: "unidral-tab-content"
  });
  var tabContents = {
    elements: elementsTab,
    files: filesTab,
    edit: editTab,
    inject: injectTab,
    headers: headersTab,
    rules: rulesTab,
    console: consoleTab
  };
  var quickActions = buildQuickActions();
  var panelBody = el("div", {
    class: "unidral-panel-body"
  }, [ elementsTab, filesTab, editTab, injectTab, headersTab, rulesTab, consoleTab ]);
  var panel = el("div", {
    class: "unidral-panel"
  }, [ resizeHandle, tabBar, quickActions, panelBody ]);
  var highlightOverlay = el("div", {
    class: "unidral-highlight-overlay",
    hidden: "hidden"
  });
  root.appendChild(panel);
  root.appendChild(collapsedBar);
  root.appendChild(highlightOverlay);
  root.appendChild(toastLayer);
  [ "mousedown", "click", "pointerdown", "touchstart" ].forEach(function(type) {
    panel.addEventListener(type, function(event) {
      event.stopPropagation();
    });
    collapsedBar.addEventListener(type, function(event) {
      event.stopPropagation();
    });
  });
  panel.addEventListener("wheel", function(event) {
    event.stopPropagation();
    event.preventDefault();
    var node = event.target;
    while (node && node !== panel) {
      if (node.scrollHeight > node.clientHeight) {
        var goingUp = event.deltaY < 0;
        var atTop = node.scrollTop <= 0;
        var atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
        if (goingUp && !atTop || !goingUp && !atBottom) {
          node.scrollTop += event.deltaY;
        }
        return;
      }
      node = node.parentElement;
    }
  }, {
    passive: false
  });
  function qaBtn(label, iconSvg, onclick, shortcutKey) {
    var iconSpan = el("span", {
      html: iconSvg
    });
    var labelSpan = el("span", {
      text: label
    });
    var btn = el("button", {
      type: "button",
      class: "unidral-qa-btn",
      onclick: onclick
    }, [ iconSpan, labelSpan ]);
    if (shortcutKey) {
      btn.appendChild(el("span", {
        class: "unidral-qa-shortcut",
        text: shortcutKey
      }));
    }
    return btn;
  }
  function buildQuickActions() {
    var actions = [];
    var inspectQa = qaBtn("Inspect", '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="m11 11 3 3"/></svg>', function() {
      toggleInspect();
      inspectQa.classList.toggle("unidral-qa-active", inspecting);
    }, "⌘⇧I");
    actions.push(inspectQa);
    actions.push(qaBtn("Reload", '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12 2v3h-3M4 14v-3h3"/></svg>', function() {
      refreshRules();
      toast("Rules reloaded", "success");
    }, "⌘⇧R"));
    actions.push(el("div", {
      class: "unidral-qa-divider"
    }));
    actions.push(qaBtn("Snapshot", '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="8" cy="8" r="2.5"/></svg>', exportDomSnapshot));
    actions.push(qaBtn("Clear", '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5h10M5 5v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5M6 5V3h4v2"/></svg>', function() {
      consoleEntries = [];
      renderConsole();
      toast("Console cleared", "success");
    }));
    var pauseQa = qaBtn("Pause", '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="4" width="2" height="8"/><rect x="9" y="4" width="2" height="8"/></svg>', function() {
      consolePaused = !consolePaused;
      pauseQa.querySelector("span:nth-child(2)").textContent = consolePaused ? "Resume" : "Pause";
      pauseQa.classList.toggle("unidral-qa-active", consolePaused);
      toast(consolePaused ? "Console paused" : "Console resumed", "success");
    });
    actions.push(pauseQa);
    return el("div", {
      class: "unidral-quick-actions"
    }, actions);
  }
  var shortcutHint = el("div", {
    class: "unidral-shortcut-hint"
  });
  var hintTimer = null;
  function showShortcutHint(text) {
    shortcutHint.textContent = text;
    shortcutHint.classList.add("unidral-hint-visible");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function() {
      shortcutHint.classList.remove("unidral-hint-visible");
    }, 1500);
  }
  document.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      setExpanded(!panelExpanded);
      showShortcutHint(panelExpanded ? "Panel opened" : "Panel closed");
      return;
    }
    if (!panelExpanded) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      toggleInspect();
      showShortcutHint(inspecting ? "Inspect mode on" : "Inspect mode off");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      refreshRules();
      toast("Rules reloaded", "success");
      showShortcutHint("Rules reloaded");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      consoleEntries = [];
      renderConsole();
      showShortcutHint("Console cleared");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      exportDomSnapshot();
      showShortcutHint("DOM snapshot exported");
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && panelExpanded) {
      var tabMap = {
        1: "elements",
        2: "files",
        3: "edit",
        4: "inject",
        5: "headers",
        6: "rules",
        7: "console"
      };
      if (tabMap[e.key]) {
        e.preventDefault();
        switchTab(tabMap[e.key]);
        showShortcutHint("Tab: " + tabMap[e.key]);
      }
    }
  });
  var touchStartX = 0;
  var touchStartY = 0;
  var touchActive = false;
  panelBody.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchActive = true;
  }, {
    passive: true
  });
  panelBody.addEventListener("touchend", function(e) {
    if (!touchActive) return;
    touchActive = false;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * .5) return;
    var tabs = [ "elements", "files", "edit", "inject", "headers", "rules", "console" ];
    var idx = tabs.indexOf(activeTab);
    if (dx > 0 && idx > 0) {
      switchTab(tabs[idx - 1]);
    } else if (dx < 0 && idx < tabs.length - 1) {
      switchTab(tabs[idx + 1]);
    }
  }, {
    passive: true
  });
  function mount() {
    (document.body || document.documentElement).appendChild(root);
    root.appendChild(shortcutHint);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, {
    once: true
  });
  function updateMobileClass() {
    var mobile = window.innerWidth <= 768;
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 1024) mobile = true;
    } catch (e) {}
    root.classList.toggle("unidral-mobile", mobile);
  }
  updateMobileClass();
  window.addEventListener("resize", updateMobileClass);
  window.addEventListener("orientationchange", updateMobileClass);
  function ensureMounted() {
    if (!root.parentNode) mount();
  }
  function setExpanded(expanded) {
    panelExpanded = expanded;
    panel.classList.toggle("unidral-panel-open", expanded);
    collapsedBar.classList.toggle("unidral-collapsed-bar-hidden", expanded);
    if (!expanded) stopInspect();
  }
  collapsedBar.addEventListener("click", function() {
    setExpanded(true);
  });
  function switchTab(name) {
    activeTab = name;
    Object.keys(tabButtons).forEach(function(key) {
      tabButtons[key].classList.toggle("unidral-tab-active", key === name);
    });
    Object.keys(tabContents).forEach(function(key) {
      tabContents[key].classList.toggle("unidral-tab-content-active", key === name);
    });
    if (name === "elements") renderElements();
    if (name === "files") renderFilesTab();
    if (name === "edit") renderEditTab();
    if (name === "inject") renderInjectTab();
    if (name === "headers") renderHeadersTab();
    if (name === "rules") renderRulesTab();
    if (name === "console") renderConsole();
  }
  (function() {
    var dragging = false;
    var startY = 0;
    var startH = 0;
    function startDrag(clientY) {
      dragging = true;
      startY = clientY;
      startH = panelHeight;
    }
    function moveDrag(clientY) {
      if (!dragging) return;
      var delta = startY - clientY;
      panelHeight = Math.max(180, Math.min(window.innerHeight - 100, startH + delta));
      panel.style.setProperty("height", panelHeight + "px", "important");
    }
    function endDrag() {
      dragging = false;
    }
    resizeHandle.addEventListener("mousedown", function(e) {
      if (e.button !== 0) return;
      startDrag(e.clientY);
      e.preventDefault();
    });
    window.addEventListener("mousemove", function(e) {
      moveDrag(e.clientY);
    });
    window.addEventListener("mouseup", endDrag);
    resizeHandle.addEventListener("touchstart", function(e) {
      if (e.touches.length !== 1) return;
      startDrag(e.touches[0].clientY);
    }, {
      passive: true
    });
    window.addEventListener("touchmove", function(e) {
      if (!dragging) return;
      moveDrag(e.touches[0].clientY);
    }, {
      passive: true
    });
    window.addEventListener("touchend", endDrag);
  })();
  panel.style.setProperty("height", panelHeight + "px", "important");
  function isToolbarNode(node) {
    return Boolean(node) && (node === root || root.contains(node));
  }
  function clearHighlight() {
    if (highlighted) highlighted.classList.remove("unidral-highlight");
    highlighted = null;
  }
  function resolveEventTarget(event) {
    var path = event.composedPath ? event.composedPath() : null;
    if (path && path.length) {
      for (var i = 0; i < path.length; i++) {
        var node = path[i];
        if (node && node.nodeType === 1) return node;
      }
    }
    return event.target;
  }
  function onInspectMove(event) {
    var target = resolveEventTarget(event);
    if (!target || isToolbarNode(target)) return;
    if (highlighted === target) return;
    clearHighlight();
    highlighted = target;
    if (highlighted.classList) highlighted.classList.add("unidral-highlight");
  }
  function onInspectClick(event) {
    var target = resolveEventTarget(event);
    if (isToolbarNode(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    selectElement(target);
    stopInspect();
    switchTab("rules");
    setExpanded(true);
  }
  function onInspectKey(event) {
    if (event.key === "Escape") stopInspect();
  }
  function onInspectDown(event) {
    var target = resolveEventTarget(event);
    if (isToolbarNode(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }
  function startInspect() {
    if (inspecting) return;
    inspecting = true;
    inspectBtn.classList.add("unidral-active");
    document.documentElement.classList.add("unidral-inspecting");
    document.addEventListener("mouseover", onInspectMove, true);
    document.addEventListener("click", onInspectClick, true);
    document.addEventListener("mousedown", onInspectDown, true);
    document.addEventListener("pointerdown", onInspectDown, true);
    document.addEventListener("touchstart", onInspectDown, true);
    document.addEventListener("keydown", onInspectKey, true);
    logToConsole("Inspect mode on - click an element (Esc to cancel)", "info");
  }
  function stopInspect() {
    if (!inspecting) return;
    inspecting = false;
    inspectBtn.classList.remove("unidral-active");
    document.documentElement.classList.remove("unidral-inspecting");
    document.removeEventListener("mouseover", onInspectMove, true);
    document.removeEventListener("click", onInspectClick, true);
    document.removeEventListener("mousedown", onInspectDown, true);
    document.removeEventListener("pointerdown", onInspectDown, true);
    document.removeEventListener("touchstart", onInspectDown, true);
    document.removeEventListener("keydown", onInspectKey, true);
    clearHighlight();
  }
  function toggleInspect() {
    if (inspecting) stopInspect(); else {
      if (!panelExpanded) setExpanded(true);
      startInspect();
    }
  }
  var elementsTree = el("div", {
    class: "unidral-elements-tree"
  });
  var elementsCode = el("div", {
    class: "unidral-elements-code"
  });
  var elementsProps = el("div", {
    class: "unidral-elements-props"
  });
  var domSearchInput = el("input", {
    type: "text",
    class: "unidral-dom-search",
    placeholder: "Search DOM by text, selector, or attribute...",
    oninput: function() {
      domSearchQuery = this.value;
      renderElementsTree();
    }
  });
  elementsTab.appendChild(el("div", {
    class: "unidral-elements-layout"
  }, [ el("div", {
    class: "unidral-elements-left"
  }, [ el("div", {
    class: "unidral-dom-search-bar"
  }, [ domSearchInput ]), elementsTree ]), el("div", {
    class: "unidral-elements-right"
  }, [ el("div", {
    class: "unidral-elements-code-wrap"
  }, [ el("div", {
    class: "unidral-elements-code-header",
    text: "Markup"
  }), elementsCode ]), el("div", {
    class: "unidral-elements-props-wrap"
  }, [ el("div", {
    class: "unidral-elements-props-header",
    text: "Properties"
  }), elementsProps ]) ]) ]));
  function nodeLabel(node) {
    if (!node) return "";
    var tag = node.tagName ? node.tagName.toLowerCase() : "#text";
    var id = node.id ? "#" + node.id : "";
    var cls = "";
    if (node.getAttribute && node.getAttribute("class")) {
      var classes = node.getAttribute("class").split(/\s+/).filter(function(c) {
        return c && c.indexOf("unidral") !== 0;
      }).slice(0, 3);
      if (classes.length) cls = "." + classes.join(".");
    }
    var text = "";
    if (node.nodeType === 3) {
      text = (node.textContent || "").trim().slice(0, 30);
      if (text) text = '"' + text + '"'; else return "";
    }
    return tag + id + cls + text;
  }
  function nodeMatchesSearch(node) {
    if (!domSearchQuery) return true;
    var q = domSearchQuery.toLowerCase();
    var label = nodeLabel(node).toLowerCase();
    if (label.indexOf(q) !== -1) return true;
    try {
      if (node.matches && node.matches(domSearchQuery)) return true;
    } catch (err) {}
    if (node.attributes) {
      for (var i = 0; i < node.attributes.length; i++) {
        if ((node.attributes[i].name + "=" + node.attributes[i].value).toLowerCase().indexOf(q) !== -1) return true;
      }
    }
    return false;
  }
  function hasMatchingDescendant(node) {
    if (!node || !node.childNodes) return false;
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 1 || child.nodeType === 3) {
        if (nodeMatchesSearch(child)) return true;
        if (hasMatchingDescendant(child)) return true;
      }
    }
    return false;
  }
  function buildTreeNode(node, depth) {
    if (node.nodeType === 8) return null;
    if (node.nodeType === 3) {
      var text = (node.textContent || "").trim();
      if (!text) return null;
      if (domSearchQuery && !nodeMatchesSearch(node) && !hasMatchingDescendant(node)) return null;
      return el("div", {
        class: "unidral-tree-node unidral-tree-text",
        style: "padding-left:" + (depth * 16 + 8) + "px",
        text: '"' + text.slice(0, 50) + (text.length > 50 ? "..." : "") + '"',
        onclick: function(e) {
          e.stopPropagation();
          if (node.parentElement) selectElement(node.parentElement);
        }
      });
    }
    if (node.nodeType !== 1) return null;
    if (isToolbarNode(node)) return null;
    var matches = nodeMatchesSearch(node);
    var hasMatch = matches || hasMatchingDescendant(node);
    if (domSearchQuery && !hasMatch) return null;
    var hasRulesForNode = rules.some(function(r) {
      if (!r.enabled || trippedRules.has(r.id)) return false;
      try {
        return node.matches(r.selector);
      } catch (err) {
        return false;
      }
    });
    var label = nodeLabel(node);
    var isSelected = selectedElement === node;
    var childNodes = [];
    if (node.childNodes) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = buildTreeNode(node.childNodes[i], depth + 1);
        if (child) childNodes.push(child);
      }
    }
    var nodeEl = el("div", {
      class: "unidral-tree-node" + (isSelected ? " unidral-tree-selected" : "") + (hasRulesForNode ? " unidral-tree-modified" : ""),
      style: "padding-left:" + (depth * 16 + 8) + "px",
      onclick: function(e) {
        e.stopPropagation();
        selectElement(node);
      }
    }, [ el("span", {
      class: "unidral-tree-tag",
      text: "<" + label + ">"
    }), hasRulesForNode ? el("span", {
      class: "unidral-tree-badge",
      text: "R"
    }) : null ]);
    childNodes.forEach(function(c) {
      nodeEl.appendChild(c);
    });
    return nodeEl;
  }
  function renderElementsTree() {
    elementsTree.innerHTML = "";
    var tree = buildTreeNode(document.documentElement, 0);
    if (tree) elementsTree.appendChild(tree); else elementsTree.appendChild(el("div", {
      class: "unidral-empty",
      text: "No matching nodes"
    }));
  }
  function formatHtml(element) {
    if (!element) return "";
    var html = element.outerHTML || "";
    var lines = html.split(/(?=<)/);
    var result = [];
    var indent = 0;
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      if (line.indexOf("</") === 0) indent = Math.max(0, indent - 1);
      result.push({
        line: result.length + 1,
        indent: indent,
        text: "  ".repeat(indent) + line
      });
      if (line.indexOf("</") !== 0 && line.indexOf("/>") < 0 && /<[\w]+[^>]*>/.test(line) && line.indexOf("</") < 0) {
        if (!/<[\w]+[^>]*>[^<]*$/.test(line) && line.lastIndexOf(">") === line.length - 1) {
          indent++;
        } else if (/<[\w]+[^>]*>[^<]+<\/[\w]+>/.test(line)) {} else {
          indent++;
        }
      }
    });
    return result;
  }
  function renderElementCode() {
    elementsCode.innerHTML = "";
    if (!selectedElement) {
      elementsCode.appendChild(el("div", {
        class: "unidral-empty",
        text: "Select an element to view its markup"
      }));
      return;
    }
    var lines = formatHtml(selectedElement);
    var lineContainer = el("div", {
      class: "unidral-code-lines"
    });
    lines.forEach(function(entry) {
      lineContainer.appendChild(el("div", {
        class: "unidral-code-line"
      }, [ el("span", {
        class: "unidral-line-num",
        text: String(entry.line)
      }), el("span", {
        class: "unidral-line-content",
        text: entry.text
      }) ]));
    });
    elementsCode.appendChild(lineContainer);
  }
  function renderElementProps() {
    elementsProps.innerHTML = "";
    if (!selectedElement || selectedElement.nodeType !== 1) {
      elementsProps.appendChild(el("div", {
        class: "unidral-empty",
        text: "No element selected"
      }));
      return;
    }
    var el_ = selectedElement;
    var rect = el_.getBoundingClientRect();
    var props = [ [ "Tag", el_.tagName.toLowerCase() ], [ "ID", el_.id || "-" ], [ "Classes", (el_.getAttribute("class") || "").trim() || "-" ], [ "Selector", cssPath(el_) ], [ "Width", Math.round(rect.width) + "px" ], [ "Height", Math.round(rect.height) + "px" ], [ "Top", Math.round(rect.top) + "px" ], [ "Left", Math.round(rect.left) + "px" ], [ "Attributes", function() {
      var attrs = [];
      for (var i = 0; i < el_.attributes.length; i++) {
        var a = el_.attributes[i];
        if (a.name !== "class" && a.name !== "id") attrs.push(a.name + '="' + a.value + '"');
      }
      return attrs.length ? attrs.join(", ") : "-";
    }() ] ];
    props.forEach(function(row) {
      elementsProps.appendChild(el("div", {
        class: "unidral-prop-row"
      }, [ el("span", {
        class: "unidral-prop-label",
        text: row[0]
      }), el("span", {
        class: "unidral-prop-value",
        text: String(row[1])
      }) ]));
    });
  }
  function selectElement(element) {
    clearHighlight();
    selectedElement = element;
    if (element && element.classList) element.classList.add("unidral-highlight");
    highlighted = element;
    renderElementsTree();
    renderElementCode();
    renderElementProps();
    if (activeTab === "rules") renderRulesTab();
  }
  function renderElements() {
    renderElementsTree();
    renderElementCode();
    renderElementProps();
  }
  var ruleEditorState = null;
  try {
    if (config.rt) {
      ruleTemplates = decodeB64Json(config.rt) || [];
    }
  } catch (e) {
    ruleTemplates = [];
  }
  function renderRulesTab() {
    rulesTab.innerHTML = "";
    if (selectedElement) {
      var selector = cssPath(selectedElement);
      var selInfo = el("div", {
        class: "unidral-rules-selected"
      }, [ el("span", {
        class: "unidral-rules-selected-label",
        text: "Selected: "
      }), el("code", {
        class: "unidral-rules-selected-selector",
        text: selector
      }) ]);
      rulesTab.appendChild(selInfo);
    }
    var elementRules = rules.filter(function(r) {
      if (!pathMatches(r.page_path)) return false;
      if (!selectedElement) return false;
      try {
        return selectedElement.matches(r.selector);
      } catch (err) {
        return false;
      }
    });
    if (elementRules.length > 0) {
      var rulesListTitle = el("div", {
        class: "unidral-rules-section-title",
        text: "Rules on this element (" + elementRules.length + ")"
      });
      rulesTab.appendChild(rulesListTitle);
      elementRules.forEach(function(rule) {
        rulesTab.appendChild(buildRuleRow(rule));
      });
    }
    var pageRules = rules.filter(function(r) {
      return pathMatches(r.page_path);
    });
    var allRulesTitle = el("div", {
      class: "unidral-rules-section-title",
      text: "All rules on this page (" + pageRules.length + ")"
    });
    rulesTab.appendChild(allRulesTitle);
    if (pageRules.length === 0) {
      rulesTab.appendChild(el("div", {
        class: "unidral-empty",
        text: "No rules for this page yet. Click Inspect to create one."
      }));
    } else {
      pageRules.forEach(function(rule) {
        rulesTab.appendChild(buildRuleRow(rule));
      });
    }
    if (ruleEditorState) {
      rulesTab.appendChild(buildInlineEditor());
    } else {
      var newBtn = el("button", {
        type: "button",
        class: "unidral-btn unidral-btn-primary unidral-new-rule-btn",
        onclick: function() {
          openInlineEditor(null, selectedElement ? cssPath(selectedElement) : "");
        },
        html: "<span>+ New Rule</span>"
      });
      rulesTab.appendChild(newBtn);
    }
  }
  function buildRuleRow(rule) {
    var toggleBtn = el("button", {
      type: "button",
      class: "unidral-btn unidral-btn-sm " + (rule.enabled ? "unidral-btn-success" : ""),
      text: rule.enabled ? "On" : "Off",
      onclick: function() {
        apiCall("PATCH", "/rules/" + rule.id + "/toggle", {
          enabled: !rule.enabled,
          site_id: siteId
        }).then(function() {
          toast("Rule toggled", "success");
          return refreshRules();
        }).catch(function(err) {
          toast(err.message, "error");
        });
      }
    });
    var editBtn = el("button", {
      type: "button",
      class: "unidral-btn unidral-btn-sm",
      text: "Edit",
      onclick: function() {
        openInlineEditor(rule, rule.selector);
      }
    });
    var delBtn = el("button", {
      type: "button",
      class: "unidral-btn unidral-btn-sm unidral-btn-danger",
      text: "Del",
      onclick: function() {
        if (!window.confirm('Delete rule for "' + rule.selector + '"?')) return;
        apiCall("DELETE", "/rules/" + rule.id + "?site_id=" + encodeURIComponent(siteId)).then(function() {
          toast("Rule deleted", "success");
          return refreshRules();
        }).catch(function(err) {
          toast(err.message, "error");
        });
      }
    });
    var trackBtn = null;
    if (rule.enabled && !trippedRules.has(rule.id)) {
      trackBtn = el("button", {
        type: "button",
        class: "unidral-btn unidral-btn-sm unidral-btn-sync",
        text: "Sync",
        title: "Track this element across pages and subdomains",
        onclick: function() {
          createTrackedFromRule(rule);
        }
      });
    }
    var tripped = trippedRules.has(rule.id);
    return el("div", {
      class: "unidral-rule-row" + (rule.enabled && !tripped ? "" : " unidral-rule-off")
    }, [ el("div", {
      class: "unidral-rule-info"
    }, [ el("code", {
      class: "unidral-rule-selector",
      text: rule.selector,
      title: rule.selector
    }), el("span", {
      class: "unidral-rule-meta",
      text: rule.trigger + (rule.event_name ? " (" + rule.event_name + ")" : "") + " · " + rule.page_path + (tripped ? " · TRIPPED" : "")
    }) ]), el("div", {
      class: "unidral-rule-actions"
    }, [ trackBtn, toggleBtn, editBtn, delBtn ].filter(Boolean)) ]);
  }
  function openInlineEditor(rule, presetSelector) {
    var fingerprint = selectedElement ? fingerprintOf(selectedElement) : rule && rule.fingerprint || null;
    ruleEditorState = {
      rule: rule || null,
      fingerprint: fingerprint,
      selector: rule && rule.selector || presetSelector || "",
      trigger: rule && rule.trigger || "load",
      behavior: rule && rule.behavior || "augment",
      eventName: rule && rule.event_name || "",
      pagePath: rule && rule.page_path || "*",
      code: rule && rule.code || LOAD_TEMPLATE,
      codeType: rule && rule.code_type || "js",
      syncAcross: false
    };
    renderRulesTab();
  }
  function closeInlineEditor() {
    ruleEditorState = null;
    renderRulesTab();
  }
  function buildInlineEditor() {
    var s = ruleEditorState;
    var selectorInput = el("input", {
      type: "text",
      class: "unidral-input",
      value: s.selector,
      placeholder: ".checkout-button",
      oninput: function() {
        s.selector = this.value;
      }
    });
    var eventField = null;
    var triggerSelect = el("select", {
      class: "unidral-input",
      onchange: function() {
        s.trigger = this.value;
        updateTemplate();
        if (eventField) eventField.style.display = s.trigger === "custom" ? "" : "none";
      }
    }, TRIGGERS.map(function(t) {
      return el("option", {
        value: t,
        text: t,
        selected: s.trigger === t ? "selected" : null
      });
    }));
    var behaviorSelect = el("select", {
      class: "unidral-input",
      onchange: function() {
        s.behavior = this.value;
      }
    }, [ "augment", "override" ].map(function(b) {
      return el("option", {
        value: b,
        text: b === "augment" ? "augment (keep original)" : "override (replace original)",
        selected: s.behavior === b ? "selected" : null
      });
    }));
    var eventInput = el("input", {
      type: "text",
      class: "unidral-input",
      value: s.eventName,
      placeholder: "my:custom-event",
      oninput: function() {
        s.eventName = this.value;
      }
    });
    var currentPath = window.location.pathname || "/";
    var pathPresets = [ {
      value: "*",
      label: "All pages"
    }, {
      value: currentPath,
      label: "This page only (" + currentPath + ")"
    }, {
      value: "custom",
      label: "Custom path…"
    } ];
    var pathSelectValue;
    if (s.pagePath === "*") pathSelectValue = "*"; else if (s.pagePath === currentPath) pathSelectValue = currentPath; else pathSelectValue = "custom";
    var pathCustomInput = el("input", {
      type: "text",
      class: "unidral-input",
      value: s.pagePath === "*" || s.pagePath === currentPath ? "" : s.pagePath,
      placeholder: "/checkout or /products/*",
      oninput: function() {
        s.pagePath = this.value;
      }
    });
    var pathCustomField = el("div", {
      class: "unidral-field",
      style: "margin-top:6px" + (pathSelectValue === "custom" ? "" : ";display:none")
    }, [ pathCustomInput ]);
    var pathSelect = el("select", {
      class: "unidral-input",
      onchange: function() {
        var val = this.value;
        if (val === "custom") {
          s.pagePath = pathCustomInput.value || "";
          pathCustomField.style.display = "";
        } else {
          s.pagePath = val;
          pathCustomInput.value = "";
          pathCustomField.style.display = "none";
        }
      }
    }, pathPresets.map(function(p) {
      return el("option", {
        value: p.value,
        text: p.label,
        selected: p.value === pathSelectValue ? "selected" : null
      });
    }));
    var codeInput = el("textarea", {
      class: "unidral-code-input",
      spellcheck: "false",
      text: s.code,
      placeholder: s.codeType === "html" ? "Paste HTML with tags here. <script> tags will be executed." : "JavaScript code. `element`, `event`, `unidral` are available.",
      oninput: function() {
        s.code = this.value;
      }
    });
    codeInput.addEventListener("keydown", function(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = this.selectionStart;
        this.setRangeText("  ", start, this.selectionEnd, "end");
      }
    });
    var codeTypeJsBtn = el("button", {
      type: "button",
      class: "unidral-code-type-btn" + (s.codeType === "js" ? " active" : ""),
      text: "JS",
      onclick: function() {
        s.codeType = "js";
        if (s.code === HTML_TEMPLATE) s.code = LOAD_TEMPLATE;
        codeInput.value = s.code;
        codeInput.setAttribute("placeholder", "JavaScript code. `element`, `event`, `unidral` are available.");
        codeTypeJsBtn.classList.add("active");
        codeTypeHtmlBtn.classList.remove("active");
      }
    });
    var codeTypeHtmlBtn = el("button", {
      type: "button",
      class: "unidral-code-type-btn" + (s.codeType === "html" ? " active" : ""),
      text: "HTML",
      onclick: function() {
        s.codeType = "html";
        if (s.code === LOAD_TEMPLATE || s.code === HANDLER_TEMPLATE) s.code = HTML_TEMPLATE;
        codeInput.value = s.code;
        codeInput.setAttribute("placeholder", "Paste HTML with tags here. <script> tags will be executed.");
        codeTypeHtmlBtn.classList.add("active");
        codeTypeJsBtn.classList.remove("active");
      }
    });
    var codeTypeToggle = el("div", {
      class: "unidral-code-type-toggle"
    }, [ codeTypeJsBtn, codeTypeHtmlBtn ]);
    var templateSelect = el("select", {
      class: "unidral-input",
      onchange: function() {
        var id = this.value;
        if (!id) return;
        var tmpl = ruleTemplates.find(function(t) {
          return t.id === id;
        });
        if (!tmpl) return;
        s.trigger = tmpl.trigger;
        s.behavior = tmpl.behavior;
        s.code = tmpl.code;
        triggerSelect.value = s.trigger;
        behaviorSelect.value = s.behavior;
        codeInput.value = s.code;
        eventField.style.display = s.trigger === "custom" ? "" : "none";
      }
    }, [ el("option", {
      value: "",
      text: "- Templates -"
    }) ].concat(ruleTemplates.map(function(t) {
      return el("option", {
        value: t.id,
        text: t.label
      });
    })));
    eventField = el("div", {
      class: "unidral-field",
      style: s.trigger === "custom" ? "" : "display:none"
    }, [ el("label", {
      text: "Custom event name"
    }), eventInput ]);
    function updateTemplate() {
      if (s.rule) return;
      var isTemplate = s.code === LOAD_TEMPLATE || s.code === HANDLER_TEMPLATE;
      if (isTemplate) {
        s.code = s.trigger === "load" ? LOAD_TEMPLATE : HANDLER_TEMPLATE;
        codeInput.value = s.code;
      }
    }
    var syncCheckbox = el("input", {
      type: "checkbox",
      id: "unidral-sync",
      checked: s.syncAcross ? "checked" : null,
      onchange: function() {
        s.syncAcross = this.checked;
        if (this.checked) {
          s.pagePath = "*";
          pathSelect.value = "*";
          pathCustomField.style.display = "none";
        }
      }
    });
    var syncLabel = el("label", {
      class: "unidral-sync-label"
    }, [ syncCheckbox, el("span", {
      text: " Sync across all pages and subdomains"
    }) ]);
    var saveBtn = el("button", {
      type: "button",
      class: "unidral-btn unidral-btn-primary",
      text: "Save",
      onclick: submitInlineEditor
    });
    var cancelBtn = el("button", {
      type: "button",
      class: "unidral-btn",
      text: "Cancel",
      onclick: closeInlineEditor
    });
    var previewBtn = el("button", {
      type: "button",
      class: "unidral-btn unidral-btn-preview",
      text: "Preview (5s)",
      onclick: livePreview
    });
    return el("div", {
      class: "unidral-inline-editor"
    }, [ el("div", {
      class: "unidral-editor-title",
      text: s.rule ? "Edit rule" : "New rule"
    }), el("div", {
      class: "unidral-field"
    }, [ el("label", {
      text: "CSS selector"
    }), selectorInput ]), el("div", {
      class: "unidral-field-row"
    }, [ el("div", {
      class: "unidral-field"
    }, [ el("label", {
      text: "Trigger"
    }), triggerSelect ]), el("div", {
      class: "unidral-field"
    }, [ el("label", {
      text: "Page scope"
    }), pathSelect, pathCustomField ]) ]), el("div", {
      class: "unidral-field"
    }, [ el("label", {
      text: "Behavior"
    }), behaviorSelect ]), eventField, el("div", {
      class: "unidral-field"
    }, [ el("label", {
      text: "Template"
    }), templateSelect ]), el("div", {
      class: "unidral-field"
    }, [ el("div", {
      class: "unidral-code-field-header"
    }, [ el("label", {
      text: s.codeType === "html" ? "HTML" : "JavaScript"
    }), codeTypeToggle ]), codeInput, el("div", {
      class: "unidral-meta",
      text: s.codeType === "html" ? "Paste HTML with tags. <script> tags are executed. HTML is injected into each matched element." : 'trigger "load" runs once per matched element; other triggers run as the event handler body.'
    }) ]), el("div", {
      class: "unidral-sync-row"
    }, [ syncLabel ]), el("div", {
      class: "unidral-editor-actions"
    }, [ previewBtn, cancelBtn, saveBtn ]) ]);
  }
  function livePreview() {
    if (!ruleEditorState) return;
    var s = ruleEditorState;
    if (!s.selector || !s.code.trim()) {
      toast("Selector and code are required for preview", "error");
      return;
    }
    var nodes;
    try {
      nodes = document.querySelectorAll(s.selector);
    } catch (err) {
      toast("Invalid selector: " + s.selector, "error");
      return;
    }
    if (!nodes.length) {
      toast("No elements match selector: " + s.selector, "error");
      return;
    }
    if (s.codeType === "html") {
      Array.prototype.forEach.call(nodes, function(node) {
        try {
          injectHtml(node, s.code);
          modifiedElements.add(node);
        } catch (err) {
          toast("Preview error: " + err.message, "error");
        }
      });
    } else {
      var fn;
      try {
        fn = new Function("element", "event", "unidral", s.code);
      } catch (err) {
        toast("Code error: " + err.message, "error");
        return;
      }
      Array.prototype.forEach.call(nodes, function(node) {
        try {
          fn.call(node, node, null, {
            toast: toast,
            config: config
          });
          modifiedElements.add(node);
        } catch (err) {
          toast("Preview error: " + err.message, "error");
        }
      });
    }
    toast("Preview applied - reverting in 5s...", "info");
    logToConsole("Live preview applied to " + nodes.length + " element(s)", "info");
    setTimeout(function() {
      toast("Reverting preview...", "info");
      window.location.reload();
    }, 5e3);
  }
  function submitInlineEditor() {
    if (!ruleEditorState) return;
    var s = ruleEditorState;
    if (!s.selector.trim()) {
      toast("A CSS selector is required", "error");
      return;
    }
    if (!s.code.trim()) {
      toast("Rule code cannot be empty", "error");
      return;
    }
    try {
      document.querySelector(s.selector);
    } catch (err) {
      toast("Invalid CSS selector: " + s.selector, "error");
      return;
    }
    var payload = {
      site_id: siteId,
      selector: s.selector.trim(),
      trigger: s.trigger,
      behavior: s.behavior,
      event_name: s.eventName.trim() || null,
      page_path: s.pagePath.trim() || "*",
      code: s.code,
      code_type: s.codeType || "js",
      fingerprint: s.fingerprint
    };
    var existing = s.rule;
    var request = existing ? apiCall("PUT", "/rules/" + existing.id + "?site_id=" + encodeURIComponent(siteId), payload) : apiCall("POST", "/rules", payload);
    request.then(function(savedRule) {
      toast("Rule saved", "success");
      logToConsole("Rule saved: " + payload.selector, "success");
      if (s.syncAcross && s.fingerprint) {
        return createTrackedElement({
          selector: payload.selector,
          fingerprint: s.fingerprint,
          label: s.selector.trim(),
          origin_path: window.location.pathname,
          origin_prefix: currentSubdomainPrefix(),
          rule_ids: [ savedRule.id ]
        }).then(function() {
          closeInlineEditor();
          return refreshRules();
        });
      }
      closeInlineEditor();
      return refreshRules();
    }).catch(function(err) {
      toast(err.message, "error");
    });
  }
  function loadTrackedElements() {
    return apiCall("GET", "/sites/" + siteId + "/tracked-elements").then(function(list) {
      trackedElements = Array.isArray(list) ? list : [];
      updateCountBadge();
      return trackedElements;
    }).catch(function() {
      trackedElements = [];
      return trackedElements;
    });
  }
  function createTrackedElement(data) {
    return apiCall("POST", "/sites/" + siteId + "/tracked-elements", data).then(function(tracked) {
      toast("Element tracked - will sync across pages", "success");
      logToConsole("Tracked element created: " + data.selector, "success");
      loadTrackedElements().then(function() {

      });
      return tracked;
    });
  }
  function createTrackedFromRule(rule) {
    var element = null;
    try {
      element = document.querySelector(rule.selector);
    } catch (err) {}
    var fingerprint = element ? fingerprintOf(element) : rule.fingerprint;
    createTrackedElement({
      selector: rule.selector,
      fingerprint: fingerprint,
      label: rule.selector,
      origin_path: window.location.pathname,
      origin_prefix: currentSubdomainPrefix(),
      rule_ids: [ rule.id ]
    });
  }
  function reportTrackedFound(trackId) {
    apiCall("POST", "/track/report", {
      trackId: trackId,
      path: window.location.pathname,
      prefix: currentSubdomainPrefix()
    }).catch(function(err) {
      logToConsole("track:report failed: " + err.message, "warn");
    });
  }

  var siteConfig = null;
  var siteConfigLoading = false;
  var siteConfigPromise = null;
  function loadSiteConfig() {
    if (siteConfig) return Promise.resolve(siteConfig);
    if (siteConfigPromise) return siteConfigPromise;
    siteConfigLoading = true;
    siteConfigPromise = apiCall("GET", "/sites/" + encodeURIComponent(siteId)).then(function(s) {
      siteConfig = s;
      siteConfigLoading = false;
      return s;
    }).catch(function(err) {
      siteConfigLoading = false;
      siteConfigPromise = null;
      toast("Could not load site config: " + err.message, "error");
      return null;
    });
    return siteConfigPromise;
  }
  function saveSiteConfig(changes) {
    return apiCall("PUT", "/sites/" + encodeURIComponent(siteId), changes).then(function(s) {
      siteConfig = s;
      toast("Saved", "success");
      return s;
    }).catch(function(err) {
      toast("Save failed: " + err.message, "error");
      throw err;
    });
  }
  function genId() {
    return "ov_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }
  function buildField(labelText, value, onChange) {
    var input = el("input", { type: "text", class: "unidral-input", value: value || "" });
    input.addEventListener("input", function() { onChange(input.value); });
    return el("div", { class: "unidral-field" }, [ el("label", { text: labelText }), input ]);
  }
  function buildFieldRow(labelText, control) {
    return el("div", { class: "unidral-field" }, [ el("label", { text: labelText }), control ]);
  }
  function buildActionsBar(rule, onSave, onDelete) {
    var actions = el("div", { class: "unidral-rule-actions" });
    var toggleBtn = el("button", {
      type: "button", class: "unidral-btn-sm " + (rule.enabled ? "unidral-btn-success" : ""), text: rule.enabled ? "ON" : "OFF",
      onclick: function() { rule.enabled = !rule.enabled; onSave(rule); }
    });
    var saveBtn = el("button", { type: "button", class: "unidral-btn-sm unidral-btn-primary", text: "Save", onclick: function() { onSave(rule); } });
    var delBtn = el("button", { type: "button", class: "unidral-btn-sm unidral-btn-danger", text: "Delete", onclick: function() { onDelete(); } });
    actions.appendChild(toggleBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(delBtn);
    return actions;
  }
  function buildOverrideRow(rule, type, onSave, onDelete) {
    var row = el("div", { class: "unidral-override-row" });
    var fields = el("div", { class: "unidral-override-fields" });
    if (type === "dom") {
      fields.appendChild(buildField("Selector", rule.selector, function(v) { rule.selector = v; }));
      var actionSelect = el("select", {});
      [ "remove", "hide", "show", "replace", "set-attr", "set-style", "set-html", "set-text" ].forEach(function(a) {
        actionSelect.appendChild(el("option", { value: a, text: a, selected: a === rule.action ? "selected" : null }));
      });
      actionSelect.addEventListener("change", function() { rule.action = actionSelect.value; });
      fields.appendChild(buildFieldRow("Action", actionSelect));
      fields.appendChild(buildField("Value", rule.value, function(v) { rule.value = v; }));
    } else if (type === "css") {
      fields.appendChild(buildField("Selector", rule.selector, function(v) { rule.selector = v; }));
      fields.appendChild(buildField("Property", rule.property, function(v) { rule.property = v; }));
      fields.appendChild(buildField("Value", rule.value, function(v) { rule.value = v; }));
    } else if (type === "js") {
      var codeArea = el("textarea", { class: "unidral-code-input", placeholder: "JS code" });
      codeArea.value = rule.code || "";
      codeArea.addEventListener("input", function() { rule.code = codeArea.value; });
      fields.appendChild(el("div", { class: "unidral-field" }, [ el("label", { text: "Code" }), codeArea ]));
    } else if (type === "path") {
      fields.appendChild(buildField("Path Pattern", rule.path_pattern, function(v) { rule.path_pattern = v; }));
      var pActionSelect = el("select", {});
      [ "block", "redirect", "custom-response" ].forEach(function(a) {
        pActionSelect.appendChild(el("option", { value: a, text: a, selected: a === rule.action ? "selected" : null }));
      });
      pActionSelect.addEventListener("change", function() { rule.action = pActionSelect.value; });
      fields.appendChild(buildFieldRow("Action", pActionSelect));
      fields.appendChild(buildField("Redirect URL", rule.redirect_url || "", function(v) { rule.redirect_url = v; }));
      fields.appendChild(buildField("Response Body", rule.response_body || "", function(v) { rule.response_body = v; }));
      var statusInput = el("input", { type: "number", value: String(rule.response_status || 404) });
      statusInput.addEventListener("input", function() { rule.response_status = parseInt(statusInput.value) || 404; });
      fields.appendChild(buildFieldRow("Status", statusInput));
    } else if (type === "header") {
      fields.appendChild(buildField("Header Name", rule.header, function(v) { rule.header = v; }));
      var hActionSelect = el("select", {});
      [ "set", "remove", "append" ].forEach(function(a) {
        hActionSelect.appendChild(el("option", { value: a, text: a, selected: a === rule.action ? "selected" : null }));
      });
      hActionSelect.addEventListener("change", function() { rule.action = hActionSelect.value; });
      fields.appendChild(buildFieldRow("Action", hActionSelect));
      fields.appendChild(buildField("Value", rule.value, function(v) { rule.value = v; }));
    } else if (type === "cookie") {
      fields.appendChild(buildField("Cookie Name", rule.name, function(v) { rule.name = v; }));
      var cActionSelect = el("select", {});
      [ "set", "remove", "modify-domain", "modify-path", "add-secure", "add-httponly" ].forEach(function(a) {
        cActionSelect.appendChild(el("option", { value: a, text: a, selected: a === rule.action ? "selected" : null }));
      });
      cActionSelect.addEventListener("change", function() { rule.action = cActionSelect.value; });
      fields.appendChild(buildFieldRow("Action", cActionSelect));
      fields.appendChild(buildField("Value", rule.value, function(v) { rule.value = v; }));
      fields.appendChild(buildField("Domain", rule.domain || "", function(v) { rule.domain = v; }));
      fields.appendChild(buildField("Path", rule.path || "/", function(v) { rule.path = v; }));
    }
    if (type !== "path") fields.appendChild(buildField("Path Pattern", rule.path_pattern || "*", function(v) { rule.path_pattern = v; }));
    row.appendChild(fields);
    row.appendChild(buildActionsBar(rule, onSave, onDelete));
    return row;
  }

  function renderEditTab() {
    editTab.innerHTML = "";
    loadSiteConfig().then(function() {
      if (!siteConfig) { editTab.appendChild(el("div", { class: "unidral-empty", text: "Could not load site config" })); return; }
      var subTab = "html";
      var subTabs = { html: "HTML", css: "CSS", js: "JS" };
      var subBar = el("div", { class: "unidral-sub-tab-bar" });
      var subContent = el("div", { class: "unidral-sub-tab-content" });
      Object.keys(subTabs).forEach(function(key) {
        subBar.appendChild(el("button", {
          type: "button", class: "unidral-sub-tab-btn" + (key === subTab ? " unidral-sub-tab-active" : ""), text: subTabs[key],
          onclick: function() {
            subTab = key;
            Array.prototype.forEach.call(subBar.children, function(b, i) {
              b.classList.toggle("unidral-sub-tab-active", Object.keys(subTabs)[i] === key);
            });
            renderSub();
          }
        }));
      });
      editTab.appendChild(subBar);
      editTab.appendChild(subContent);
      function renderSub() {
        subContent.innerHTML = "";
        if (subTab === "html") renderOverrideList(subContent, "dom_overrides", "DOM Overrides", "dom", { selector: "", action: "remove", value: "", path_pattern: "*", enabled: true });
        else if (subTab === "css") renderOverrideList(subContent, "css_overrides", "CSS Overrides", "css", { selector: "", property: "", value: "", path_pattern: "*", enabled: true });
        else if (subTab === "js") renderOverrideList(subContent, "js_overrides", "JS Overrides", "js", { code: "console.log('injected');", path_pattern: "*", enabled: true });
      }
      renderSub();
    });
  }

  function renderInjectTab() {
    injectTab.innerHTML = "";
    loadSiteConfig().then(function() {
      if (!siteConfig) { injectTab.appendChild(el("div", { class: "unidral-empty", text: "Could not load site config" })); return; }
      var subTab = "text";
      var subTabs = { text: "Text Replacements", path: "Path Rules", nonhtml: "Non-HTML" };
      var subBar = el("div", { class: "unidral-sub-tab-bar" });
      var subContent = el("div", { class: "unidral-sub-tab-content" });
      Object.keys(subTabs).forEach(function(key) {
        subBar.appendChild(el("button", {
          type: "button", class: "unidral-sub-tab-btn" + (key === subTab ? " unidral-sub-tab-active" : ""), text: subTabs[key],
          onclick: function() {
            subTab = key;
            Array.prototype.forEach.call(subBar.children, function(b, i) {
              b.classList.toggle("unidral-sub-tab-active", Object.keys(subTabs)[i] === key);
            });
            renderSub();
          }
        }));
      });
      injectTab.appendChild(subBar);
      injectTab.appendChild(subContent);
      function renderSub() {
        subContent.innerHTML = "";
        if (subTab === "text") renderTextReplacements(subContent);
        else if (subTab === "path") renderOverrideList(subContent, "path_rules", "Path Rules", "path", { id: genId(), path_pattern: "", action: "block", redirect_url: "", response_body: "", response_status: 404, enabled: true });
        else if (subTab === "nonhtml") renderNonHtml(subContent);
      }
      renderSub();
    });
  }
  function renderTextReplacements(container) {
    var rules = (siteConfig.text_replacements || []).slice();
    container.appendChild(el("div", { class: "unidral-section-title", text: "Text Replacements (find \u2192 replace)" }));
    rules.forEach(function(rule, idx) {
      var row = el("div", { class: "unidral-override-row" });
      var fields = el("div", { class: "unidral-override-fields" });
      var findInput = el("input", { type: "text", class: "unidral-input", value: rule.find || "", placeholder: "Find" });
      var replaceInput = el("input", { type: "text", class: "unidral-input", value: rule.replace || "", placeholder: "Replace" });
      var regexChk = el("input", { type: "checkbox" });
      if (rule.regex) regexChk.checked = true;
      fields.appendChild(el("div", { class: "unidral-field" }, [ el("label", { text: "Find" }), findInput ]));
      fields.appendChild(el("div", { class: "unidral-field" }, [ el("label", { text: "Replace" }), replaceInput ]));
      fields.appendChild(el("div", { class: "unidral-field" }, [ el("label", { text: "Regex" }), regexChk ]));
      row.appendChild(fields);
      var actions = el("div", { class: "unidral-rule-actions" });
      actions.appendChild(el("button", {
        type: "button", class: "unidral-btn-sm unidral-btn-primary", text: "Save",
        onclick: function() {
          rules[idx] = { find: findInput.value, replace: replaceInput.value, regex: regexChk.checked };
          saveSiteConfig({ text_replacements: rules }).then(function() { renderInjectTab(); });
        }
      }));
      actions.appendChild(el("button", {
        type: "button", class: "unidral-btn-sm unidral-btn-danger", text: "Delete",
        onclick: function() {
          rules.splice(idx, 1);
          saveSiteConfig({ text_replacements: rules }).then(function() { renderInjectTab(); });
        }
      }));
      row.appendChild(actions);
      container.appendChild(row);
    });
    container.appendChild(el("button", {
      type: "button", class: "unidral-btn-primary unidral-new-rule-btn", text: "+ Add Replacement",
      onclick: function() {
        rules.push({ find: "", replace: "", regex: false });
        saveSiteConfig({ text_replacements: rules }).then(function() { renderInjectTab(); });
      }
    }));
  }
  function renderNonHtml(container) {
    container.appendChild(el("div", { class: "unidral-section-title", text: "Non-HTML Response Modification" }));
    container.appendChild(el("div", { class: "unidral-meta", text: "When enabled, text replacements are also applied to JS, CSS, and JSON responses." }));
    var chk = el("input", { type: "checkbox" });
    if (siteConfig.modify_non_html) chk.checked = true;
    var label = el("label", { text: " Enable text replacements on non-HTML responses" });
    label.style.cursor = "pointer";
    label.style.fontSize = "12px";
    label.style.color = "#e8e8e8";
    chk.addEventListener("change", function() { saveSiteConfig({ modify_non_html: chk.checked }); });
    container.appendChild(el("div", { class: "unidral-sync-row" }, [ chk, label ]));
  }

  function renderHeadersTab() {
    headersTab.innerHTML = "";
    loadSiteConfig().then(function() {
      if (!siteConfig) { headersTab.appendChild(el("div", { class: "unidral-empty", text: "Could not load site config" })); return; }
      var subTab = "response";
      var subTabs = { response: "Response Headers", request: "Request Headers", cookies: "Cookies" };
      var subBar = el("div", { class: "unidral-sub-tab-bar" });
      var subContent = el("div", { class: "unidral-sub-tab-content" });
      Object.keys(subTabs).forEach(function(key) {
        subBar.appendChild(el("button", {
          type: "button", class: "unidral-sub-tab-btn" + (key === subTab ? " unidral-sub-tab-active" : ""), text: subTabs[key],
          onclick: function() {
            subTab = key;
            Array.prototype.forEach.call(subBar.children, function(b, i) {
              b.classList.toggle("unidral-sub-tab-active", Object.keys(subTabs)[i] === key);
            });
            renderSub();
          }
        }));
      });
      headersTab.appendChild(subBar);
      headersTab.appendChild(subContent);
      function renderSub() {
        subContent.innerHTML = "";
        if (subTab === "response") renderOverrideList(subContent, "response_header_rules", "Response Header Rules", "header", { id: genId(), header: "", action: "set", value: "", path_pattern: "*", enabled: true });
        else if (subTab === "request") renderOverrideList(subContent, "request_header_rules", "Request Header Rules", "header", { id: genId(), header: "", action: "set", value: "", path_pattern: "*", enabled: true });
        else if (subTab === "cookies") renderOverrideList(subContent, "cookie_rules", "Cookie Rules", "cookie", { id: genId(), name: "", action: "set", value: "", domain: "", path: "/", path_pattern: "*", enabled: true });
      }
      renderSub();
    });
  }

  function renderOverrideList(container, field, title, type, newRuleTemplate) {
    var rules = (siteConfig[field] || []).slice();
    container.appendChild(el("div", { class: "unidral-section-title", text: title }));
    rules.forEach(function(rule) {
      container.appendChild(buildOverrideRow(rule, type, function(updated) {
        var newList = rules.map(function(r) { return r.id === updated.id ? updated : r; });
        var patch = {}; patch[field] = newList;
        saveSiteConfig(patch);
      }, function() {
        var newList = rules.filter(function(r) { return r.id !== rule.id; });
        var patch = {}; patch[field] = newList;
        saveSiteConfig(patch).then(function() {
          if (activeTab === "edit") renderEditTab();
          else if (activeTab === "inject") renderInjectTab();
          else if (activeTab === "headers") renderHeadersTab();
        });
      }));
    });
    container.appendChild(el("button", {
      type: "button", class: "unidral-btn-primary unidral-new-rule-btn", text: "+ Add Rule",
      onclick: function() {
        var newRule = Object.assign({}, newRuleTemplate, { id: genId() });
        rules.push(newRule);
        var patch = {}; patch[field] = rules;
        saveSiteConfig(patch).then(function() {
          if (activeTab === "edit") renderEditTab();
          else if (activeTab === "inject") renderInjectTab();
          else if (activeTab === "headers") renderHeadersTab();
        });
      }
    }));
  }

  var filesLoaded = false;
  var filesList = { html: [], css: [], js: [], images: [] };

  function isEngineNode(node) {
    if (!node || !node.closest) return false;
    if (node.closest("#unidral-root")) return true;
    if (node.hasAttribute && (node.hasAttribute("data-unidral") || node.hasAttribute("data-unidral-overrides"))) return true;
    return false;
  }
  function collectPageFiles() {
    var result = { html: [], css: [], js: [], images: [] };

    result.html.push({ url: window.location.href, label: "index.html", type: "html", source: "dom" });

    var seenCss = {};
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
      if (isEngineNode(link)) return;
      var href = link.href;
      if (!href || seenCss[href]) return;
      seenCss[href] = true;
      var label = href.split("/").pop().split("?")[0] || "stylesheet.css";
      result.css.push({ url: href, label: label, type: "css", source: "link" });
    });
    document.querySelectorAll("style").forEach(function(style, i) {
      if (isEngineNode(style)) return;
      result.css.push({ url: null, label: "<inline> #" + (i + 1), type: "css", source: "inline", content: style.textContent });
    });

    var seenJs = {};
    document.querySelectorAll("script[src]").forEach(function(script) {
      if (isEngineNode(script)) return;
      var src = script.src;
      if (!src || seenJs[src]) return;
      seenJs[src] = true;
      var label = src.split("/").pop().split("?")[0] || "script.js";
      result.js.push({ url: src, label: label, type: "js", source: "link" });
    });
    document.querySelectorAll("script:not([src])").forEach(function(script, i) {
      if (isEngineNode(script)) return;

      var st = (script.type || "").trim().toLowerCase();
      if (st && ["text/javascript", "application/javascript", "javascript", "text/ecmascript", "module"].indexOf(st) === -1) return;
      if (!script.textContent.trim()) return;
      result.js.push({ url: null, label: "<inline> #" + (i + 1), type: "js", source: "inline", content: script.textContent });
    });

    var seenImg = {};
    document.querySelectorAll("img").forEach(function(img) {
      if (isEngineNode(img)) return;
      var src = img.src;
      if (!src || seenImg[src]) return;
      seenImg[src] = true;
      var label = src.split("/").pop().split("?")[0] || "image";
      var isSvg = src.split("?")[0].split("#")[0].toLowerCase().slice(-4) === ".svg";
      result.images.push({ url: src, label: label, type: "image", source: isSvg ? "svg" : "img", element: img, selector: cssPath(img), width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    });

    var seenSvg = {};
    document.querySelectorAll("svg").forEach(function(svg, i) {

      if (svg.closest("#unidral-root")) return;

      var w = svg.getAttribute("width") || svg.getBoundingClientRect().width || 0;
      var h = svg.getAttribute("height") || svg.getBoundingClientRect().height || 0;
      if (w < 16 && h < 16) return;
      var selector = cssPath(svg);
      if (seenSvg[selector]) return;
      seenSvg[selector] = true;
      var label = "inline-svg-" + (i + 1);
      result.images.push({ url: null, label: label, type: "image", source: "inline-svg", element: svg, selector: selector, width: w, height: h, content: svg.outerHTML });
    });
    document.querySelectorAll('img[src$=".svg"]').forEach(function(img) {
      var src = img.src;
      if (!src || seenImg[src]) return;
      seenImg[src] = true;
      var label = src.split("/").pop().split("?")[0] || "image.svg";
      result.images.push({ url: src, label: label, type: "image", source: "svg", element: img, selector: cssPath(img), width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    });
    return result;
  }
  function renderFilesTab() {
    filesTab.innerHTML = "";
    loadSiteConfig().then(function() {
      if (!siteConfig) { filesTab.appendChild(el("div", { class: "unidral-empty", text: "Could not load site config" })); return; }

      filesList = collectPageFiles();

      var allOverrides = [];
      (siteConfig.dom_overrides || []).forEach(function(r) { allOverrides.push({ type: "dom", rule: r }); });
      (siteConfig.css_overrides || []).forEach(function(r) { allOverrides.push({ type: "css", rule: r }); });
      (siteConfig.js_overrides || []).forEach(function(r) { allOverrides.push({ type: "js", rule: r }); });
      (siteConfig.image_overrides || []).forEach(function(r) { allOverrides.push({ type: "img", rule: r }); });
      if (allOverrides.length) {
        filesTab.appendChild(el("div", { class: "unidral-files-section-title", text: "Active Overrides (" + allOverrides.length + ")" }));
        allOverrides.forEach(function(item) {
          var rule = item.rule;
          var row = el("div", { class: "unidral-file-row" });
          var info = el("div", { class: "unidral-file-info" });
          var typeIcon = item.type === "img"
            ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="7" r="1.5"/><path d="M2 11l3-3 3 2 3-3 3 3"/></svg>'
            : item.type === "css"
            ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4h12M2 8h12M2 12h8"/></svg>'
            : item.type === "js"
            ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4l3 3-3 3M8 11h6"/></svg>'
            : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 2h7l3 3v9H3z"/><path d="M9 2v3h3"/></svg>';
          info.appendChild(el("span", { class: "unidral-file-icon unidral-file-icon-" + (item.type === "img" ? "img" : item.type), html: typeIcon }));
          var label = "";
          if (item.type === "dom") label = (rule.selector || "").slice(0, 40) + " (" + (rule.action || "") + ")";
          else if (item.type === "css") label = (rule.selector || "").slice(0, 40);
          else if (item.type === "js") label = "JS (" + (rule.path_pattern || "*") + ")";
          else if (item.type === "img") label = (rule.original_src || "").split("/").pop().slice(0, 40);
          info.appendChild(el("span", { class: "unidral-file-label", text: label }));
          info.appendChild(el("span", { class: "unidral-file-meta", text: item.type.toUpperCase() }));
          row.appendChild(info);
          var actions = el("div", { class: "unidral-file-actions" });

          actions.appendChild(iconBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3M11 2v3h-3M5 14v-3h3"/></svg>', rule.enabled ? "Disable" : "Enable", function() {
            rule.enabled = !rule.enabled;
            var field = item.type === "dom" ? "dom_overrides" : item.type === "css" ? "css_overrides" : item.type === "js" ? "js_overrides" : "image_overrides";
            var newList = (siteConfig[field] || []).map(function(r) { return r.id === rule.id ? rule : r; });
            var save = {}; save[field] = newList;
            saveSiteConfig(save).then(function() { renderFilesTab(); });
          }, rule.enabled ? "unidral-file-btn-active" : ""));

          actions.appendChild(iconBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3M11 2v3h-3M5 14v-3h3"/><path d="M2 2L14 14" stroke-width="1.6"/></svg>', "Revert (remove override & reload)", function() {
            if (!window.confirm("Revert this override? The page will reload to restore the original.")) return;
            var field = item.type === "dom" ? "dom_overrides" : item.type === "css" ? "css_overrides" : item.type === "js" ? "js_overrides" : "image_overrides";
            var newList = (siteConfig[field] || []).filter(function(r) { return r.id !== rule.id; });
            var save = {}; save[field] = newList;
            saveSiteConfig(save).then(function() {
              toast("Override reverted", "success");
              window.location.reload();
            });
          }, "unidral-file-btn-danger"));
          row.appendChild(actions);
          filesTab.appendChild(row);
        });
      }

      renderFileSection(filesTab, "HTML", filesList.html, "html");

      renderFileSection(filesTab, "CSS", filesList.css, "css");

      renderFileSection(filesTab, "JS", filesList.js, "js");

      renderFileSection(filesTab, "Images", filesList.images, "image");
    });
  }
  function renderFileSection(container, title, files, type) {
    if (!files.length) return;
    container.appendChild(el("div", { class: "unidral-files-section-title", text: title + " (" + files.length + ")" }));
    files.forEach(function(file) {
      var row = el("div", { class: "unidral-file-row" });
      var info = el("div", { class: "unidral-file-info" });
      if (type === "image" && file.source === "inline-svg" && file.content) {

        var svgWrap = el("span", { class: "unidral-file-thumb-wrap" });
        svgWrap.innerHTML = file.content;
        var svgEl = svgWrap.querySelector("svg");
        if (svgEl) {
          svgEl.setAttribute("width", "28");
          svgEl.setAttribute("height", "28");
          svgEl.style.width = "28px";
          svgEl.style.height = "28px";
        }
        info.appendChild(svgWrap);
      } else if (type === "image" && file.url) {

        var thumb = el("img", {
          class: "unidral-file-thumb",
          src: file.url,
          alt: file.label,
          loading: "lazy"
        });
        thumb.addEventListener("error", function() {
          thumb.style.display = "none";
          var fallback = el("span", { class: "unidral-file-icon unidral-file-icon-img", html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="7" r="1.5"/><path d="M2 11l3-3 3 2 3-3 3 3"/></svg>' });
          info.insertBefore(fallback, thumb);
        });
        info.appendChild(thumb);
      } else {
        var iconSvg = type === "css"
          ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4h12M2 8h12M2 12h8"/></svg>'
          : type === "js"
          ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4l3 3-3 3M8 11h6"/></svg>'
          : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 2h7l3 3v9H3z"/><path d="M9 2v3h3"/></svg>';
        info.appendChild(el("span", { class: "unidral-file-icon unidral-file-icon-" + type, html: iconSvg }));
      }
      info.appendChild(el("span", { class: "unidral-file-label", text: file.label.slice(0, 50), title: file.url || file.label }));
      if (file.width && file.height) info.appendChild(el("span", { class: "unidral-file-meta", text: file.width + "x" + file.height }));
      row.appendChild(info);
      var actions = el("div", { class: "unidral-file-actions" });

      actions.appendChild(iconBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2l3 3-8 8H3v-3z"/><path d="M9 4l3 3"/></svg>', "Edit", function() {
        openFileEditor(file);
      }));

      actions.appendChild(iconBtn('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 14l4-4M6 10l6-6 2 2-6 6z"/><path d="M9 3l4 4"/><path d="M2 14h12"/></svg>', "Replace", function() {
        openFileReplace(file);
      }));
      row.appendChild(actions);
      container.appendChild(row);
    });
  }
  function iconBtn(svg, title, onclick, extraClass) {
    return el("button", {
      type: "button",
      class: "unidral-file-btn" + (extraClass ? " " + extraClass : ""),
      title: title,
      html: svg,
      onclick: onclick
    });
  }

  function sanitizedDocumentHtml() {
    var clone = document.documentElement.cloneNode(true);
    var junk = clone.querySelectorAll("#unidral-root, [data-unidral], [data-unidral-overrides]");
    Array.prototype.forEach.call(junk, function(n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });

    var stripClasses = function(node) {
      if (!node.classList) return;
      var toRemove = [];
      node.classList.forEach(function(c) {
        if (c.indexOf("unidral") === 0) toRemove.push(c);
      });
      toRemove.forEach(function(c) { node.classList.remove(c); });
    };
    stripClasses(clone);
    Array.prototype.forEach.call(clone.querySelectorAll("*"), stripClasses);
    return clone.innerHTML;
  }

  function adoptImgLayout(svgEl, imgEl) {
    if (!svgEl || !imgEl || imgEl.tagName !== "IMG") return;
    if (!svgEl.getAttribute("width")) {
      var w = imgEl.getAttribute("width") || (imgEl.clientWidth ? imgEl.clientWidth + "px" : "");
      if (w) svgEl.setAttribute("width", w);
    }
    if (!svgEl.getAttribute("height")) {
      var h = imgEl.getAttribute("height") || (imgEl.clientHeight ? imgEl.clientHeight + "px" : "");
      if (h) svgEl.setAttribute("height", h);
    }
    if (!svgEl.getAttribute("class") && imgEl.getAttribute("class")) {
      svgEl.setAttribute("class", imgEl.getAttribute("class"));
    }
    if (!svgEl.getAttribute("style") && imgEl.getAttribute("style")) {
      svgEl.setAttribute("style", imgEl.getAttribute("style"));
    }
  }

  function replaceElementWithHtml(target, html) {
    if (!target || !target.parentNode) return;
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    var inserted = Array.prototype.slice.call(tpl.content.childNodes);

    if (!inserted.some(function(n) { return n.nodeType === 1; })) return;
    if (target.tagName === "IMG") {
      inserted.forEach(function(n) {
        if (n.nodeType === 1 && n.tagName.toLowerCase() === "svg") adoptImgLayout(n, target);
      });
    }
    var parent = target.parentNode;
    parent.insertBefore(tpl.content, target);
    parent.removeChild(target);
    inserted.forEach(function(n) {
      if (n.nodeType !== 1) return;
      if (n.tagName === "SCRIPT") {
        var s = document.createElement("script");
        for (var i = 0; i < n.attributes.length; i++) s.setAttribute(n.attributes[i].name, n.attributes[i].value);
        s.textContent = n.textContent;
        if (n.parentNode) n.parentNode.replaceChild(s, n);
      } else {
        Array.prototype.forEach.call(n.querySelectorAll("script"), function(old) {
          var s = document.createElement("script");
          for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
          s.textContent = old.textContent;
          if (old.parentNode) old.parentNode.replaceChild(s, old);
        });
      }
    });
  }

  function openFileEditor(file) {
    if (file.type === "image" && file.source !== "inline-svg" && file.source !== "svg") {
      openFileReplace(file);
      return;
    }
    var overlay = el("div", { class: "unidral-modal-overlay" });
    var modal = el("div", { class: "unidral-modal unidral-modal-wide" });
    modal.appendChild(el("div", { class: "unidral-editor-title", text: "Edit: " + file.label }));
    var textarea = el("textarea", { class: "unidral-code-editor" });
    modal.appendChild(textarea);

    if (file.source === "inline-svg" && file.content) {
      textarea.value = file.content;
    } else if (file.url && (file.source === "link" || file.source === "svg")) {
      textarea.value = "// Loading...";
      fetch(file.url).then(function(r) { return r.text(); }).then(function(text) {
        textarea.value = text;
        file.content = text;
      }).catch(function() { textarea.value = "// Could not load " + file.url; });
    } else if (file.source === "inline") {
      textarea.value = file.content || "";
    } else if (file.type === "html") {
      textarea.value = sanitizedDocumentHtml();
    } else {
      textarea.value = file.content || "";
    }
    var actions = el("div", { class: "unidral-editor-actions" });
    actions.appendChild(el("button", { type: "button", class: "unidral-btn-sm", text: "Cancel", onclick: function() { overlay.remove(); } }));
    actions.appendChild(el("button", {
      type: "button", class: "unidral-btn-sm unidral-btn-primary", text: "Save as Override",
      onclick: function() {
        var code = textarea.value;

        if (code === "// Loading..." || code.indexOf("// Could not load") === 0) {
          toast("Wait for the file content to finish loading before saving", "error");
          return;
        }
        if (file.type === "css") {
          var newRule = { id: genId(), selector: "*", value: code, path_pattern: "*", enabled: true };
          var newList = (siteConfig.css_overrides || []).concat([newRule]);

          var styleEl = document.createElement("style");
          styleEl.setAttribute("data-unidral-overrides", "css-live");
          styleEl.textContent = code;
          (document.head || document.documentElement).appendChild(styleEl);
          saveSiteConfig({ css_overrides: newList }).then(function() { overlay.remove(); toast("CSS override saved", "success"); });
        } else if (file.type === "js") {
          var newRule = { id: genId(), code: code, path_pattern: "*", enabled: true };
          var newList = (siteConfig.js_overrides || []).concat([newRule]);

          try { new Function(code).call(window); } catch (e) { console.error("[Unidral] live JS error:", e); }
          saveSiteConfig({ js_overrides: newList }).then(function() { overlay.remove(); toast("JS override saved", "success"); });
        } else if (file.type === "image" && (file.source === "inline-svg" || file.source === "svg")) {

          var newRule = {
            id: genId(),
            selector: file.selector,
            action: "replace",
            value: code,
            path_pattern: "*",
            enabled: true
          };
          var newList = (siteConfig.dom_overrides || []).concat([newRule]);

          try {
            var target = file.element || document.querySelector(file.selector);
            if (target) {
              var isSvg = code.trim().startsWith("<svg") || target.tagName.toLowerCase() === "svg";
              if (isSvg) {
                var doc = new DOMParser().parseFromString(code, "image/svg+xml");
                var parsed = doc.documentElement;
                if (parsed && parsed.tagName.toLowerCase() === "svg" && target.parentNode) {
                  adoptImgLayout(parsed, target);
                  target.parentNode.replaceChild(parsed, target);
                } else {
                  replaceElementWithHtml(target, code);
                }
              } else {
                replaceElementWithHtml(target, code);
              }
            }
          } catch (e) {}
          saveSiteConfig({ dom_overrides: newList }).then(function() {
            overlay.remove();
            toast("SVG override saved", "success");
          });
        } else if (file.type === "html") {

          var newRule = {
            id: genId(),
            selector: "html",
            action: "set-html",
            value: code,
            path_pattern: "*",
            enabled: true
          };
          var newList = (siteConfig.dom_overrides || []).concat([newRule]);
          saveSiteConfig({ dom_overrides: newList }).then(function() { overlay.remove(); toast("HTML override saved", "success"); });
        } else {
          toast("This file type cannot be saved as override", "error");
        }
      }
    }));
    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) overlay.remove(); });
    root.appendChild(overlay);
  }

  function openFileReplace(file) {
    var input = el("input", { type: "file" });
    if (file.type === "image") input.accept = "image/*";
    else if (file.type === "css") input.accept = ".css,text/css";
    else if (file.type === "js") input.accept = ".js,text/javascript";
    input.click();
    input.addEventListener("change", function() {
      var uploadedFile = input.files[0];
      if (!uploadedFile) return;
      if (file.type === "image") {
        replaceImageFile(file, uploadedFile);
      } else {
        replaceCodeFile(file, uploadedFile);
      }
    });
  }
  function replaceImageFile(file, uploadedFile) {

    if (file.source === "inline-svg") {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var newSvg = ev.target.result;
        var newRule = {
          id: genId(),
          selector: file.selector,
          action: "replace",
          value: newSvg,
          path_pattern: "*",
          enabled: true
        };
        var newList = (siteConfig.dom_overrides || []).concat([newRule]);

        try {
          var target = file.element || document.querySelector(file.selector);
          if (target) {
            var isSvg = newSvg.trim().startsWith("<svg") || target.tagName.toLowerCase() === "svg";
            if (isSvg) {
              var doc = new DOMParser().parseFromString(newSvg, "image/svg+xml");
              var parsed = doc.documentElement;
              if (parsed && parsed.tagName.toLowerCase() === "svg" && target.parentNode) {
                adoptImgLayout(parsed, target);
                target.parentNode.replaceChild(parsed, target);
              } else {
                replaceElementWithHtml(target, newSvg);
              }
            } else {
              replaceElementWithHtml(target, newSvg);
            }
          }
        } catch (e) {}
        saveSiteConfig({ dom_overrides: newList }).then(function() {
          toast("SVG replaced", "success");
          renderFilesTab();
        });
      };
      reader.readAsText(uploadedFile);
      return;
    }
    var formData = new FormData();
    formData.append("image", uploadedFile);
    fetch(apiBase + "/sites/" + encodeURIComponent(siteId) + "/images", { method: "POST", body: formData })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        var newSrc = result.url;
        var originalSrc = file.url || "";
        var originalSelector = file.selector || "";
        var w = file.width || 0, h = file.height || 0;
        var newRule = {
          id: genId(),
          original_src: originalSrc,
          original_selector: originalSelector,
          new_src: newSrc,
          width: w || null,
          height: h || null,
          path_pattern: "*",
          enabled: true
        };
        var newList = (siteConfig.image_overrides || []).concat([newRule]);

        if (file.element) {
          file.element.src = newSrc;
          if (w) { file.element.style.width = w + "px"; }
          if (h) { file.element.style.height = h + "px"; }
        }
        saveSiteConfig({ image_overrides: newList }).then(function() {
          toast("Image replaced", "success");
          renderFilesTab();
        });
      })
      .catch(function(err) { toast("Upload failed: " + err.message, "error"); });
  }
  function replaceCodeFile(file, uploadedFile) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      var code = ev.target.result;
      if (file.type === "css") {
        var newRule = { id: genId(), selector: "*", value: code, path_pattern: "*", enabled: true };
        var newList = (siteConfig.css_overrides || []).concat([newRule]);
        saveSiteConfig({ css_overrides: newList }).then(function() { toast("CSS replaced", "success"); renderFilesTab(); });
      } else if (file.type === "js") {
        var newRule = { id: genId(), code: code, path_pattern: "*", enabled: true };
        var newList = (siteConfig.js_overrides || []).concat([newRule]);
        saveSiteConfig({ js_overrides: newList }).then(function() { toast("JS replaced", "success"); renderFilesTab(); });
      }
    };
    reader.readAsText(uploadedFile);
  }

  function checkTrackDeepLink() {
    var match = /[?&]unidral-track=([^&]+)/.exec(window.location.search);
    if (!match) return;
    var trackId = decodeURIComponent(match[1]);
    loadTrackedElements().then(function() {
      var tracked = trackedElements.find(function(t) {
        return t.id === trackId;
      });
      if (!tracked) {
        toast("Track ID not found: " + trackId, "error");
        return;
      }
      var element = null;
      try {
        var nodes = document.querySelectorAll(tracked.selector);
        if (nodes.length) element = nodes[0];
      } catch (err) {}
      if (!element && tracked.fingerprint) {
        var candidates = document.querySelectorAll(tracked.fingerprint.tag || "*");
        var best = null;
        var bestScore = 0;
        for (var i = 0; i < candidates.length; i++) {
          if (isToolbarNode(candidates[i])) continue;
          var score = scoreCandidate(candidates[i], tracked.fingerprint);
          if (score > bestScore) {
            bestScore = score;
            best = candidates[i];
          }
        }
        if (best && bestScore >= 3) element = best;
      }
      if (element) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        element.classList.add("unidral-track-highlight");
        selectElement(element);
        setExpanded(true);
        switchTab("rules");
        toast("Tracked element found!", "success");
        reportTrackedFound(trackId);
        if (trackHighlightTimer) clearTimeout(trackHighlightTimer);
        trackHighlightTimer = setTimeout(function() {
          element.classList.remove("unidral-track-highlight");
        }, 1e4);
      } else {
        toast("Tracked element not found on this page", "error");
        logToConsole("Track: element not found on this page (selector: " + tracked.selector + ")", "warn");
      }
    });
  }

  var consoleOutput = el("div", {
    class: "unidral-console-output"
  });
  var consolePauseBtn = el("button", {
    type: "button",
    class: "unidral-btn unidral-btn-sm",
    text: "Pause",
    onclick: function() {
      consolePaused = !consolePaused;
      this.textContent = consolePaused ? "Resume" : "Pause";
    }
  });
  var consoleClearBtn = el("button", {
    type: "button",
    class: "unidral-btn unidral-btn-sm",
    text: "Clear",
    onclick: function() {
      consoleEntries = [];
      renderConsole();
    }
  });
  consoleTab.appendChild(el("div", {
    class: "unidral-console-toolbar"
  }, [ consolePauseBtn, consoleClearBtn ]));
  consoleTab.appendChild(consoleOutput);
  function renderConsole() {
    if (activeTab !== "console") return;
    consoleOutput.innerHTML = "";
    consoleEntries.slice(-200).forEach(function(entry) {
      consoleOutput.appendChild(el("div", {
        class: "unidral-console-line unidral-console-" + entry.level
      }, [ el("span", {
        class: "unidral-console-time",
        text: entry.time
      }), el("span", {
        class: "unidral-console-level",
        text: entry.level.toUpperCase()
      }), el("span", {
        class: "unidral-console-msg",
        text: entry.message
      }) ]));
    });
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }
  function toast(message, kind) {
    var node = el("div", {
      class: "unidral-toast" + (kind ? " unidral-toast-" + kind : ""),
      text: String(message)
    });
    toastLayer.appendChild(node);
    setTimeout(function() {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, kind === "error" ? 6e3 : 3e3);
  }
  function setDirty(value) {
    dirty = Boolean(value);
    statusDot.classList.toggle("unidral-dirty", dirty);
  }
  function teardown() {
    bindings.forEach(function(binding) {
      try {
        binding.element.removeEventListener(binding.type, binding.handler, binding.options);
      } catch (err) {}
    });
    bindings = [];
    boundByRule = new Map;
  }
  function injectHtml(element, html) {
    var wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    var scripts = [];
    while (wrapper.firstChild) {
      var node = wrapper.firstChild;
      if (node.tagName === "SCRIPT") {
        scripts.push(node);
        wrapper.removeChild(node);
      } else {
        element.appendChild(node);
      }
    }
    scripts.forEach(function(oldScript) {
      var newScript = document.createElement("script");
      if (oldScript.src) newScript.src = oldScript.src;
      if (oldScript.type) newScript.type = oldScript.type;
      if (oldScript.async) newScript.async = true;
      if (oldScript.defer) newScript.defer = true;
      newScript.textContent = oldScript.textContent;
      if (oldScript.parentNode) oldScript.parentNode.removeChild(oldScript);
      element.appendChild(newScript);
    });
  }
  function compile(rule) {
    if (compiledByRule.has(rule.id)) return compiledByRule.get(rule.id);
    var fn = null;
    try {
      if (rule.code_type === "html") {
        var htmlCode = rule.code;
        fn = function(element, event, unidral) {
          injectHtml(element, htmlCode);
        };
      } else {
        fn = new Function("element", "event", "unidral", rule.code);
      }
    } catch (err) {
      toast('Rule "' + rule.selector + '" failed to compile: ' + err.message, "error");
      logToConsole("Rule compile error: " + rule.selector + " - " + err.message, "error");
      logToConsole("Code that failed: " + String(rule.code).slice(0, 300), "error");
    }
    compiledByRule.set(rule.id, fn);
    return fn;
  }
  function runRule(fn, element, event, rule) {
    try {
      fn.call(element, element, event, {
        rule: rule,
        config: config,
        toast: toast,
        refresh: refreshRules,
        log: function(msg, level) {
          logToConsole(msg, level);
        }
      });
      failuresByRule.set(rule.id, 0);
      modifiedElements.add(element);
    } catch (err) {
      console.error("[unidral] rule error", rule, err);
      logToConsole("Rule error (" + rule.selector + "): " + err.message, "error");
      var failures = (failuresByRule.get(rule.id) || 0) + 1;
      failuresByRule.set(rule.id, failures);
      if (failures >= MAX_RULE_FAILURES) {
        if (!trippedRules.has(rule.id)) {
          trippedRules.add(rule.id);
          toast("Rule auto-disabled after " + failures + " errors: " + rule.selector, "error");
          logToConsole("Rule circuit-breaker tripped: " + rule.selector, "error");
          if (activeTab === "rules") renderRulesTab();
        }
        return;
      }
      toast("Rule error (" + rule.selector + "): " + err.message, "error");
    }
  }
  function eventTypeFor(rule) {
    if (rule.trigger === "hover") return "mouseenter";
    if (rule.trigger === "submit") return "submit";
    if (rule.trigger === "click") return "click";
    if (rule.trigger === "custom") return rule.event_name || null;
    return null;
  }
  function applyRules(reset) {
    if (reset) teardown();
    rules.forEach(function(rule) {
      if (!rule.enabled) return;
      if (trippedRules.has(rule.id)) return;
      if (!pathMatches(rule.page_path)) return;
      var fn = compile(rule);
      if (!fn) return;
      var seen = boundByRule.get(rule.id);
      if (!seen) {
        seen = new WeakSet;
        boundByRule.set(rule.id, seen);
      }
      var nodes;
      try {
        nodes = document.querySelectorAll(rule.selector);
      } catch (err) {
        toast("Invalid selector in rule: " + rule.selector, "error");
        return;
      }
      if (!nodes.length) nodes = reanchor(rule);
      var isLoad = rule.trigger === "load";
      var loadSeen = null;
      if (isLoad) {
        loadSeen = loadSeenByRule.get(rule.id);
        if (!loadSeen) {
          loadSeen = new WeakSet;
          loadSeenByRule.set(rule.id, loadSeen);
        }
      }
      Array.prototype.forEach.call(nodes, function(element) {
        if (isToolbarNode(element)) return;
        if (isLoad) {
          if (loadSeen.has(element)) return;
          loadSeen.add(element);
          runRule(fn, element, null, rule);
          return;
        }
        if (seen.has(element)) return;
        seen.add(element);
        var type = eventTypeFor(rule);
        if (!type) return;
        var override = rule.behavior === "override";
        var options = override ? true : rule.trigger === "hover" ? {
          passive: true
        } : false;
        var handler = function(event) {
          if (override) {
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          }
          runRule(fn, element, event, rule);
        };
        element.addEventListener(type, handler, options);
        bindings.push({
          element: element,
          type: type,
          handler: handler,
          options: options
        });
      });
    });
    trackedElements.forEach(function(tracked) {
      try {
        var nodes = document.querySelectorAll(tracked.selector);
        if (nodes.length) {
          reportTrackedFound(tracked.id);
          return;
        }
        if (tracked.fingerprint) {
          var candidates = document.querySelectorAll(tracked.fingerprint.tag || "*");
          for (var i = 0; i < candidates.length; i++) {
            if (isToolbarNode(candidates[i])) continue;
            if (scoreCandidate(candidates[i], tracked.fingerprint) >= 3) {
              reportTrackedFound(tracked.id);
              break;
            }
          }
        }
      } catch (err) {}
    });
  }
  var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  var MUTATION_DEBOUNCE = isMobile ? 500 : 150;
  var PERIODIC_REAPPLY = isMobile ? 5e3 : 2e3;
  function queueApply() {
    if (reapplyQueued) return;
    reapplyQueued = true;
    setTimeout(function() {
      reapplyQueued = false;
      applyRules(false);
      if (activeTab === "elements") renderElementsTree();
    }, MUTATION_DEBOUNCE);
  }
  function observe() {
    var target = document.body || document.documentElement;
    var observer = new MutationObserver(function(mutations) {
      var fromToolbar = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.target && (m.target.id === "unidral-root" || m.target.closest && m.target.closest("#unidral-root"))) {
          fromToolbar = true;
          break;
        }
      }
      if (fromToolbar) return;
      ensureMounted();
      queueApply();
    });
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: !isMobile,
      attributeFilter: isMobile ? undefined : [ "class", "id", "style" ]
    });
  }
  function onNavigate() {
    ensureMounted();
    applyRules(true);
    if (activeTab === "rules") renderRulesTab();
    if (activeTab === "elements") renderElements();
    checkTrackDeepLink();
  }
  [ "pushState", "replaceState" ].forEach(function(method) {
    var original = history[method];
    if (typeof original !== "function") return;
    history[method] = function() {
      var result = original.apply(this, arguments);
      window.dispatchEvent(new Event("unidral:navigate"));
      return result;
    };
  });
  window.addEventListener("popstate", onNavigate);
  window.addEventListener("unidral:navigate", onNavigate);
  var evtSource = null;
  function connect() {
    if (!config.e) return;
    try {
      evtSource = new EventSource(config.e);
    } catch (err) {
      return;
    }
    evtSource.onmessage = function(event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (message.type === "rule:update") {
        refreshRules();
      }
      if (message.type === "site:update") {

        siteConfig = null;
        siteConfigPromise = null;
        loadSiteConfig().then(function() {
          if (activeTab === "files") renderFilesTab();
          else if (activeTab === "edit") renderEditTab();
          else if (activeTab === "inject") renderInjectTab();
          else if (activeTab === "headers") renderHeadersTab();
        });
      }
      if (message.type === "track:update") {
        loadTrackedElements().then(function() {

        });
      }
      if (message.type === "track:reported") {
        logToConsole("Tracked element reported: found on new page", "info");
      }
    };
    evtSource.onerror = function() {
      logToConsole("SSE connection error — browser will reconnect", "info");
    };
  }
  document.addEventListener("keydown", function(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
      e.preventDefault();
      toggleInspect();
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === "Z" || e.key === "z")) {
      e.preventDefault();
      setExpanded(!panelExpanded);
      return;
    }
    if (e.key === "Escape") {
      if (inspecting) {
        stopInspect();
        return;
      }
      if (ruleEditorState) {
        closeInlineEditor();
        return;
      }
      setExpanded(false);
      return;
    }
    if (e.ctrlKey && (e.key === "s" || e.key === "S") && ruleEditorState) {
      e.preventDefault();
      submitInlineEditor();
      return;
    }
  });
  function updateCountBadge() {
    var parts = [];
    if (rules.length) parts.push(rules.length + (rules.length === 1 ? " rule" : " rules"));
    if (trackedElements.length) parts.push(trackedElements.length + " tracked");
    countBadge.textContent = parts.join(" · ");
    countBadge.style.display = parts.length ? "" : "none";
  }
  function refreshRules() {
    return apiCall("GET", "/rules?site_id=" + encodeURIComponent(siteId)).then(function(list) {
      rules = Array.isArray(list) ? list : [];
      compiledByRule.clear();
      failuresByRule.clear();
      trippedRules.clear();
      reanchoredRules.clear();
      loadSeenByRule.clear();
      applyRules(true);
      updateCountBadge();
      if (activeTab === "rules") renderRulesTab();
      if (activeTab === "elements") renderElementsTree();
      return rules;
    }).catch(function(err) {
      toast("Could not load rules: " + err.message, "error");
      return rules;
    });
  }
  var rulesApplied = false;
  function applyInitialRules() {
    if (rulesApplied) return;
    rulesApplied = true;
    applyRules(true);
  }
  function boot() {
    logToConsole("Toolbar booted", "info");
    applyInitialRules();
    updateCountBadge();
    renderElements();
    renderRulesTab();
    observe();
    connect();
    loadTrackedElements().then(function() {
      applyRules(false);
      checkTrackDeepLink();
    });
    setInterval(ensureMounted, 2e3);
    setInterval(function() {
      if (document.visibilityState === "hidden") return;
      applyRules(true);
    }, PERIODIC_REAPPLY);
    [ 500, 1e3, 2e3, 4e3 ].forEach(function(delay) {
      setTimeout(function() {
        if (document.visibilityState === "hidden") return;
        applyRules(true);
      }, delay);
    });
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState !== "visible") return;
      applyRules(false);
    });
    window.addEventListener("pageshow", function(event) {
      if (!event.persisted) return;
      logToConsole("Page restored from bfcache - re-applying rules", "info");
      applyRules(true);
    });
  }
  applyInitialRules();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {
    once: true
  }); else boot();
  window.__UNIDRAL_TOOLBAR__ = {
    config: config,
    getRules: function() {
      return rules.slice();
    },
    refresh: refreshRules,
    selectElement: selectElement,
    switchTab: switchTab,
    expand: function() {
      setExpanded(true);
    },
    collapse: function() {
      setExpanded(false);
    },
    inspect: toggleInspect,
    log: logToConsole
  };
})();
