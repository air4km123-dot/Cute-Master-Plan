/**
 * Where to put a connection's label.
 *
 * React Flow hands back the midpoint of the route, which on this sheet is
 * usually the worst possible place: measured across the real layout, 49 of the
 * 53 connections have their midpoint sitting on top of a project card. Drawing
 * there means the label either covers a project name or, once cards are given a
 * higher z-index, vanishes behind one.
 *
 * So the label is placed rather than assumed. The route is walked, candidate
 * points are sampled along it, and the first that clears every card wins —
 * preferring points near the middle, because a label hugging an arrowhead reads
 * as belonging to the card rather than to the line.
 *
 * Often there is no such point. Cards sit 14px apart inside a department zone
 * and a label is 16px tall, so a connection between two cards in the same column
 * has nowhere to put one: measured across the real sheet, 35 of 53 labels have
 * no clear ground anywhere along their route, at any sideways offset. That is a
 * property of the layout, not something placement can solve — the only way to
 * honour "a label never covers a card" for those is to not draw them at rest.
 * `clear` reports which case this is, and the caller shows the crowded ones only
 * when their connection is selected, where covering a card is the point.
 *
 * This moves nothing but the label. The route, its endpoints, its direction and
 * its text are all untouched.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Approximate rendered size of a label box.
 *
 * The type is uppercase and letter-spaced (`.anno`), so width tracks character
 * count closely enough for collision purposes — this only has to be good enough
 * to keep a box out of a card, not to lay out text.
 */
export function labelRect(text: string, cx: number, cy: number): Rect {
  const w = Math.max(28, text.length * 6.1 + 12);
  const h = 16;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Parse the orthogonal route into its corner points.
 *
 * With borderRadius 0 the smooth-step path is only M and L commands, so this is
 * a straight read rather than a general SVG path parser. Anything unexpected
 * yields an empty list and the caller falls back to React Flow's midpoint.
 */
function polyline(path: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const re = /[ML]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path))) {
    points.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return points;
}

const SAMPLE_STEP = 10; // px between candidate positions
const END_MARGIN = 26; // keep clear of the arrowhead and the card it points at

/**
 * Best label position along `path`, or the supplied fallback if the route is
 * covered end to end.
 */
export interface LabelPlacement {
  x: number;
  y: number;
  /** false = every position along the route is covered; nowhere clear to sit. */
  clear: boolean;
}

export function placeLabel(
  path: string,
  text: string,
  obstacles: Rect[],
  fallback: { x: number; y: number }
): LabelPlacement {
  const points = polyline(path);
  if (points.length < 2) return { ...fallback, clear: false };

  // Cumulative length, so candidates can be ranked by distance from the middle.
  const segments: { ax: number; ay: number; bx: number; by: number; len: number }[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len });
    total += len;
  }
  if (!segments.length || total <= END_MARGIN * 2) return { ...fallback, clear: false };

  const middle = total / 2;
  const candidates: { x: number; y: number; fromMiddle: number; along: number }[] = [];

  let walked = 0;
  for (const seg of segments) {
    for (let d = 0; d <= seg.len; d += SAMPLE_STEP) {
      const along = walked + d;
      if (along < END_MARGIN || along > total - END_MARGIN) continue;
      const t = d / seg.len;
      candidates.push({
        x: seg.ax + (seg.bx - seg.ax) * t,
        y: seg.ay + (seg.by - seg.ay) * t,
        fromMiddle: Math.abs(along - middle),
        along,
      });
    }
    walked += seg.len;
  }

  candidates.sort((a, b) => a.fromMiddle - b.fromMiddle);

  /**
   * Sideways room to try, in order.
   *
   * Cards sit 14px apart inside a zone and a label is 16px tall, so a route that
   * threads between two stacked cards has nowhere on the line itself to put one.
   * Stepping perpendicular finds the open ground just outside the column. The
   * cap is deliberate: past roughly 30px the label stops reading as belonging to
   * its line, which is worse than being hidden.
   */
  const OFFSETS = [0, 12, -12, 20, -20, 28, -28];

  for (const candidate of candidates) {
    // Perpendicular to the segment this candidate sits on.
    const seg = segmentAt(segments, candidate.along);
    const dx = seg.bx - seg.ax;
    const dy = seg.by - seg.ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    for (const offset of OFFSETS) {
      const x = candidate.x + nx * offset;
      const y = candidate.y + ny * offset;
      const box = labelRect(text, x, y);
      if (!obstacles.some((rect) => overlaps(box, rect))) return { x, y, clear: true };
    }
  }

  return { ...fallback, clear: false };
}

function segmentAt(
  segments: { ax: number; ay: number; bx: number; by: number; len: number }[],
  along: number
) {
  let walked = 0;
  for (const seg of segments) {
    if (along <= walked + seg.len) return seg;
    walked += seg.len;
  }
  return segments[segments.length - 1];
}
