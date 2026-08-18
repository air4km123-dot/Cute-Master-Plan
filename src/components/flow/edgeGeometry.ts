import { Position, type InternalNode, type Node } from "@xyflow/react";

/**
 * Floating edge geometry.
 *
 * Connections attach to whichever side of a card faces the other end, so an
 * arrow never crosses the card it belongs to. Without this, every edge would
 * leave from a fixed handle and the sheet would tangle immediately.
 */

function centre(node: InternalNode<Node>) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
  };
}

/** Where the line between two card centres crosses the first card's border. */
function intersection(node: InternalNode<Node>, other: InternalNode<Node>) {
  const w = (node.measured.width ?? 0) / 2;
  const h = (node.measured.height ?? 0) / 2;
  const c = centre(node);
  const o = centre(other);

  if (w === 0 || h === 0) return c;

  const dx = (o.x - c.x) / (2 * w) - (o.y - c.y) / (2 * h);
  const dy = (o.x - c.x) / (2 * w) + (o.y - c.y) / (2 * h);
  const scale = 1 / (Math.abs(dx) + Math.abs(dy) || 1);
  const sx = scale * dx;
  const sy = scale * dy;

  return {
    x: w * (sx + sy) + c.x,
    y: h * (-sx + sy) + c.y,
  };
}

function sideOf(node: InternalNode<Node>, point: { x: number; y: number }): Position {
  const x = Math.round(node.internals.positionAbsolute.x);
  const y = Math.round(node.internals.positionAbsolute.y);
  const px = Math.round(point.x);
  const py = Math.round(point.y);

  if (px <= x + 1) return Position.Left;
  if (px >= x + (node.measured.width ?? 0) - 1) return Position.Right;
  if (py <= y + 1) return Position.Top;
  return Position.Bottom;
}

export interface EdgeGeometry {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

export function edgeGeometry(
  source: InternalNode<Node>,
  target: InternalNode<Node>
): EdgeGeometry {
  const sourcePoint = intersection(source, target);
  const targetPoint = intersection(target, source);

  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: sideOf(source, sourcePoint),
    targetPos: sideOf(target, targetPoint),
  };
}
