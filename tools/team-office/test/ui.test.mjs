// Browser tests: the real office UI in Chromium (Playwright), against the server + fake claude.
// Skipped when Playwright isn't available (set PLAYWRIGHT_MODULE to its entry file, or `npm i playwright`).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeStudio, startServer, until, isWindows } from "./helpers.mjs";

let chromium = null;
for (const spec of [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"].filter(Boolean)) {
  try {
    ({ chromium } = await import(spec));
    break;
  } catch {}
}
const executablePath = ["/opt/pw-browsers/chromium", process.env.CHROMIUM_PATH].filter(Boolean).find((p) => fs.existsSync(p));
const skip = !chromium && "Playwright not installed";
const SHOTS = process.env.UI_SHOTS; // folder to save screenshots in (optional)

const PROPOSE = (name) => `Great — here's the plan. Shall I get the team started?\nPROPOSE: ${name} | Build a page that says hello\nSIZE: quick`;

describe("office UI", { skip }, () => {
  let browser;
  before(async () => (browser = await chromium.launch(executablePath ? { executablePath } : {})));
  after(() => browser?.close());

  // a fresh studio + server + page per scenario
  async function open(control = {}, { width = 1440, height = 900, view } = {}) {
    const s = makeStudio();
    const srv = await startServer(s, { control });
    const ctx = await browser.newContext({ viewport: { width, height } });
    if (view) await ctx.addInitScript((v) => localStorage.setItem("view", v), view);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => d.accept()); // confirm() → OK
    await page.goto(srv.base, { waitUntil: "load" });
    await page.waitForTimeout(600);
    const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
    return {
      s, srv, page, ctx, errors, shot,
      close: async () => {
        await ctx.close();
        await srv.stop();
        s.cleanup();
      },
    };
  }
  const visible = (page, sel) => page.locator(sel).first().isVisible();
  // switching views turns the page, so the new view is in place a frame after the click
  const switchView = async (page, view) => {
    await page.click(view === "tech" ? "#viewTech" : "#viewSimple");
    await page.waitForFunction((tech) => document.documentElement.classList.contains("tech-view") === tech, view === "tech");
  };
  // run a scenario on a fresh studio; always clean up (a leftover server would keep the test process alive)
  const scenario = (name, control, opts, fn) =>
    test(name, { skip: opts.posix && isWindows ? "requires the POSIX test fixture" : false }, async () => {
      const t = await open(control, opts);
      try {
        await fn(t);
      } catch (e) {
        await t.shot(`FAILED-${name.slice(0, 30).replace(/\W+/g, "-")}`);
        throw e;
      } finally {
        await t.close();
      }
    });

  scenario("first visit: simple view, welcome, idle card, nothing technical, no errors", {}, {}, async (t) => {
    const { page } = t;
    assert.ok(await visible(page, "#welcome"));
    assert.ok(await visible(page, ".progress-panel"));
    assert.match(await page.locator("#progress").innerText(), /What would you like to build/);
    for (const tech of [".graph-panel", ".timeline-panel", ".log-panel", "#phases", "#hero", "#roster"]) assert.equal(await visible(page, tech), false, `${tech} hidden`);
    assert.equal(await visible(page, "#setup"), false, "setup is complete");
    assert.match(await page.locator("#overlay").innerText(), /Asha/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scrolling");
    // every visible button has a name a screen reader can announce
    const unnamed = await page.$$eval("button", (bs) => bs.filter((b) => b.offsetParent && !(b.innerText.trim() || b.getAttribute("aria-label"))).map((b) => b.outerHTML));
    assert.deepEqual(unnamed, []);
    await t.shot("01-first-visit");
    assert.deepEqual(t.errors, []);
  });

  scenario("Behind the scenes shows the technical panels, and it's remembered", {}, {}, async (t) => {
    const { page } = t;
    await switchView(page, "tech");
    assert.ok(await visible(page, ".graph-panel"));
    assert.equal(await visible(page, ".progress-panel"), false);
    assert.match(await page.locator("#overlay").innerText(), /architect/);
    await page.reload();
    await page.waitForTimeout(400);
    assert.equal(await page.getAttribute("#viewTech", "aria-pressed"), "true");
    // tabs: arrow keys move between them
    await page.focus("#tabLog");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getAttribute("#tabProjects", "aria-selected"), "true");
    assert.ok(await visible(page, "#projects"));
    await t.shot("02-behind-the-scenes");
    await switchView(page, "simple");
    assert.match(await page.locator("#overlay").innerText(), /Asha/);
    assert.deepEqual(t.errors, []);
  });

  scenario("signed out: the setup checklist says how to fix it; the chat explains instantly", { loggedIn: false }, { posix: true }, async (t) => {
    const { page } = t;
    await page.waitForSelector("#setup:not([hidden])");
    const text = await page.locator("#setup").innerText();
    assert.match(text, /Signed in to Claude/);
    assert.match(text, /claude auth login/);
    assert.match(await page.locator("#headline").innerText(), /Almost ready/);
    await page.fill("#chatText", "Build me a to-do app");
    await page.press("#chatText", "Enter");
    await page.waitForSelector("text=The manager can't reply yet");
    assert.ok(await visible(page, "button:has-text('SHOW ME HOW TO FIX IT')"));
    await t.shot("03-signed-out");
  });

  scenario("the whole journey: example → choices → Start → Ready → ▶ Open → the app", { lead: "finish", manager: ["Where will you use it?\nCHOICES: On my computer | On my phone", PROPOSE("hello-page")] }, { posix: true }, async (t) => {
    const { page, ctx } = t;
    await page.click("#examples button >> nth=0");
    assert.equal(await page.inputValue("#startText"), "A simple to-do list I can use in my browser");
    await page.press("#startText", "Enter");
    await page.waitForSelector(".choices button");
    await page.click(".choices button:has-text('On my computer')");
    await page.waitForSelector(".proposal [data-run='start']");
    assert.match(await page.locator(".proposal .p-head").last().innerText(), /Quick change/);
    assert.match(await page.locator(".proposal .p-dir").last().innerText(), /New project “hello-page”/);
    await t.shot("04-proposal");
    await page.click(".proposal [data-run='start']");
    await page.waitForSelector("#progress >> text=is ready", { timeout: 20000 });
    assert.ok(await visible(page, "#progress button:has-text('OPEN IT')"));
    await page.waitForSelector(".report >> text=What you got");
    await page.waitForSelector(".pf-card button:has-text('Open')");
    await t.shot("05-ready");
    const [app] = await Promise.all([ctx.waitForEvent("page"), page.click(".pf-card button:has-text('Open')")]);
    await app.waitForURL(/^http:\/\/localhost:4[5-9]\d\d\/$/, { timeout: 15000 }); // the app's own port, not the office's launch page
    assert.match(await app.locator("h1").innerText(), /Hello from the team v1/);
    assert.deepEqual(t.errors, []);
  });

  scenario("a question with answer options: buttons in the banner, then the team carries on", { lead: "askopts", onResume: "finish", manager: [PROPOSE("layout-app")] }, { posix: true }, async (t) => {
    const { page } = t;
    await page.fill("#chatText", "Make me a page");
    await page.press("#chatText", "Enter");
    await page.click(".proposal [data-run='start']");
    await page.waitForSelector("#askBanner:not([hidden])", { timeout: 15000 });
    assert.match(await page.locator("#askFrom").innerText(), /ASHA/);
    assert.ok(await visible(page, "#askActions button:has-text('Cards')"));
    assert.equal(await visible(page, "#askActions button:has-text('APPROVE')"), false, "no meaningless Approve for a real choice");
    await page.waitForSelector("#progress >> text=needs your answer");
    assert.match(await page.locator("#chatLog").innerText(), /NEEDS YOUR ANSWER/);
    await t.shot("06-question");
    await page.click("#askActions button:has-text('Cards')");
    await page.waitForSelector("#progress >> text=is ready", { timeout: 20000 });
    assert.doesNotMatch(await page.locator("#chatLog").innerText(), /NEEDS YOUR ANSWER/, "an answered question isn't flagged any more");
    const inbox = t.srv.fakeLog().filter((l) => l.role === "lead");
    assert.equal(inbox.length, 2, "the run continued in a second (resumed) call");
  });

  scenario("■ Stop, then ↻ Continue from the chat", { lead: "long", onResume: "finish", manager: [PROPOSE("long-app")] }, { posix: true }, async (t) => {
    const { page } = t;
    await page.fill("#chatText", "Build it");
    await page.press("#chatText", "Enter");
    await page.click(".proposal [data-run='start']");
    await page.waitForSelector("#runBar [data-run='stop']", { timeout: 15000 });
    await until(() => fs.existsSync(path.join(t.s.state, "state.json")) && t.s.read("state.json").phase === "build", 10000, "building");
    await page.click("#runBar [data-run='stop']");
    await page.waitForSelector(".msg-actions button:has-text('CONTINUE')", { timeout: 10000 });
    await page.click(".msg-actions button:has-text('CONTINUE') >> nth=-1");
    await page.waitForSelector("#progress >> text=is ready", { timeout: 20000 });
  });

  scenario("↶ Undo a change from the project card, then ↷ Redo", { lead: "finish", manager: [PROPOSE("undo-page")] }, { posix: true }, async (t) => {
    const { page, s } = t;
    for (let i = 0; i < 2; i++) {
      await page.fill("#chatText", `Build version ${i + 1}`);
      await page.press("#chatText", "Enter");
      await page.waitForSelector(".proposal [data-run='start']");
      await page.click(".proposal [data-run='start'] >> nth=-1");
      await until(() => s.read("run.json").status === "finished" && (i === 0 || s.read("run.json").checkpoint), 20000, `run ${i + 1}`);
    }
    const file = path.join(s.projects, "undo-page", "index.html");
    assert.match(fs.readFileSync(file, "utf8"), /v2/);
    await page.waitForSelector(".pf-history summary:has-text('Changes (2)')");
    await page.click(".pf-history summary");
    await page.click(".pf-history button:has-text('Undo this change')");
    await page.waitForSelector("text=back to how it was before");
    assert.match(fs.readFileSync(file, "utf8"), /v1/);
    await page.click(".msg-actions button:has-text('REDO') >> nth=-1");
    await until(() => /v2/.test(fs.readFileSync(file, "utf8")), 5000, "redo");
    await t.shot("07-undo");
  });

  scenario("settings: rename the studio, light theme, and the dialog handles the keyboard", {}, {}, async (t) => {
    const { page } = t;
    await page.click("#settingsBtn");
    await page.waitForSelector("#settingsModal:not([hidden])");
    assert.ok(await page.evaluate(() => document.getElementById("settingsModal").contains(document.activeElement)), "focus moved into the dialog");
    await page.fill("#setName", "Priya's Studio");
    await page.check('input[name="theme"][value="light"]');
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    await t.shot("08-settings");
    await page.click("#settingsSave");
    await page.waitForSelector("#settingsModal", { state: "hidden" });
    await page.waitForFunction(() => document.getElementById("studioName").textContent === "Priya's Studio");
    assert.equal(await page.title(), "Priya's Studio");
    await page.click("#settingsBtn");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#settingsModal", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement.id), "settingsBtn", "focus returns to the button");
  });

  scenario("phone-sized screen: composer fits and chat keeps focus off the background", {}, { width: 320, height: 680 }, async (t) => {
    const { page } = t;
    assert.ok(await visible(page, "#chatFab"));
    assert.equal(await visible(page, "#chat"), false);
    assert.ok(await visible(page, "#welcome"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator(".start-go").evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight));
    await page.locator(".start-go").click({ trial: true });
    await page.click("#chatFab");
    assert.ok(await visible(page, "#chat"));
    assert.equal(await page.getAttribute("#chat", "aria-modal"), "true");
    assert.ok(await page.locator(".progress-panel").evaluate((e) => e.inert));
    assert.equal(await page.evaluate(() => document.activeElement.id), "chatText");
    await t.shot("09-phone");
    await page.keyboard.press("Escape");
    assert.equal(await visible(page, "#chat"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "chatFab");
  });

  scenario("wide Simple view: the whole landing page fits the window — office and chat side by side, projects and the composer below", {}, {}, async (t) => {
    const { page } = t;
    await page.waitForTimeout(1200); // the panels have risen into place
    const box = (sel) => page.locator(sel).boundingBox();
    const [office, chat, projects, start] = await Promise.all([".office-panel", "#chat", ".portfolio-panel", ".progress-panel"].map(box));
    assert.ok(office.x < chat.x && Math.abs(office.y - chat.y) < 2, "the chat is beside the office");
    assert.ok(projects.x < start.x && Math.abs(projects.y - start.y) < 2, "projects and the composer are side by side");
    assert.ok(projects.y >= office.y + office.height - 2, "the office is on the first row");
    // no page scrolling: every panel is inside the window (with the first-visit welcome strip on top, too)
    assert.ok(await visible(page, "#welcome"));
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), "hidden");
    for (const b of [office, chat, projects, start]) assert.ok(b.y + b.height <= 900 + 1, "inside the window");
    assert.equal(await visible(page, "#chatMin"), false);
    assert.equal(await visible(page, "#chatFab"), false);
    // Behind the scenes: the chat is the side panel again, and can be minimized; back in Simple view it's shown anyway
    await switchView(page, "tech");
    await page.click("#chatMin");
    assert.equal(await visible(page, "#chat"), false);
    assert.ok(await visible(page, "#chatFab"));
    await switchView(page, "simple");
    assert.ok(await visible(page, "#chat"));
    assert.equal(await visible(page, "#chatFab"), false);
    await page.fill("#startText", "An idea to finish after the demo");
    await page.locator('[data-go="demo"]').click();
    assert.ok(await visible(page, "#demoBanner"));
    await switchView(page, "tech");
    await page.locator("#chatFab").click();
    await page.locator("#replayBtn").click({ trial: true }); // the chat drawer leaves the banner controls reachable
    await switchView(page, "simple");
    await page.click("#liveBtn");
    await page.waitForSelector("#startText");
    assert.equal(await page.inputValue("#startText"), "An idea to finish after the demo");
    assert.deepEqual(t.errors, []);
  });

  scenario("example prompts are editable and sending an idea preserves a separate chat draft", {}, {}, async (t) => {
    const { page } = t;
    let text;
    await page.route("**/api/chat", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      text = route.request().postDataJSON().text;
      return route.fulfill({ json: { ok: true } });
    });
    await page.fill("#chatText", "An unrelated draft");
    await page.click("#examples button >> nth=0");
    assert.equal(await page.inputValue("#startText"), "A simple to-do list I can use in my browser");
    assert.equal(await page.evaluate(() => document.activeElement.id), "startText");
    await page.keyboard.type(" with tags");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("startText").value === "");
    assert.equal(text, "A simple to-do list I can use in my browser with tags");
    assert.equal(await page.inputValue("#chatText"), "An unrelated draft");
  });

  scenario("a message that can't be sent stays in its box, with a plain reason and what to do", {}, {}, async (t) => {
    const { page } = t;
    let fail = "server";
    let sent;
    await page.route("**/api/chat", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (fail === "server") return route.fulfill({ status: 400, json: { error: "bad request" } });
      if (fail === "offline") return route.abort("connectionrefused");
      sent = route.request().postDataJSON().text;
      return route.fulfill({ json: { ok: true } });
    });
    // the chat box
    await page.fill("#chatText", "Hello Maya");
    await page.press("#chatText", "Enter");
    await page.waitForFunction(() => /Not sent/.test(document.getElementById("chatLog").innerText));
    assert.equal(await page.inputValue("#chatText"), "Hello Maya", "the message is back in the box");
    assert.match(await page.locator("#chatLog").innerText(), /the office couldn't take it\. Your message is still in the box/);
    // the idea box: the explanation sits right under it
    fail = "offline";
    await page.fill("#startText", "A recipe book");
    await page.click(".start-go");
    await page.waitForFunction(() => document.getElementById("startFeedback").textContent);
    assert.equal(await page.inputValue("#startText"), "A recipe book");
    assert.match(await page.locator("#startFeedback").innerText(), /isn't responding — check that it's still running/);
    // once it can be sent, it goes
    fail = null;
    await page.press("#chatText", "Enter");
    await page.waitForFunction(() => document.getElementById("chatText").value === "");
    assert.equal(sent, "Hello Maya");
    assert.deepEqual(t.errors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(e)), []);
  });

  // the page that opens a project: how-to steps for things that don't open in a browser, and a plain error
  const projectPage = async (t, name, files) => {
    const dir = path.join(t.s.projects, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), typeof c === "string" ? c : JSON.stringify(c));
    const id = (await import("node:crypto")).createHash("sha1").update(path.resolve(dir)).digest("hex").slice(0, 12);
    await t.page.goto(`${t.srv.base}/launch.html?id=${id}`);
  };
  scenario("launch page: a browser extension shows its steps", {}, {}, async (t) => {
    await projectPage(t, "my-extension", { "devstudio.json": { name: "Job Helper", kind: "extension", howTo: ["Open chrome://extensions", "Turn on Developer mode", "Click Load unpacked and pick this folder"] } });
    await t.page.waitForSelector("#steps:not([hidden])");
    assert.match(await t.page.locator("#title").innerText(), /JOB HELPER/);
    assert.equal(await t.page.locator("#steps li").count(), 3);
    assert.ok(await visible(t.page, "#filesBtn"));
    await t.shot("10-launch-extension");
  });
  scenario("launch page: an app that won't start says so in plain words", {}, {}, async (t) => {
    await projectPage(t, "crashy-app", { "devstudio.json": { name: "Crashy", kind: "web", start: `"${process.execPath}" -e "console.error('Cannot find module express'); process.exit(1)"`, howTo: ["Click Open"] } });
    await t.page.waitForSelector("text=COULDN'T OPEN CRASHY", { timeout: 15000 });
    assert.match(await t.page.locator("#status").innerText(), /closed before it was ready/);
    assert.match(await t.page.locator("#status").innerText(), /ask the manager/);
    assert.match(await t.page.locator("#detailsLog").textContent(), /Cannot find module express/);
    assert.ok(await visible(t.page, "#againBtn"));
    await t.shot("11-launch-failed");
  });

  scenario("the pairing QR code encodes the link", {}, {}, async (t) => {
    const svg = await t.page.evaluate(async () => (await import("/phone.js")).qrSvg("https://t.me/my_bot?start=123456"));
    assert.match(svg, /^<svg viewBox="0 0 (\d+) \1"/);
    assert.ok(svg.length > 1000);
  });
});
