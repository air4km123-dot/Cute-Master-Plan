import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SignJWT, importPKCS8 } from "jose";

/**
 * Google Sheets v4 read client.
 *
 * Credentials come from the environment only — nothing is hardcoded and nothing
 * is committed. Three sources are supported, tried in this order:
 *
 *   GAS_WEBAPP       AIR4_SHEET_WEBAPP_URL + AIR4_SHEET_WEBAPP_TOKEN.
 *                    An Apps Script Web App bound to the spreadsheet returns the
 *                    tab as JSON. It executes as the sheet's owner, so there is
 *                    no Google Cloud project, no service account and no private
 *                    key anywhere — the script already has the access, and Air4
 *                    only needs a shared token to call it.
 *   SERVICE_ACCOUNT  GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.
 *                    The normal production path: share the sheet with the
 *                    service account address as a Viewer.
 *   API_KEY          GOOGLE_SHEETS_API_KEY. Only works if the sheet is shared
 *                    as "anyone with the link can view".
 *   FIXTURE          AIR4_SHEET_FIXTURE=<path to .json or .tsv>. Reads a local
 *                    snapshot instead of the network. This exists so the sync
 *                    engine can be exercised end to end — including conflict
 *                    paths — without live credentials, and so a demo never
 *                    depends on the office network.
 *
 * The JWT assertion is signed with `jose`, which the project already depends on
 * for session tokens, so no new dependency is introduced.
 */

export const DEFAULT_SPREADSHEET_ID = "1zby_FYFWKHXDLP5Q6Z74XD3A7Onpxvs7zsuuV-5kc-0";
export const DEFAULT_TAB = "สรุปโปรเจค";
export const DEFAULT_GID = "1327666860";

/** Columns A–H: ลำดับ, แผนก, ชื่อ Project, Priority, ผู้รับผิดชอบ, Brief, สถานะ, หมายเหตุ */
const RANGE_COLUMNS = "A1:H2000";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type SheetSourceMode = "SERVICE_ACCOUNT" | "API_KEY" | "FIXTURE" | "GAS_WEBAPP";

export interface SheetConfig {
  spreadsheetId: string;
  tab: string;
  gid: string;
  mode: SheetSourceMode | null;
  /** Human-readable reason when mode is null. */
  problem: string | null;
}

export class SheetAccessError extends Error {
  status = 502;
  constructor(message: string) {
    super(message);
  }
}

export function sheetConfig(): SheetConfig {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || DEFAULT_TAB;
  const gid = process.env.GOOGLE_SHEET_GID?.trim() || DEFAULT_GID;

  let mode: SheetSourceMode | null = null;
  let problem: string | null = null;

  if (process.env.AIR4_SHEET_FIXTURE?.trim()) {
    mode = "FIXTURE";
  } else if (
    process.env.AIR4_SHEET_WEBAPP_URL?.trim() &&
    process.env.AIR4_SHEET_WEBAPP_TOKEN?.trim()
  ) {
    mode = "GAS_WEBAPP";
  } else if (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
    process.env.GOOGLE_PRIVATE_KEY?.trim()
  ) {
    mode = "SERVICE_ACCOUNT";
  } else if (process.env.GOOGLE_SHEETS_API_KEY?.trim()) {
    mode = "API_KEY";
  } else {
    problem =
      "No Google Sheets source configured. Either deploy the Apps Script web app " +
      "and set AIR4_SHEET_WEBAPP_URL + AIR4_SHEET_WEBAPP_TOKEN, or use a service " +
      "account with GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY. See .env.example.";
  }

  return { spreadsheetId, tab, gid, mode, problem };
}

/** Raw grid exactly as the sheet returns it: rows of trimmed cell strings. */
export interface SheetGrid {
  rows: string[][];
  /** Spreadsheet row number of rows[0]; the API range starts at row 1. */
  firstRowNumber: number;
  config: SheetConfig;
}

// ---------------------------------------------------------------------------
// Service account access token
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

function normalisePrivateKey(raw: string): string {
  // Env files carry the PEM with literal backslash-n; some shells keep real newlines.
  const key = raw.trim().replace(/\\n/g, "\n");
  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new SheetAccessError(
      "GOOGLE_PRIVATE_KEY does not look like a PKCS#8 PEM key. Copy the private_key " +
        'field from the service-account JSON, including the "-----BEGIN PRIVATE KEY-----" lines.'
    );
  }
  return key;
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!.trim();
  const key = await importPKCS8(normalisePrivateKey(process.env.GOOGLE_PRIVATE_KEY!), "RS256");

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok || !payload?.access_token) {
    throw new SheetAccessError(
      `Google rejected the service-account sign-in (${response.status}): ` +
        `${payload?.error_description ?? payload?.error ?? "no access token returned"}`
    );
  }

  cachedToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600),
  };
  return cachedToken.token;
}

