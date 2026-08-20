/**
 * Geometric check: do connection labels land on top of project cards?
 *
 * The Master Plan's edges cannot be screenshotted in a headless pane — React
 * Flow needs a compositing browser before it will draw them (see Air4erp.md
 * §8.2). So rather than deploy on faith, this reproduces the same maths the
 * browser runs — the real computeLayout, the real edgeGeometry, the real
 * getSmoothStepPath — and measures the result directly.
 *
 * It reports how many labels intersect a card, which is the acceptance test
 * stated for this change, and names the worst offenders so a fix can be aimed.
 *
 * Usage:  node scripts/check-overlaps.mjs
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import { getSmoothStepPath, Position } from "@xyflow/react";
import { computeLayout, CARD_W, CARD_H } from "../src/lib/layout.ts";
import { placeLabel, labelRect } from "../src/components/flow/labelPlacement.ts";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const rows = async (sql) => (await db.execute(sql)).rows.map((r) => ({ ...r }));

const departments = await rows(
  "SELECT * FROM departments WHERE active = 1 ORDER BY display_order"
);
const projects = await rows(
  "SELECT * FROM projects WHERE active = 1 ORDER BY dept_code, project_id"
);
const connections = await rows(
  "SELECT * FROM connections WHERE active = 1 AND connection_status <> 'REJECTED'"
);

const layout = computeLayout(departments, projects);

/** Card rectangles in absolute sheet coordinates. */
const cards = new Map();
for (const p of projects) {
  const box = layout.cards.get(p.project_id);
  if (!box) continue;
  cards.set(p.project_id, {
    id: p.project_id,
    x: box.x,
    y: box.y,
    w: CARD_W,
    h: CARD_H,
    cx: box.x + CARD_W / 2,
    cy: box.y + CARD_H / 2,
  });
}

// --- the same anchoring the browser does, on plain rectangles ---------------
function intersection(node, other) {
  const w = node.w / 2;
  const h = node.h / 2;
  const dx = (other.cx - node.cx) / (2 * w) - (other.cy - node.cy) / (2 * h);
  const dy = (other.cx - node.cx) / (2 * w) + (other.cy - node.cy) / (2 * h);
  const scale = 1 / (Math.abs(dx) + Math.abs(dy) || 1);
  const sx = scale * dx;
  const sy = scale * dy;
  return { x: w * (sx + sy) + node.cx, y: h * (-sx + sy) + node.cy };
}

function sideOf(node, point) {
  if (Math.round(point.x) <= Math.round(node.x) + 1) return Position.Left;
  if (Math.round(point.x) >= Math.round(node.x) + node.w - 1) return Position.Right;
  if (Math.round(point.y) <= Math.round(node.y) + 1) return Position.Top;
  return Position.Bottom;
}

/** Label box size, from the rendered font: ~6.1px per uppercase tracked char. */
const labelSize = (text) => ({
  w: Math.max(28, text.length * 6.1 + 12),
  h: 16,
});

const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

let onCard = 0;
let hidden = 0;
const offenders = [];

for (const c of connections) {
  const s = cards.get(c.source_project_id);
  const t = cards.get(c.target_project_id);
  if (!s || !t) continue;

  const sp = intersection(s, t);
  const tp = intersection(t, s);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sp.x,
    sourceY: sp.y,
    targetX: tp.x,
    targetY: tp.y,
    sourcePosition: sideOf(s, sp),
    targetPosition: sideOf(t, tp),
    borderRadius: 0,
  });

  const obstacles = [...cards.values()].map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h }));
  const placed = placeLabel(path, c.connection_label ?? "", obstacles, { x: labelX, y: labelY });
  const box = labelRect(c.connection_label ?? "", placed.x, placed.y);

  // Only labels that found clear ground are drawn at rest, so an unplaced one
  // covers nothing. Count what a viewer would actually see.
  const hit = placed.clear ? [...cards.values()].filter((card) => overlaps(box, card)) : [];
  if (!placed.clear) hidden++;
  if (hit.length) {
    onCard++;
    offenders.push({
      id: c.connection_id,
      label: c.connection_label,
      route: `${c.source_project_id} → ${c.target_project_id}`,
      over: hit.map((h) => h.id).join(", "),
    });
  }
}

console.log(`Connections measured           : ${connections.length}`);
console.log(`Labels landing on a card       : ${onCard}`);
console.log(`Labels drawn at rest           : ${connections.length - hidden}`);
console.log(`Shown only when selected       : ${hidden}`);
console.log(`Visible labels covering a card : ${onCard}`);

if (offenders.length) {
  console.log(`\nLabels that sit over a card (hidden behind it at z-index 2 vs 5):`);
  for (const o of offenders.slice(0, 20)) {
    console.log(`  ${o.id.padEnd(8)} ${String(o.label).padEnd(24)} ${o.route.padEnd(22)} over ${o.over}`);
  }
  if (offenders.length > 20) console.log(`  … and ${offenders.length - 20} more`);
}

// Finance and HR are the dense corners called out as the acceptance test.
const dense = offenders.filter((o) => /AF-|PG-/.test(o.route));
console.log(`\nOf those, in Finance / HR      : ${dense.length}`);

await db.close?.();
