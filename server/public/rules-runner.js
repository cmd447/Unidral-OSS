(function() {
  "use strict";
  if (window.__UNIDRAL_RULES_RUNNER__) return;
  window.__UNIDRAL_RULES_RUNNER__ = true;
  var config = window.__UNIDRAL_CONFIG__ || {};
  var rules = [];
  try {
    if (config.r) {
      rules = JSON.parse(atob(config.r));
    } else if (Array.isArray(config.rules)) {
      rules = config.rules.slice();
    }
  } catch (e) {
    rules = Array.isArray(config.rules) ? config.rules.slice() : [];
  }
  var bindings = [];
  var boundByRule = new Map;
  var compiledByRule = new Map;
  var failuresByRule = new Map;
  var trippedRules = new Set;
  var MAX_RULE_FAILURES = 5;
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
        var htmlCode = rule.code || "";
        fn = function(element, event, ctx) {
          injectHtml(element, htmlCode);
        };
      } else {
        fn = new Function("element", "event", "ctx", rule.code || "");
      }
    } catch (err) {
      console.error("[rt] rule compile error", rule.id, err);
    }
    compiledByRule.set(rule.id, fn);
    return fn;
  }
  function runRule(fn, element, event, rule) {
    try {
      fn.call(element, element, event, {
        rule: rule,
        config: config
      });
      failuresByRule.set(rule.id, 0);
    } catch (err) {
      console.error("[rt] rule error", rule, err);
      var failures = (failuresByRule.get(rule.id) || 0) + 1;
      failuresByRule.set(rule.id, failures);
      if (failures >= MAX_RULE_FAILURES) {
        if (!trippedRules.has(rule.id)) {
          trippedRules.add(rule.id);
          console.warn("[rt] rule auto-disabled after " + failures + " errors: " + rule.selector);
        }
      }
    }
  }
  function eventTypeFor(rule) {
    if (rule.trigger === "hover") return "mouseenter";
    if (rule.trigger === "submit") return "submit";
    if (rule.trigger === "click") return "click";
    if (rule.trigger === "custom") return rule.event_name || null;
    return null;
  }
  function isToolbarNode(element) {
    return element && element.closest && element.closest("[data-rt]");
  }
  function scoreCandidate(element, fingerprint) {
    var score = 0;
    var attr = function(name) {
      var value = element.getAttribute(name);
      return value ? value.trim() : null;
    };
    if (fingerprint.id && element.id === fingerprint.id) score += 5;
    if (fingerprint.testId && (attr("data-testid") === fingerprint.testId || attr("data-test") === fingerprint.testId)) score += 5;
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
    Array.prototype.forEach.call(candidates, function(candidate) {
      if (isToolbarNode(candidate)) return;
      var score = scoreCandidate(candidate, fingerprint);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    return best ? [ best ] : [];
  }
  function teardown() {
    bindings.forEach(function(b) {
      try {
        b.element.removeEventListener(b.type, b.handler, b.options);
      } catch (err) {}
    });
    bindings = [];
    boundByRule = new Map;
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
        return;
      }
      if (!nodes.length) nodes = reanchor(rule);
      Array.prototype.forEach.call(nodes, function(element) {
        if (isToolbarNode(element) || seen.has(element)) return;
        seen.add(element);
        if (rule.trigger === "load") {
          runRule(fn, element, null, rule);
          return;
        }
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
  }
  var reapplyQueued = false;
  function queueApply() {
    if (reapplyQueued) return;
    reapplyQueued = true;
    window.requestAnimationFrame(function() {
      reapplyQueued = false;
      applyRules(false);
    });
  }
  function observe() {
    var target = document.body || document.documentElement;
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          queueApply();
          return;
        }
      }
    });
    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }
  var rulesApplied = false;
  function applyInitialRules() {
    if (rulesApplied) return;
    rulesApplied = true;
    applyRules(true);
  }
  function boot() {
    applyInitialRules();
    observe();
  }
  applyInitialRules();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {
    once: true
  }); else boot();
})();
