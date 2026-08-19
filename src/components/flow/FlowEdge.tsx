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
 * Visual grammar:
 *
 *   hue                  →  connection type — the family of thing being moved.
 *                           Taken from connection_types.color in the database,
 *                           so the palette is configuration, not a constant
 *                           compiled in here. A line and its label always carry
 *                           the same hue, which is what makes a flow followable
 *                           across a sheet this dense.
 *   arrowhead direction  →  direction of flow
 *   inline label         →  what is transferred
 *   line style           →  review status: solid = confirmed architecture,
 *                           dashed = AI suggested, dotted = not reviewed
 *
 * Note this deliberately departs from the original rule that colour was
 * reserved for department and status alone (Addendum V2 §32). Type now carries
 * hue as well, at the customer's request. Department still owns the card accent
 * and status still owns the badge, so the three systems remain readable — but
 * this is the one place the sheet carries a third colour system, and anything
 * added later should not make it a fourth.
 *
 * Every line is drawn twice: a pale halo underneath and the coloured stroke on
 * top. The halo is what lifts a 1px line off the blueprint grid — without it,
 * thin dashed lines read as part of the background at anything below 100% zoom.
 * It is a plain wider stroke rather than an SVG filter because a real
 * drop-shadow on 50+ paths costs a repaint on every pan.
 */

export interface FlowEdgeData extends Record<string, unknown> {
  label: string;
  reviewState: "CONFIRMED" | "AI_SUGGESTED" | "NOT_REVIEWED";
  bidirectional: boolean;
  dimmed: boolean;
  emphasised: boolean;
  /** connection_types.color for this connection's type. */
  accent: string;
}

const DASH: Record<FlowEdgeData["reviewState"], string | undefined> = {
  CONFIRMED: undefined,
  // Longer dashes and a wider gap than before: the pattern has to survive being
  // zoomed out to fit the whole sheet, which is how this diagram is usually read.
  AI_SUGGESTED: "7 4",
  NOT_REVIEWED: "2 5",
};

const FALLBACK_ACCENT = "#5a6b78";

/** Marker ids are derived from the colour, so each hue gets its own arrowhead. */
export const arrowId = (color: string, bold = false) =>
  `air4-arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}${bold ? "-bold" : ""}`;

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
  const accent = edge.accent || FALLBACK_ACCENT;

  const width = emphasised ? 2.6 : edge.reviewState === "CONFIRMED" ? 1.9 : 1.6;
  const marker = `url(#${arrowId(accent, emphasised)})`;
  const opacity = edge.dimmed ? 0.07 : 1;

  return (
    <>
      {/* Halo — separates the line from the grid without an SVG filter. */}
      {!edge.dimmed && (
        <path
          d={path}
          fill="none"
          stroke="var(--color-connector-halo)"
          strokeWidth={width + 3.5}
          strokeLinecap="round"
          opacity={emphasised ? 0.95 : 0.8}
          pointerEvents="none"
        />
      )}

      <path
        id={id}
        d={path}
        fill="none"
        stroke={accent}
        strokeWidth={width}
        strokeDasharray={DASH[edge.reviewState]}
        markerEnd={marker}
        markerStart={edge.bidirectional ? marker : undefined}
        opacity={opacity}
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
              // Tinted from the line's own hue so the pair reads as one thing:
              // a pale fill, a stronger border, and text dark enough to hold
              // contrast at small sizes.
              background: `color-mix(in srgb, ${accent} 13%, #ffffff)`,
              borderColor: `color-mix(in srgb, ${accent} ${emphasised ? "85%" : "60%"}, #ffffff)`,
              color: `color-mix(in srgb, ${accent} 78%, #16202a)`,
            }}
            className="edge-label"
          >
            <span className="anno" style={{ color: "inherit" }}>
              {edge.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Arrowhead definitions, injected once into the flow's SVG.
 *
 * One pair per colour in use. An SVG marker cannot inherit the stroke colour of
 * the path that references it in every browser we care about — `context-stroke`
 * is the tidy answer but is not universally safe — so the markers are generated
 * from the palette instead, which is deterministic and needs no fallback.
 */
export function ArrowMarkers({ colors }: { colors: string[] }) {
  const palette = Array.from(new Set([...colors, FALLBACK_ACCENT]));

  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
      <defs>
        {palette.flatMap((color) =>
          [false, true].map((bold) => (
            <marker
              key={arrowId(color, bold)}
              id={arrowId(color, bold)}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth={bold ? 8 : 7}
              markerHeight={bold ? 8 : 7}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))
        )}
      </defs>
    </svg>
  );
}
