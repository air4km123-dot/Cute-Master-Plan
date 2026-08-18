"use client";

import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { edgeGeometry } from "./edgeGeometry";

/**
 * A drafted connection line.
 *
 * Visual grammar (§32) — nothing here carries hue, because colour is reserved
 * for department and status:
 *
 *   arrowhead direction  →  direction of flow
 *   inline label         →  what is transferred
 *   line style           →  review status: solid = confirmed architecture,
 *                           dashed = AI suggested, dotted = not reviewed
 */

export interface FlowEdgeData extends Record<string, unknown> {
  label: string;
  reviewState: "CONFIRMED" | "AI_SUGGESTED" | "NOT_REVIEWED";
  bidirectional: boolean;
  dimmed: boolean;
  emphasised: boolean;
}

const DASH: Record<FlowEdgeData["reviewState"], string | undefined> = {
  CONFIRMED: undefined,
  AI_SUGGESTED: "6 4",
  NOT_REVIEWED: "2 4",
};

export default function FlowEdge({ id, source, target, data, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const edge = (data ?? {}) as unknown as FlowEdgeData;
  const { sx, sy, tx, ty, sourcePos, targetPos } = edgeGeometry(sourceNode, targetNode);

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    borderRadius: 0, // crisp drafting corners
  });

  const emphasised = edge.emphasised || selected;
  const stroke = emphasised
    ? "var(--color-ink)"
    : edge.reviewState === "CONFIRMED"
      ? "var(--color-ink)"
      : "var(--color-ink-soft)";
  const width = emphasised ? 2.25 : edge.reviewState === "CONFIRMED" ? 1.5 : 1.25;

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={DASH[edge.reviewState]}
        markerEnd={`url(#air4-arrow${emphasised ? "-bold" : ""})`}
        markerStart={
          edge.bidirectional ? `url(#air4-arrow${emphasised ? "-bold" : ""})` : undefined
        }
        opacity={edge.dimmed ? 0.07 : 1}
        className="react-flow__edge-path"
      />
      {/* Wider invisible stroke so the line is easy to click. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="react-flow__edge-interaction"
      />

      {!edge.dimmed && edge.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className={`px-1.5 py-px bg-sheet-raised border ${
              emphasised ? "border-ink" : "border-rule"
            }`}
          >
            <span className="anno" style={emphasised ? { color: "var(--color-ink)" } : undefined}>
              {edge.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Arrowhead definitions, injected once into the flow's SVG. */
export function ArrowMarkers() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
      <defs>
        <marker
          id="air4-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink-soft)" />
        </marker>
        <marker
          id="air4-arrow-bold"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink)" />
        </marker>
      </defs>
    </svg>
  );
}
