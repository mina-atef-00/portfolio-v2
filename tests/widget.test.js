/**
 * tests/widget.test.js
 *
 * The widget in a real DOM (jsdom) with fetch stubbed. Two things matter:
 * that it adopts the inline #ask-widget markup index.html ships, and that no
 * failure path can leave the panel broken or a reply injected as HTML.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../assets/chat.js";

const EMAIL = "mina.atef.00@gmail.com";
const INDEX = readFileSync(join(process.cwd(), "index.html"), "utf8");

/** The exact block index.html ships, lifted out of the real page. */
function inlineMarkup() {
  const start = INDEX.indexOf('<div class="ask" id="ask-widget">');
  expect(start, "index.html no longer ships #ask-widget").toBeGreaterThan(-1);
  const end = INDEX.indexOf("<script", start);
  return INDEX.slice(start, end);
}

const AskWidget = () => globalThis.AskWidget;

const reply = (text = "docpipe builds a traceable index.", source = "rules") =>
  new Response(JSON.stringify({ reply: text, source }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const root = () => document.querySelector(".ask");
const panel = () => document.querySelector(".ask-panel");
const bubble = () => document.querySelector(".ask-bubble");
const log = () => document.querySelector(".ask-log");
const status = () => document.querySelector(".ask-status");
const input = () => document.querySelector(".ask-input");
const send = () => document.querySelector(".ask-send");
const messages = () => [...log().querySelectorAll(".ask-msg")];
const last = () => log().lastElementChild;

/** Submit through the form itself, the way a visitor does. */
async function askViaForm(text) {
  input().value = text;
  document.querySelector(".ask-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    const node = last();
    if (!node || node.textContent === "…") throw new Error("still pending");
  });
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = inlineMarkup();
  AskWidget().destroy();
  AskWidget().mount();
});

