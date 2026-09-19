/*!
 * chat.js — the portfolio assistant.
 *
 * Progressive enhancement of the inline `#ask-widget` markup in index.html:
 * the page ships the structure, this file makes it work. If the markup is
 * missing (another page, another template) the same structure is built from
 * scratch, so the widget is never dependent on being wired by hand.
 *
 *   <script src="assets/chat.js" defer></script>
 *   <script>AskWidget.mount();</script>
 *
 * It POSTs { message } to a same-origin Netlify Function and renders
 * { reply, source }. There are no credentials here, and there never can be:
 * the browser only ever talks to its own origin. Every failure path ends in a
 * readable message, so a dead network cannot leave the panel stuck.
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    endpoint: "/.netlify/functions/chat",
    root: "#ask-widget",
    title: "ask about mina",
    tip: "ask about mina",
    placeholder: "projects, skills, contact…",
    greeting:
      "hi — ask about mina's projects, skills, experience, education or how to get in touch. answers come from the facts on this site.",
    unavailable: "i can't reach the assistant right now — mina reads everything at mina.atef.00@gmail.com.",
    tooLong: "that's a little long — try a sentence or two.",
    thinking: "thinking…",
    offline: "offline — mina reads everything at mina.atef.00@gmail.com",
    sources: { rules: "via rules", gemini: "via gemini", groq: "via groq", canned: "via fallback" },
    showSource: true,
    timeoutMs: 15000,
    maxChars: 1000,
    startOpen: false,
  };

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.7-5.1a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 8.4Z"/>' +
    '<circle cx="8.5" cy="11.5" r=".9" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="11.5" r=".9" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="11.5" r=".9" fill="currentColor" stroke="none"/></svg>';

  /** Minimal skin, used only when the page has no .ask styles of its own. */
  var FALLBACK_CSS = [
    ".ask{position:fixed;right:1.25rem;bottom:1.25rem;z-index:70;display:none;flex-direction:column;align-items:flex-end;gap:.7rem;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}",
    ".ask.is-live{display:flex}",
    ".ask-bubble{position:relative;width:3.4rem;height:3.4rem;border-radius:50%;border:2px solid #f6ead7;background:#6b1f2a;color:#f6ead7;display:grid;place-items:center;cursor:pointer}",
    ".ask-bubble svg{width:1.4rem;height:1.4rem}",
    ".ask-panel{display:grid;grid-template-rows:auto minmax(6rem,1fr) auto auto;width:min(23rem,calc(100vw - 2.5rem));max-height:min(30rem,68vh);background:#3d0f16;color:#f6ead7;border:2px solid #150c05;border-radius:4px;overflow:hidden}",
    ".ask-panel[hidden]{display:none}",
    ".ask-bar{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.55rem .7rem;border-bottom:1px solid rgba(246,234,215,.16)}",
    ".ask-close{background:none;border:0;color:inherit;font-size:1rem;cursor:pointer}",
    ".ask-log{display:flex;flex-direction:column;gap:.55rem;padding:.85rem .8rem;min-height:6rem;overflow-y:auto}",
    ".ask-msg{max-width:90%;padding:.5rem .65rem;border-radius:3px;white-space:pre-wrap;overflow-wrap:anywhere}",
    '.ask-msg[data-role="bot"]{align-self:flex-start;background:rgba(246,234,215,.09)}',
    '.ask-msg[data-role="you"]{align-self:flex-end;background:rgba(246,234,215,.92);color:#3d0f16}',
    ".ask-msg .src{display:block;margin-top:.35rem;font-size:.62rem;opacity:.55}",
    ".ask-status{padding:0 .8rem .5rem;font-size:.65rem;opacity:.7}",
    '.ask-status[data-state="offline"]{opacity:1}',
    ".ask-form{display:flex;gap:.45rem;padding:.6rem .65rem;border-top:1px solid rgba(246,234,215,.16)}",
    ".ask-input{flex:1;min-width:0;background:rgba(246,234,215,.08);color:inherit;border:1.5px solid rgba(246,234,215,.32);border-radius:2px;padding:.44rem .55rem;font:inherit}",
    ".ask-send{border:1.5px solid #150c05;border-radius:2px;background:#d9a13b;color:#150c05;padding:.44rem .6rem;cursor:pointer}",
    ".ask-send:disabled{opacity:.5;cursor:default}",
    ".ask-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
  ].join("");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // textContent always: replies are never HTML
    return node;
  }

  function ensureStyles() {
    if (document.getElementById("ask-widget-fallback-styles")) return;
    var style = el("style");
    style.id = "ask-widget-fallback-styles";
    style.textContent = FALLBACK_CSS;
    document.head.appendChild(style);
  }

  /**
   * The panel, in the row order the stylesheet expects:
   * bar / log / status / form.
   */
  function buildPanel(opts) {
    var panel = el("div", "ask-panel");
    panel.id = "ask-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", opts.title);

    var bar = el("div", "ask-bar");
    bar.appendChild(el("span", "ask-title", opts.title));
    var close = el("button", "ask-close", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "close the assistant");
    bar.appendChild(close);

    var log = el("div", "ask-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-relevant", "additions");

    var status = el("p", "ask-status");
    status.setAttribute("role", "status");

    var form = el("form", "ask-form");
    var label = el("label", "ask-sr", "your question");
    label.setAttribute("for", "ask-input");
    var input = el("input", "ask-input");
    input.id = "ask-input";
    input.type = "text";
    input.name = "message";
    input.autocomplete = "off";
    input.maxLength = opts.maxChars;
    input.placeholder = opts.placeholder;
    var send = el("button", "ask-send", "send");
    send.type = "submit";
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(send);

    panel.appendChild(bar);
    panel.appendChild(log);
    panel.appendChild(status);
    panel.appendChild(form);
    return panel;
  }

  function buildBubble(opts) {
    var bubble = el("button", "ask-bubble");
    bubble.type = "button";
    bubble.setAttribute("aria-expanded", "false");
    bubble.setAttribute("aria-controls", "ask-panel");
    bubble.setAttribute("aria-label", opts.title);
    var tip = el("span", "ask-tip", opts.tip);
    tip.setAttribute("aria-hidden", "true");
    bubble.appendChild(tip);
    bubble.appendChild(el("span", "ping"));
    bubble.insertAdjacentHTML("beforeend", CHAT_ICON);
    return bubble;
  }

  var MOUNTED = null;

  function create(opts) {
    var existing = opts.root ? document.querySelector(opts.root) : null;
    var root = existing;
    var built = false;

    if (!root) {
      root = el("div", "ask");
      if (opts.root && /^#[\w-]+$/.test(opts.root)) root.id = opts.root.slice(1);
      built = true;
    }

    var panel = root.querySelector(".ask-panel");
    if (!panel || !panel.querySelector(".ask-log") || !panel.querySelector(".ask-form")) {
      // Missing or incomplete markup: rebuild the panel rather than half-drive it.
      if (panel) panel.remove();
      panel = buildPanel(opts);
      root.appendChild(panel);
      built = true;
    }
    if (!root.querySelector(".ask-bubble")) {
      root.appendChild(buildBubble(opts));
      built = true;
    }
    if (built) ensureStyles();

    var bubble = root.querySelector(".ask-bubble");
    var log = panel.querySelector(".ask-log");
    var status = panel.querySelector(".ask-status");
    var form = panel.querySelector(".ask-form");
    var input = panel.querySelector(".ask-input");
    var send = panel.querySelector(".ask-send");
    var close = panel.querySelector(".ask-close");

    input.maxLength = opts.maxChars;
    root.classList.add("is-live");

    var pending = false;
    var greeted = false;
    var offline = false;

    function say(role, text, state) {
      var node = el("div", "ask-msg", text);
      node.setAttribute("data-role", role);
      if (state) node.setAttribute("data-state", state);
      log.appendChild(node);
      log.scrollTop = log.scrollHeight;
      return node;
    }

    function note(text, source, state) {
      var node = say("bot", text, state);
      if (opts.showSource && source && opts.sources[source]) {
        node.appendChild(el("span", "src", opts.sources[source]));
      }
      return node;
    }

    function setStatus(text, state) {
      status.textContent = text || "";
      if (state) status.setAttribute("data-state", state);
      else status.removeAttribute("data-state");
    }

    function open() {
      panel.hidden = false;
      bubble.setAttribute("aria-expanded", "true");
      if (!greeted) {
        greeted = true;
        note(opts.greeting, null);
      }
      input.focus();
    }

    function shut() {
      panel.hidden = true;
      bubble.setAttribute("aria-expanded", "false");
      bubble.focus();
    }

    function submit(message) {
      var text = String(message == null ? "" : message).trim();
      if (pending) return Promise.resolve(null);
      if (!text) return Promise.resolve(null);
      if (text.length > opts.maxChars) {
        note(opts.tooLong, null, "error");
        return Promise.resolve(null);
      }
      say("you", text);
      input.value = "";

      pending = true;
      send.disabled = true;
      setStatus(opts.thinking);
      var typing = say("bot", "\u2026");

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller
        ? setTimeout(function () {
            controller.abort();
          }, opts.timeoutMs)
        : null;

      return fetch(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller ? controller.signal : undefined,
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          var reply = data && typeof data.reply === "string" ? data.reply : "";
          if (!reply) throw new Error("empty reply");
          typing.remove();
          offline = false;
          setStatus("");
          note(reply, data.source);
          return data;
        })
        .catch(function () {
          typing.remove();
          offline = true;
          setStatus(opts.offline, "offline");
          note(opts.unavailable, null, "error");
          return null;
        })
        .then(function (result) {
          if (timer) clearTimeout(timer);
          pending = false;
          send.disabled = false;
          input.focus();
          return result;
        });
    }

    bubble.addEventListener("click", function () {
      if (panel.hidden) open();
      else shut();
    });
    close.addEventListener("click", shut);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submit(input.value);
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) shut();
    });

    MOUNTED = {
      root: root,
      options: opts,
      open: open,
      close: shut,
      ask: function (message) {
        open();
        return submit(message);
      },
      isOpen: function () {
        return !panel.hidden;
      },
      isOnline: function () {
        return !offline;
      },
      messages: function () {
        return Array.prototype.map.call(log.querySelectorAll(".ask-msg"), function (node) {
          return { role: node.getAttribute("data-role"), text: node.textContent };
        });
      },
      destroy: function () {
        root.classList.remove("is-live");
        panel.hidden = true;
        MOUNTED = null;
      },
    };
    return MOUNTED;
  }

  var AskWidget = {
    mount: function (options) {
      if (MOUNTED) return MOUNTED;
      var opts = Object.assign({}, DEFAULTS, options || {});
      var host = document.body || document.documentElement;
      var instance = create(opts);
      if (!instance.root.parentNode) host.appendChild(instance.root);
      if (instance.options.startOpen) instance.open();
      return instance;
    },
    destroy: function () {
      if (MOUNTED) MOUNTED.destroy();
    },
    ask: function (message) {
      var instance = MOUNTED || AskWidget.mount();
      return instance.ask(message);
    },
    isOpen: function () {
      return Boolean(MOUNTED && MOUNTED.isOpen());
    },
    isOnline: function () {
      return Boolean(MOUNTED && MOUNTED.isOnline());
    },
    messages: function () {
      return MOUNTED ? MOUNTED.messages() : [];
    },
    options: DEFAULTS,
  };

  global.AskWidget = AskWidget;

  // Self-mount: index.html ships the markup and expects it to come alive.
  function autoMount() {
    if (MOUNTED) return;
    if (!document.querySelector(DEFAULTS.root)) return;
    AskWidget.mount();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoMount);
    } else {
      autoMount();
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = AskWidget;
})(typeof globalThis !== "undefined" ? globalThis : this);