// ---------------------------------------------------------------------------
// Fixture reader (offline / test)
// ---------------------------------------------------------------------------

function readFixture(): string[][] {
  const configured = process.env.AIR4_SHEET_FIXTURE!.trim();
  const file = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  if (!fs.existsSync(file)) {
    throw new SheetAccessError(`AIR4_SHEET_FIXTURE points at a file that does not exist: ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");

  if (file.endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : (parsed as { values?: unknown[] })?.values;
    if (!Array.isArray(rows)) {
      throw new SheetAccessError(
        "Sheet fixture JSON must be an array of rows, or an object with a `values` array."
      );
    }
    return rows.map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")]
    );
  }

  return text
    .split(/\r?\n/)
    .filter((line, index, arr) => line.length > 0 || index < arr.length - 1)
    .map((line) => line.split("\t"));
}

// ---------------------------------------------------------------------------
// Apps Script web app
// ---------------------------------------------------------------------------

/**
 * Read the tab through an Apps Script web app bound to the spreadsheet.
 *
 * The script runs as the sheet's owner and returns the same rectangular grid the
 * Sheets API would, so nothing downstream can tell the difference. Air4
 * authenticates with a shared token rather than a Google credential.
 *
 * Apps Script answers an unauthorised request with a 302 to a Google sign-in
 * page rather than a 401, so a redirect is treated as a configuration failure
 * and reported as one instead of being followed into an HTML login form.
 */
async function fetchFromWebApp(config: SheetConfig): Promise<string[][]> {
  const base = process.env.AIR4_SHEET_WEBAPP_URL!.trim();
  const token = process.env.AIR4_SHEET_WEBAPP_TOKEN!.trim();

  const url = new URL(base);
  url.searchParams.set("token", token);
  url.searchParams.set("tab", config.tab);

  const response = await fetch(url, { redirect: "follow", cache: "no-store" });

  if (!response.ok) {
    throw new SheetAccessError(
      `The Apps Script web app returned HTTP ${response.status}. Check that it is ` +
        'deployed with "Execute as: Me" and "Who has access: Anyone".'
    );
  }

  const text = await response.text();
  let payload: { ok?: boolean; error?: string; values?: unknown };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SheetAccessError(
      "The Apps Script web app did not return JSON. That usually means the request " +
        "was redirected to a Google sign-in page — redeploy it with access set to " +
        '"Anyone", and make sure AIR4_SHEET_WEBAPP_URL is the /exec URL.'
    );
  }

  if (payload.ok === false || payload.error) {
    throw new SheetAccessError(`Apps Script refused the request: ${payload.error}`);
  }
  if (!Array.isArray(payload.values)) {
    throw new SheetAccessError("Apps Script returned no `values` array.");
  }

  return (payload.values as unknown[][]).map((row) =>
    (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Read the configured tab. Returns the raw grid; interpreting it into projects
 * is googleSheetsSync's job, so this stays a thin transport layer.
 */
export async function fetchSheetGrid(): Promise<SheetGrid> {
  const config = sheetConfig();
  if (!config.mode) throw new SheetAccessError(config.problem!);

  if (config.mode === "FIXTURE") {
    return { rows: readFixture(), firstRowNumber: 1, config };
  }

  if (config.mode === "GAS_WEBAPP") {
    return { rows: await fetchFromWebApp(config), firstRowNumber: 1, config };
  }

  // A tab name containing spaces or Thai text must be single-quoted inside the
  // range, then percent-encoded as one path segment.
  const range = encodeURIComponent(`'${config.tab.replace(/'/g, "''")}'!${RANGE_COLUMNS}`);
  let url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;

  const headers: Record<string, string> = {};
  if (config.mode === "SERVICE_ACCOUNT") {
    headers.Authorization = `Bearer ${await accessToken()}`;
  } else {
    url += `&key=${encodeURIComponent(process.env.GOOGLE_SHEETS_API_KEY!.trim())}`;
  }

  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const message = detail?.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 403) {
      throw new SheetAccessError(
        `Google denied access to the spreadsheet: ${message}. ` +
          (config.mode === "SERVICE_ACCOUNT"
            ? `Share the sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as a Viewer.`
            : "An API key only works on a link-shared sheet; use a service account instead.")
      );
    }
    if (response.status === 400 && /Unable to parse range/i.test(message)) {
      throw new SheetAccessError(
        `The spreadsheet has no tab named "${config.tab}". Check GOOGLE_SHEET_TAB.`
      );
    }
    throw new SheetAccessError(`Could not read the spreadsheet: ${message}`);
  }

  const body = (await response.json()) as { values?: unknown[][] };
  const rows = (body.values ?? []).map((row) =>
    (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );

  return { rows, firstRowNumber: 1, config };
}