afterEach(() => {
  AskWidget().destroy();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("adopting the inline markup", () => {
  it("comes alive without shipping its own skin", () => {
    expect(root().classList.contains("is-live")).toBe(true);
    expect(document.getElementById("ask-widget-fallback-styles")).toBeNull();
    expect(document.querySelectorAll("#ask-widget, .ask-bubble, .ask-input").length).toBe(3);
  });

  it("starts closed, with the panel hidden and the bubble named", () => {
    expect(panel().hidden).toBe(true);
    expect(bubble().getAttribute("aria-expanded")).toBe("false");
    expect(bubble().getAttribute("aria-controls")).toBe("ask-panel");
    expect(bubble().getAttribute("aria-label")).toBeTruthy();
    expect(AskWidget().isOpen()).toBe(false);
  });

  it("opens on click, greets once, and focuses the input", () => {
    bubble().click();
    expect(panel().hidden).toBe(false);
    expect(bubble().getAttribute("aria-expanded")).toBe("true");
    expect(log().textContent).toMatch(/ask about mina's projects/);
    expect(document.activeElement).toBe(input());

    bubble().click();
    expect(panel().hidden).toBe(true);
    bubble().click();
    expect(messages().length).toBe(1); // the greeting is not repeated
  });

  it("closes on Escape and hands focus back to the bubble", () => {
    bubble().click();
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(bubble());
  });

  it("keeps the row order the stylesheet's grid expects", () => {
    const rows = [...panel().children].map((node) => node.className);
    expect(rows).toEqual(["ask-bar", "ask-log", "ask-status", "ask-form"]);
  });

  it("rebuilds a partial panel rather than half-driving it", () => {
    AskWidget().destroy();
    document.body.innerHTML = '<div class="ask" id="ask-widget"><div class="ask-panel"><div class="ask-bar"></div></div></div>';
    AskWidget().mount();

    // The four grid rows, in order, exactly once each.
    expect([...document.querySelector(".ask-panel").children].map((n) => n.className)).toEqual([
      "ask-bar",
      "ask-log",
      "ask-status",
      "ask-form",
    ]);
    expect(document.querySelectorAll(".ask-panel, .ask-bubble, .ask-input").length).toBe(3);
  });
});

describe("building from scratch", () => {
  it("creates the same structure and a skin when the page ships none", () => {
    AskWidget().destroy();
    document.body.innerHTML = "";
    AskWidget().mount();

    expect(document.getElementById("ask-widget")).toBeTruthy();
    expect(document.getElementById("ask-widget-fallback-styles")).toBeTruthy();
    expect([...document.querySelector(".ask-panel").children].map((n) => n.className)).toEqual([
      "ask-bar",
      "ask-log",
      "ask-status",
      "ask-form",
    ]);
    expect(bubble().getAttribute("aria-controls")).toBe("ask-panel");
  });
});

describe("asking a question", () => {
  it("POSTs the contract body same-origin and renders the reply", async () => {
    fetchMock.mockResolvedValueOnce(reply());
    await askViaForm("what is docpipe?");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/.netlify/functions/chat");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ message: "what is docpipe?" });

    const roles = messages().map((node) => node.getAttribute("data-role"));
    expect(roles.slice(-2)).toEqual(["you", "bot"]);
    expect(last().textContent).toContain("docpipe builds a traceable index.");
    expect(status().textContent).toBe("");
  });

  it("shows where the answer came from", async () => {
    fetchMock.mockResolvedValueOnce(reply("hello", "groq"));
    await AskWidget().ask("hello");
    await vi.waitFor(() => expect(last().querySelector(".src")).toBeTruthy());

    expect(last().querySelector(".src").textContent).toBe("via groq");
    expect(messages()[0].querySelector(".src")).toBeNull(); // the greeting has no source
  });

  it("does not send an empty or whitespace-only message", async () => {
    const form = document.querySelector(".ask-form");
    for (const text of ["", "   "]) {
      input().value = text;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(messages().length).toBe(0);
  });

  it("refuses an oversized message without spending a call", async () => {
    await AskWidget().ask("x".repeat(1001));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(last().getAttribute("data-state")).toBe("error");
  });

  it("ignores a second submit while the first is in flight", async () => {
    let release;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = AskWidget().ask("first");
    AskWidget().ask("second");
    release(reply());
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders a reply as text, never as HTML", async () => {
    fetchMock.mockResolvedValueOnce(reply("<img src=x onerror=alert(1)>"));
    await AskWidget().ask("hi");
    await vi.waitFor(() => expect(log().textContent).toContain("<img"));

    expect(log().querySelector("img")).toBeNull();
    expect(last().textContent).toMatch(/^<img src=x onerror=alert\(1\)>/); // reply text, plus the source badge
  });

  it("has an accessible name for every control it renders", () => {
    bubble().click();
    expect(document.querySelector(".ask-close").getAttribute("aria-label")).toBeTruthy();
    expect(send().textContent.trim()).toBeTruthy();
    expect(document.querySelector(`label[for="${input().id}"]`)).toBeTruthy();
  });
});

describe("graceful failure", () => {
  const failures = [
    ["the network is down", () => Promise.reject(new TypeError("fetch failed"))],
    ["the function 500s", () => Promise.resolve(new Response("boom", { status: 500 }))],
    ["the function 404s", () => Promise.resolve(new Response("nope", { status: 404 }))],
    ["the body is not JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["the reply is missing", () => Promise.resolve(reply("", "canned"))],
  ];

  for (const [what, respond] of failures) {
    it(`degrades to a readable message when ${what}`, async () => {
      fetchMock.mockImplementationOnce(respond);
      await AskWidget().ask("who is mina?");

      await vi.waitFor(() => expect(last().getAttribute("data-state")).toBe("error"));

      expect(last().textContent).toContain(EMAIL);
      expect(status().getAttribute("data-state")).toBe("offline");
      expect(status().textContent).toContain(EMAIL);
      expect(messages().slice(-2, -1)[0].textContent).toBe("who is mina?");
      expect(send().disabled).toBe(false);
      expect(log().textContent).not.toBe("…"); // no stuck typing indicator
      expect(AskWidget().isOnline()).toBe(false);
    });
  }

  it("recovers on the next question and clears the offline note", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));
    await AskWidget().ask("broken");
    await vi.waitFor(() => expect(last().getAttribute("data-state")).toBe("error"));

    fetchMock.mockResolvedValueOnce(reply("Recovered."));
    await AskWidget().ask("again");
    await vi.waitFor(() => expect(last().textContent).toMatch(/Recovered\./));

    expect(last().getAttribute("data-state")).toBeNull();
    expect(status().getAttribute("data-state")).toBeNull();
    expect(status().textContent).toBe("");
    expect(AskWidget().isOnline()).toBe(true);
  });

  it("stops waiting on a hung request instead of hanging the panel", async () => {
    AskWidget().destroy();
    document.body.innerHTML = inlineMarkup();
    AskWidget().mount({ timeoutMs: 50 });

    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const pending = AskWidget().ask("no answer");
      await vi.advanceTimersByTimeAsync(60);
      await pending;

      expect(last().getAttribute("data-state")).toBe("error");
      expect(send().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the message length at what the function accepts", () => {
    expect(input().maxLength).toBe(1000);
  });
});
