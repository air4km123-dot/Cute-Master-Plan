import type { Department, Project } from "./types";

/**
 * Sheet layout.
 *
 * Departments are laid out as zones on a drawing sheet, packed left to right
 * and wrapped onto new rows. Cards sit inside their zone in columns. A card
 * with a saved layout_x/layout_y overrides its computed slot, so an admin can
 * rearrange the sheet without the automatic layout fighting back.
 */

export const CARD_W = 260;
export const CARD_H = 138;
export const CARD_GAP = 14;
export const ZONE_PAD = 16;
export const ZONE_HEADER = 42;
export const ZONE_GAP_X = 52;
export const ZONE_GAP_Y = 56;
export const SHEET_MAX_W = 2500;

export interface ZoneBox {
  id: string;
  dept: Department;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export interface CardBox {
  id: string;
  x: number;
  y: number;
}

export interface SheetLayout {
  zones: ZoneBox[];
  cards: Map<string, CardBox>;
  width: number;
  height: number;
}

function columnsFor(count: number): number {
  if (count > 12) return 3;
  if (count > 6) return 2;
  return 1;
}

export function computeLayout(departments: Department[], projects: Project[]): SheetLayout {
  const byDept = new Map<string, Project[]>();
  for (const project of projects) {
    const list = byDept.get(project.dept_code) ?? [];
    list.push(project);
    byDept.set(project.dept_code, list);
  }

  const zones: ZoneBox[] = [];
  const cards = new Map<string, CardBox>();

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let sheetWidth = 0;

  for (const dept of departments) {
    const members = byDept.get(dept.dept_code) ?? [];
    if (members.length === 0) continue;

    const cols = columnsFor(members.length);
    const rows = Math.ceil(members.length / cols);

    const width = ZONE_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP;
    const height = ZONE_HEADER + ZONE_PAD + rows * CARD_H + (rows - 1) * CARD_GAP + ZONE_PAD;

    if (cursorX > 0 && cursorX + width > SHEET_MAX_W) {
      cursorX = 0;
      cursorY += rowHeight + ZONE_GAP_Y;
      rowHeight = 0;
    }

    zones.push({
      id: `zone-${dept.dept_code}`,
      dept,
      x: cursorX,
      y: cursorY,
      width,
      height,
      count: members.length,
    });

    members.forEach((project, index) => {
      const col = Math.floor(index / rows);
      const row = index % rows;
      const computedX = cursorX + ZONE_PAD + col * (CARD_W + CARD_GAP);
      const computedY = cursorY + ZONE_HEADER + ZONE_PAD + row * (CARD_H + CARD_GAP);

      cards.set(project.project_id, {
        id: project.project_id,
        x: project.layout_x ?? computedX,
        y: project.layout_y ?? computedY,
      });
    });

    cursorX += width + ZONE_GAP_X;
    rowHeight = Math.max(rowHeight, height);
    sheetWidth = Math.max(sheetWidth, cursorX);
  }

  return {
    zones,
    cards,
    width: sheetWidth,
    height: cursorY + rowHeight,
  };
}

/**
 * Walk the connection graph outward from a project.
 * Used by the Upstream / Downstream / All dependencies controls (§19).
 */
export function relatedProjects(
  projectId: string,
  edges: { source: string; target: string; bidirectional: boolean }[],
  scope: "DIRECT" | "UPSTREAM" | "DOWNSTREAM" | "ALL"
): Set<string> {
  const found = new Set<string>([projectId]);
  if (scope === "DIRECT") {
    for (const edge of edges) {
      if (edge.source === projectId) found.add(edge.target);
      if (edge.target === projectId) found.add(edge.source);
    }
    return found;
  }

  const queue = [projectId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const followForward =
        edge.source === current && (scope === "DOWNSTREAM" || scope === "ALL");
      const followBackward =
        edge.target === current &&
        (scope === "UPSTREAM" || scope === "ALL" || edge.bidirectional);
      const alsoBidirectional = edge.bidirectional && edge.source === current;

      if (followForward || alsoBidirectional) {
        if (!found.has(edge.target)) {
          found.add(edge.target);
          queue.push(edge.target);
        }
      }
      if (followBackward) {
        if (!found.has(edge.source)) {
          found.add(edge.source);
          queue.push(edge.source);
        }
      }
    }
  }
  return found;
}
