"use client";

import type { NodeProps } from "@xyflow/react";
import type { Department } from "@/lib/types";

/**
 * A department zone: the drawn boundary a set of project cards sits inside.
 * Non-interactive — it is a region of the sheet, not a control.
 */

export interface ZoneNodeData extends Record<string, unknown> {
  dept: Department;
  width: number;
  height: number;
  count: number;
  shown: number;
}

export default function ZoneNode({ data }: NodeProps) {
  const { dept, width, height, count, shown } = data as unknown as ZoneNodeData;

  return (
    <div className="zone" style={{ width, height }}>
      <div
        className="flex items-stretch border-b border-rule-strong"
        style={{ height: 42 }}
      >
        <div style={{ width: 8, background: dept.color }} aria-hidden />
        <div className="px-3 flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="partno">{dept.dept_code}</span>
            <span className="anno-lg text-[11px] truncate">{dept.dept_name_en}</span>
          </div>
          <span className="anno truncate" style={{ letterSpacing: "0.02em" }}>
            {dept.dept_name_th}
          </span>
        </div>
        {typeof dept.sheet_progress === "number" && (
          <div
            className="px-3 flex flex-col justify-center border-l border-rule"
            title={
              `Average % Progress reported by the department (รวมลิงก์ชีต, column E)` +
              (dept.sheet_progress_label && dept.sheet_progress_label !== dept.dept_code
                ? ` — shared row "${dept.sheet_progress_label}"`
                : "")
            }
          >
            <span className="data font-bold leading-none">
              {Math.round(dept.sheet_progress)}%
            </span>
            {/* A combined row is labelled, so PM and B2C are not read as two
                independent figures that happen to match. */}
            <span className="anno leading-none mt-0.5" style={{ fontSize: 8 }}>
              {dept.sheet_progress_label && dept.sheet_progress_label !== dept.dept_code
                ? dept.sheet_progress_label
                : "avg"}
            </span>
          </div>
        )}
        <div className="px-3 flex items-center border-l border-rule">
          <span className="data" style={{ color: "var(--color-ink-soft)" }}>
            {shown === count ? count : `${shown}/${count}`}
          </span>
        </div>
      </div>
    </div>
  );
}
