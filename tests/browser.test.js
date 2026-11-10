import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = process.platform === "win32"
  ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const browser = candidates.find(existsSync) || (() => {
  const command = process.platform === "win32" ? "where.exe" : "which";
  for (const name of ["chrome", "chromium", "chromium-browser", "google-chrome", "msedge"]) {
    const result = spawnSync(command, [name], { encoding: "utf8", windowsHide: true });
    const found = result.stdout?.trim().split(/\r?\n/)[0];
    if (result.status === 0 && found) return found;
  }
  return null;
})();

test("Chrome checks registration flow and responsive layout from 320px to desktop", {
  skip: !browser && "Chrome or Edge is not installed; browser smoke test skipped.",
  timeout: 60000,
}, async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), "codeshare-chrome-"));
  const vite = spawn(process.execPath, [path.join(projectRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5183", "--strictPort"], {
    cwd: projectRoot, stdio: "ignore", windowsHide: true,
  });
  const chrome = spawn(browser, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  async function stopProcess(child) {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }

  let socket;
  t.after(async () => {
    socket?.close();
    await stopProcess(chrome);
    await stopProcess(vite);
    rmSync(profile, { recursive: true, force: true });
  });

  async function waitFor(check, message) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${message}`);
  }

  await waitFor(async () => {
    try { return (await fetch("http://127.0.0.1:5183/")).ok; } catch { return false; }
  }, "Vite server");

  const portFile = path.join(profile, "DevToolsActivePort");
  await waitFor(() => existsSync(portFile), "Chrome DevTools port");
  const debugPort = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
  const newPage = await fetch(`http://127.0.0.1:${debugPort}/json/new?http://127.0.0.1:5183/`, { method: "PUT" });
  assert.equal(newPage.ok, true, "Chrome exposes a DevTools page target");
  const { webSocketDebuggerUrl } = await newPage.json();
  socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const packet = JSON.parse(event.data);
    if (!packet.id || !pending.has(packet.id)) return;
    const { resolve, reject } = pending.get(packet.id);
    pending.delete(packet.id);
    packet.error ? reject(new Error(packet.error.message)) : resolve(packet.result);
  });
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5183/" });
  await waitFor(() => evaluate("Boolean(document.querySelector('.auth-card'))"), "registration form");

  const title = await evaluate("document.querySelector('.auth-card h2').textContent");
  assert.equal(title, "Create your account", "new visitors see registration first");
  assert.equal(await evaluate("Boolean(document.querySelector('input[name=name]'))"), true);

  await evaluate("document.querySelector('.auth-switch button').click(); new Promise(r => setTimeout(r, 50))");
  assert.equal(await evaluate("document.querySelector('.auth-card h2').textContent"), "Welcome back");
  assert.equal(await evaluate("Boolean(document.querySelector('input[name=name]'))"), false, "existing accounts have a login form");
  await evaluate("document.querySelector('.auth-switch button').click(); new Promise(r => setTimeout(r, 50))");

  const measurements = [];
  for (const width of [320, 375, 768, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 650 });
    await delay(80);
    measurements.push(await evaluate(`(() => {
      const root = document.documentElement;
      const heading = document.querySelector('.auth-gate .intro h1');
      const card = document.querySelector('.auth-card');
      return {
        viewport: innerWidth,
        document: root.scrollWidth,
        heading: Math.ceil(heading.getBoundingClientRect().right),
        card: Math.ceil(card.getBoundingClientRect().right),
        mode: document.querySelector('.app-shell').className
      };
    })()`));
  }
  for (const item of measurements) {
    assert.ok(item.document <= item.viewport, `horizontal overflow at ${item.viewport}px: ${item.document}px`);
    assert.ok(item.heading <= item.viewport, `heading overflows at ${item.viewport}px`);
    assert.ok(item.card <= item.viewport, `registration card overflows at ${item.viewport}px`);
  }

  const dark = await evaluate("getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--bg').trim()");
  await evaluate("document.querySelector('.theme-button').click(); new Promise(r => setTimeout(r, 50))");
  const light = await evaluate("getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--bg').trim()");
  assert.notEqual(light, dark, "theme toggle changes the rendered color palette");
});
