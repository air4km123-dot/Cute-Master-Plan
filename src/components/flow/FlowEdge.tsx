"use client";

import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  useStore,
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
 *   label hue            →  connection type — the family of thing being moved.
 *                           Taken from connection_types.color in the database,
 *                           so the palette is configuration, not a constant
 *                           compiled in here. The line itself is dark neutral:
 *                           with 53 connections on one sheet, coloured strokes
 *                           turned the background into noise, so the hue was
 *                           moved to the label where it is read rather than
 *                           merely seen.
 *   arrowhead direction  →  direction of flow
 *   inline label         →  what is transferred
 *   line style           →  review status: solid = confirmed architecture,
 *                           dashed = AI suggested, dotted = not reviewed
 *
 * Note this departs from the original rule that colour was reserved for
 * department and status alone (Addendum V2 §32), at the customer's request —
 * but only the label carries it, so the sheet's lines stay achromatic as the
 * original grammar intended.
 *
 * Connections are a secondary layer by default: behind the cards, so a line
 * passing where a card sits is simply hidden by it rather than crossing a
 * project name. `front` lifts a connection above the cards — either because the
 * whole sheet has been switched to front, or because this one was clicked. Its
 * line and its label move together, so a connection is never half in front.
 *
 * Stroke width is compensated for zoom. SVG scales strokes with the viewport, so
 * a 1.35px line drawn at Fit Sheet (roughly 0.4×) reaches the eye as half a
 * pixel and disappears into the grid — which is exactly the "lines look faint
 * when zoomed out" complaint. Dividing by the zoom keeps the apparent width
 * constant instead, so the sheet reads the same whether you are looking at one
 * department or all twelve. It is clamped: below 0.35 the compensation stops, or
 * a fully zoomed-out sheet would turn back into a mess of fat lines, and above
 * 1× nothing is added, so zooming in never thickens anything.
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
  /** True when this connection should sit above the project cards. */
  front: boolean;
  /** Selects this connection when its label is clicked, matching a click on the line. */
  onSelect?: (connectionId: string) => void;
}

const DASH: Record<FlowEdgeData["reviewState"], string | undefined> = {
  CONFIRMED: undefined,
  // Longer dashes and a wider gap than before: the pattern has to survive being
  // zoomed out to fit the whole sheet, which is how this diagram is usually read.
  AI_SUGGESTED: "7 4",
  NOT_REVIEWED: "2 5",
};

const FALLBACK_ACCENT = "#5a6b78";

/** The line itself is achromatic; only the label carries the type's hue. */
const STROKE = "#16202a";
const STROKE_SOFT = "#3d4a55";

export default function FlowEdge({ id, source, target, data, selected }: EdgeProps) {
  // Subscribed rather than passed down: React Flow already re-renders edges on
  // viewport change, so this costs nothing extra.
  const zoom = useStore((state) => state.transform[2]);
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

  // Apparent width is what matters, so divide out the viewport scale.
  const scale = 1 / Math.min(1, Math.max(0.35, zoom));
  const base = emphasised ? 1.9 : edge.reviewState === "CONFIRMED" ? 1.5 : 1.35;
  const width = base * scale;
  // The dash pattern is in the same user units and shrinks just as fast, so a
  // dashed line closes up into a solid one when zoomed out — which would erase
  // the difference between AI-suggested and confirmed architecture. Scale it too.
  const dash = DASH[edge.reviewState]
    ?.split(" ")
    .map((n) => Number(n) * scale)
    .join(" ");
  const marker = `url(#air4-arrow${emphasised ? "-bold" : ""})`;
  // Held back from full strength so the cards stay the loudest thing on the
  // sheet; a selected connection comes up to full.
  const opacity = edge.dimmed ? 0.07 : emphasised ? 1 : 0.7;

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={emphasised ? STROKE : STROKE_SOFT}
        strokeWidth={width}
        strokeDasharray={dash}
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
        Every label is drawn. The layer sits *below* the cards, so one that found
        no clear ground simply tucks behind whatever it lands on instead of
        burying a project name — and the part that does peek out is dimmed, so it
        reads as background annotation rather than competing with the card.
        Labels that found clear space are drawn at full strength.
      */}
      {!edge.dimmed && edge.label && (
        <EdgeLabelRenderer>
          <div
            onClick={(event) => {
              event.stopPropagation();
              edge.onSelect?.(id);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // Clickable, so selecting a connection by its label works exactly
              // like clicking the line — which matters most for the crowded ones,
              // where the label is the only part with any clear ground.
              pointerEvents: "all",
              cursor: "pointer",
              // Moves with its line: both read `front`, so a connection is never
              // lifted in half.
              zIndex: edge.front || emphasised ? 40 : 2,
              // Opaque, and that is the point: the label interrupts its own
              // line rather than sitting on top of it, so the text is never read
              // through a stroke. Border and text carry the connection's hue;
              // the fill stays near-white so a dense corner does not turn into
              // a wall of colour.
              background: `color-mix(in srgb, ${accent} 5%, #ffffff)`,
              borderColor: `color-mix(in srgb, ${accent} ${emphasised ? "80%" : "55%"}, #ffffff)`,
              color: `color-mix(in srgb, ${accent} 72%, #16202a)`,
              opacity: emphasised ? 1 : placement.clear ? 0.94 : 0.72,
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
 * Two, not one per colour: the strokes are achromatic now, so an arrowhead only
 * has to match the weight of the line it caps.
 */
export function ArrowMarkers() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
      <defs>
        {[false, true].map((bold) => (
          <marker
            key={String(bold)}
            id={`air4-arrow${bold ? "-bold" : ""}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={bold ? 8 : 7}
            markerHeight={bold ? 8 : 7}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={bold ? STROKE : STROKE_SOFT} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
