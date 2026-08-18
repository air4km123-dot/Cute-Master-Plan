/**
 * Build data/fixtures/sheet-current.tsv from the project's own source data.
 *
 * The fixture is a faithful snapshot of the สรุปโปรเจค tab in the same shape the
 * Sheets API returns, so the sync engine can be exercised offline (and by the
 * test suite) with no credentials and no network. It is generated, not
 * hand-maintained: regenerate it if data/source/projects.json changes.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = JSON.parse(
  fs.readFileSync(path.join(root, "data", "source", "projects.json"), "utf8")
);

const HEADER = [
  "ลำดับ",
  "แผนก",
  "ชื่อ Project",
  "Priority",
  "ผู้รับผิดชอบ",
  "Brief เบื้องต้นจากที่ประชุม",
  "สถานะ / Next Step",
  "หมายเหตุจากที่ประชุม",
];

// Two leading rows mirror the real sheet: a merged title banner and a blank
// spacer above the header, so the header-detection logic is genuinely tested.
const lines = [
  ["สรุปโปรเจกต์หลังประชุม 1 on 1 — รายการสำหรับพัฒนารายละเอียดต่อ", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  HEADER,
];

for (const p of source.projects) {
  lines.push([
    String(p.seq ?? ""),
    p.source_dept ?? p.dept_code ?? "",
    p.name ?? "",
    p.priority === null || p.priority === undefined ? "" : String(p.priority),
    p.owner_name ?? "",
    p.brief ?? "",
    p.status_original ?? "",
    p.notes ?? "",
  ]);
}

const clean = (cell) => String(cell).replace(/[\t\r\n]+/g, " ").trim();
const tsv = lines.map((row) => row.map(clean).join("\t")).join("\n") + "\n";

const outDir = path.join(root, "data", "fixtures");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "sheet-current.tsv");
fs.writeFileSync(outFile, tsv, "utf8");

console.log(`Wrote ${source.projects.length} project rows to ${path.relative(root, outFile)}`);
