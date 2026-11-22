// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body?: unknown }>, state: "start" }));
vi.mock("../../state/api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    const { jayaPreviewView } = await import("./preview-data");
    server.calls.push({ path, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const view = jayaPreviewView(server.state, Date.parse("2026-11-22T12:00:00Z"));
    if (path === "/api/jaya/engagements" && init?.method === "POST") { server.state = "intake"; return { id: "preview" }; }
    if (path === "/api/jaya/engagements") return view ? [view.engagement] : [];
    if (path.startsWith("/api/jaya/engagements/preview/intake")) return { reply: "", ready: false };
    if (path.startsWith("/api/jaya/engagements/")) return view;
    return {};
  }),
}));

import { initialState, StoreContext } from "@/state/store";
import { briefChecks } from "@/state/jaya";
import { emptyBrief } from "../../../shared/jaya";
import { JayaPage } from "./JayaPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const mount = () => act(async () => {
  root.render(createElement(StoreContext.Provider, { value: { state: initialState, dispatch: vi.fn() } as never }, createElement(JayaPage)));
});
const button = (text: string) => [...document.querySelectorAll("button")].find((one) => one.textContent?.includes(text));

beforeEach(() => {
  server.calls.length = 0;
  document.body.innerHTML = "<div id=root></div>";
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => act(async () => root.unmount()));

describe("the Jaya page", () => {
  it("offers to start a call when there is no engagement, and opens the call once started", async () => {
    server.state = "start";
    await mount();
    await settle();
    expect(document.querySelector("[data-jaya]")?.getAttribute("data-jaya")).toBe("start");
    await act(async () => { button("Start the call")!.click(); });
    await settle();
    expect(server.calls.find((call) => call.method === "POST")).toMatchObject({ path: "/api/jaya/engagements", body: { phone: null } });
    expect(document.querySelector("[data-jaya-call]")?.getAttribute("data-jaya-call")).toBe("intake");
  });

  it("sends a typed answer on Enter and shows the brief's progress", async () => {
    server.state = "intake";
    await mount();
    await settle();
    expect(document.body.textContent).toContain("Brief 4 of 5");
    const box = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Weekly on Monday");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(server.calls.find((call) => call.path.endsWith("/intake"))).toMatchObject({ method: "POST", body: { text: "Weekly on Monday" } });
  });

  it("shows the check-in and the review on the team's page, and needs a reason to send work back", async () => {
    server.state = "dashboard";
    await mount();
    await settle();
    expect(document.body.textContent).toContain("Two quick questions from your team.");
    expect(button("Send it back")?.disabled).toBe(true);
    await act(async () => { button("Looks good")!.click(); });
    await settle();
    expect(server.calls.find((call) => call.path.endsWith("/review"))).toMatchObject({ body: { verdict: "accepted", feedback: null } });
  });
});

describe("the brief's checklist", () => {
  it("is done only when every outcome has a deliverable and criteria", () => {
    expect(briefChecks(emptyBrief()).every((check) => !check.done)).toBe(true);
    const outcome = { title: "Posts", why: "", deliverable: "Captions", successCriteria: [], cadence: "weekly", deadline: null, constraints: [] };
    const checks = briefChecks({ ...emptyBrief(), outcomes: [outcome], contactPreferences: "text" });
    expect(Object.fromEntries(checks.map((check) => [check.key, check.done]))).toEqual({ outcomes: true, deliverables: true, criteria: false, context: false, contact: true });
  });
});
