"use client";

import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { useMemo } from "react";
import { edgeGeometry } from "./edgeGeometry";
import { placeLabel, type Rect } from "./labelPlacement";

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
 * Connections are a secondary layer. The card and its text are what the sheet is
 * for, so an edge is drawn thin and slightly held back, and it never covers a
 * card: edges carry a lower z-index than nodes, which means a line passing
 * behind a card is simply hidden by it. Separation from the grid comes from
 * contrast and an opaque label, not from a heavy white casing under the stroke —
 * with 50-odd connections on one sheet that reads as a second set of lines.
 */

export interface FlowEdgeData extends Record<string, unknown> {
  label: string;
  reviewState: "CONFIRMED" | "AI_SUGGESTED" | "NOT_REVIEWED";
  bidirectional: boolean;
  dimmed: boolean;
  emphasised: boolean;
  /** connection_types.color for this connection's type. */
  accent: string;
  /** Card rectangles the label must not land on. One shared array for all edges. */
  obstacles: Rect[];
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

  const [path, midX, midY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    borderRadius: 0, // crisp drafting corners
  });

  // React Flow's midpoint sits on a card for most routes on this sheet, so the
  // label is placed along the route instead. Memoised on the path, since this
  // re-runs on every pan and there are 50-odd edges.
  const placement = useMemo(
    () => placeLabel(path, edge.label ?? "", edge.obstacles ?? [], { x: midX, y: midY }),
    [path, edge.label, edge.obstacles, midX, midY]
  );
  const { x: labelX, y: labelY } = placement;

  const emphasised = edge.emphasised || selected;
  const accent = edge.accent || FALLBACK_ACCENT;

  const width = emphasised ? 1.9 : edge.reviewState === "CONFIRMED" ? 1.5 : 1.35;
  const marker = `url(#${arrowId(accent, emphasised)})`;
  // Held back from full strength so the cards stay the loudest thing on the
  // sheet; a selected connection comes up to full.
  const opacity = edge.dimmed ? 0.07 : emphasised ? 1 : 0.7;

  return (
    <>
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

      {/*
        A label is drawn at rest only where it has clear ground. On a sheet this
        tight most routes have none, and drawing them anyway is what buried the
        project names. Selecting a connection or a project brings its label back
        regardless — at that moment covering a card is exactly what was asked
        for, and only that one label is loud.
      */}
      {!edge.dimmed && edge.label && (placement.clear || emphasised) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              // Opaque, and that is the point: the label interrupts its own
              // line rather than sitting on top of it, so the text is never read
              // through a stroke. Border and text carry the connection's hue;
              // the fill stays near-white so a dense corner does not turn into
              // a wall of colour.
              background: `color-mix(in srgb, ${accent} 5%, #ffffff)`,
              borderColor: `color-mix(in srgb, ${accent} ${emphasised ? "80%" : "55%"}, #ffffff)`,
              color: `color-mix(in srgb, ${accent} 72%, #16202a)`,
              opacity: emphasised ? 1 : 0.94,
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
