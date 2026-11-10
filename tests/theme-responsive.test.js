import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [baseCss, responsiveCss] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/responsive.css", import.meta.url), "utf8"),
]);

function variables(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*(#[\da-fA-F]{3,8})/g)].map((match) => [match[1], match[2]]));
}

function blockFor(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
}

function luminance(hex) {
  const raw = hex.slice(1);
  const expanded = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw.slice(0, 6);
  const [r, g, b] = expanded.match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("light and dark theme text colors meet WCAG AA for normal text", () => {
  const root = variables(blockFor(baseCss, ":root"));
  const light = { ...root, ...variables(blockFor(baseCss, ".app-shell.light")), ...variables(blockFor(responsiveCss, ".app-shell.light")) };
  const dark = { ...root, ...variables(blockFor(responsiveCss, ".app-shell")) };
  const required = ["text", "muted", "dim"];

  for (const [themeName, palette, backgrounds] of [
    ["dark", dark, ["bg", "panel"]],
    ["light", light, ["bg", "panel"]],
  ]) {
    for (const foreground of required) {
      for (const background of backgrounds) {
        const ratio = contrast(palette[foreground], palette[background]);
        assert.ok(ratio >= 4.5, `${themeName} ${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast`);
      }
    }
  }

  for (const [themeName, palette, backgrounds] of [
    ["dark", dark, ["bg", "panel"]],
    ["light", light, ["bg", "panel"]],
  ]) {
    for (const foreground of ["accent", "blue", "danger"]) {
      if (!palette[foreground]) continue;
      for (const background of backgrounds) {
        const ratio = contrast(palette[foreground], palette[background]);
        assert.ok(ratio >= 3, `${themeName} ${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast`);
      }
    }
  }
});

test("responsive styles cover tablet, phone, and 320px narrow screens", () => {
  assert.match(baseCss, /min-width:\s*350px/, "legacy body width rule is overridden for narrow devices");
  assert.match(responsiveCss, /min-width:\s*320px/);
  assert.match(responsiveCss, /max-width:\s*900px/);
  assert.match(responsiveCss, /max-width:\s*650px/);
  assert.match(responsiveCss, /max-width:\s*380px/);
  assert.match(responsiveCss, /flex-wrap:\s*wrap/);
});
