
(function() {
  "use strict";
  var config = window.__c || {};
  var ov = config.ov || {};
  if (!ov) return;

  function pathMatches(pattern) {
    if (!pattern || pattern === "*") return true;
    var current = window.location.pathname;
    if (pattern.indexOf("*") !== -1) {
      var regexStr = pattern.split("*").map(function(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join(".*");
      try { return new RegExp("^" + regexStr + "$").test(current); } catch (e) { return false; }
    }
    return pattern === current;
  }

  function parseSvg(svgString) {
    try {
      var doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
      var node = doc.documentElement;
      if (node && node.tagName.toLowerCase() === "svg") return node;

    } catch (e) {}
    return null;
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

  function reviveScriptNode(old) {
    var s = document.createElement("script");
    for (var i = 0; i < old.attributes.length; i++) {
      s.setAttribute(old.attributes[i].name, old.attributes[i].value);
    }
    s.textContent = old.textContent;
    if (old.parentNode) old.parentNode.replaceChild(s, old);
  }
  function reviveScripts(container) {
    if (!container || !container.querySelectorAll) return;
    Array.prototype.forEach.call(container.querySelectorAll("script"), reviveScriptNode);
  }

  function applyDomOverrides() {
    if (!ov.dom || !ov.dom.length) return;
    ov.dom.forEach(function(rule) {
      if (!rule.enabled) return;
      if (!pathMatches(rule.path_pattern)) return;
      try {
        var elements = document.querySelectorAll(rule.selector);
        elements.forEach(function(el) {
          if (rule.action === "remove") {
            el.remove();
          } else if (rule.action === "hide") {
            el.style.display = "none";
          } else if (rule.action === "show") {
            el.style.display = "";
          } else if (rule.action === "set-attr") {
            var parts = (rule.value || "").split("=", 2);
            if (parts.length === 2) el.setAttribute(parts[0].trim(), parts[1]);
          } else if (rule.action === "set-style") {
            var sParts = (rule.value || "").split(":", 2);
            if (sParts.length === 2) el.style.setProperty(sParts[0].trim(), sParts[1].trim(), "important");
          } else if (rule.action === "set-html") {
            el.innerHTML = rule.value;
            reviveScripts(el);
          } else if (rule.action === "set-text") {
            el.textContent = rule.value;
          } else if (rule.action === "replace") {

            var isSvg = (rule.value || "").trim().startsWith("<svg") || el.tagName.toLowerCase() === "svg";
            var parsed = isSvg ? parseSvg(rule.value) : null;
            if (parsed) {
              adoptImgLayout(parsed, el);
              if (el.parentNode) el.parentNode.replaceChild(parsed, el);
            } else if (el.parentNode) {

              var tpl = document.createElement("template");
              tpl.innerHTML = rule.value;
              var inserted = Array.prototype.slice.call(tpl.content.childNodes);

              if (inserted.some(function(n) { return n.nodeType === 1; })) {
                if (el.tagName === "IMG") {
                  inserted.forEach(function(n) {
                    if (n.nodeType === 1 && n.tagName.toLowerCase() === "svg") adoptImgLayout(n, el);
                  });
                }
                el.parentNode.insertBefore(tpl.content, el);
                el.parentNode.removeChild(el);
                inserted.forEach(function(n) {
                  if (n.nodeType !== 1) return;
                  if (n.tagName === "SCRIPT") reviveScriptNode(n); else reviveScripts(n);
                });
              }
            }
          }
        });
      } catch (e) {  }
    });
  }

  function applyCssOverrides() {
    if (!ov.css || !ov.css.length) return;
    var cssText = "";
    ov.css.forEach(function(rule) {
      if (!rule.enabled) return;
      if (!pathMatches(rule.path_pattern)) return;
      if (rule.property) {
        cssText += rule.selector + " { " + rule.property + ": " + rule.value + " !important; }\n";
      } else if (rule.selector === "*" || !rule.selector) {
        cssText += rule.value + "\n";
      } else {
        cssText += rule.selector + " { " + rule.value + " }\n";
      }
    });
    if (cssText) {
      var style = document.createElement("style");
      style.setAttribute("data-unidral-overrides", "css");
      style.textContent = cssText;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function applyJsOverrides() {
    if (!ov.js || !ov.js.length) return;
    ov.js.forEach(function(rule) {
      if (!rule.enabled) return;
      if (!pathMatches(rule.path_pattern)) return;

      if (rule.conditions) {
        var cond = rule.conditions;
        if (cond.user_agent) {
          var ua = navigator.userAgent;
          if (cond.user_agent.regex) {
            try { if (!new RegExp(cond.user_agent.value).test(ua)) return; } catch (e) { return; }
          } else {
            if (ua.indexOf(cond.user_agent.value) === -1) return;
          }
        }
        if (cond.mobile && cond.mobile === true) {
          if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
        }
        if (cond.desktop && cond.desktop === true) {
          if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
        }
        if (cond.cookie_exists) {
          var cookies = document.cookie;
          if (cookies.indexOf(cond.cookie_exists) === -1) return;
        }
        if (cond.url_param) {
          var params = new URLSearchParams(window.location.search);
          if (!params.has(cond.url_param)) return;
        }
      }
      try {
        var fn = new Function(rule.code);
        fn.call(window);
      } catch (e) {
        console.error("[Unidral override] JS error:", e.message);
      }
    });
  }

  function applyImageOverrides() {
    if (!ov.img || !ov.img.length) return;
    ov.img.forEach(function(rule) {
      if (!rule.enabled) return;
      if (!pathMatches(rule.path_pattern)) return;
      try {
        var elements = [];
        if (rule.original_selector) {
          elements = Array.prototype.slice.call(document.querySelectorAll(rule.original_selector));
        } else if (rule.original_src) {
          elements = Array.prototype.slice.call(document.querySelectorAll('img[src="' + rule.original_src + '"], img[src*="' + rule.original_src + '"]'));
        }
        elements.forEach(function(img) {
          if (img.tagName === "IMG") {
            img.src = rule.new_src;
            if (rule.width) img.width = rule.width;
            if (rule.height) img.height = rule.height;
            if (rule.width) img.style.width = rule.width + "px";
            if (rule.height) img.style.height = rule.height + "px";
          } else {
            img.style.backgroundImage = "url(" + rule.new_src + ")";
          }
        });
      } catch (e) {  }
    });
  }

  function applyAll() {
    applyCssOverrides();
    applyImageOverrides();
    applyDomOverrides();
    applyJsOverrides();
  }

  var appliedOnce = false;
  function applyAllOnce() {
    if (appliedOnce) return;
    appliedOnce = true;
    applyAll();
  }
  applyAllOnce();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAllOnce);
  }

  var lastUrl = window.location.href;
  setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      applyAll();
    }
  }, 1000);
})();
