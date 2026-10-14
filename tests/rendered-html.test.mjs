import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(process.pid) + "-" + Date.now());
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://pulse.example/", {
      headers: {
        accept: "text/html",
        "x-forwarded-host": "pulse.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the particle heart experience and request-aware metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>星核脉冲爱心<\/title>/);
  assert.match(html, /由粒子构成、会呼吸和自愈的交互式三维爱心。/);
  assert.match(html, /https:\/\/pulse\.example\/og-card\.png/);
  assert.match(html, /summary_large_image/);
  assert.match(html, /COSMIC PULSE/);
  assert.match(html, /粒子爱心/);
  assert.match(html, /感受心跳/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("keeps the production experience free of disposable starter artifacts", async () => {
  const [page, layout, experience, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/experience/CosmicHeartExperience.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<CosmicHeartExperience \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /x-forwarded-host/);
  assert.match(layout, /og-card\.png/);
  assert.match(experience, /<canvas/);
  assert.match(experience, /aria-hidden="true"/);
  assert.match(experience, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og-card.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", projectRoot)));
});
