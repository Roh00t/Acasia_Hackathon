import type { Run } from "./types";

export const API_URL = "/api";

export type RunRequest = { row_id?: number | null; emergency: boolean; live: boolean; inject_unsafe: boolean };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function startRun(req: RunRequest): Promise<Run> {
  return json(await fetch(`${API_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function approveRun(runId: string, decision: "APPROVE" | "OVERRIDE", note = "") {
  return json<{ ok: boolean; chain_valid: boolean; entry: unknown }>(
    await fetch(`${API_URL}/runs/${runId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approver: "Station duty manager", decision, note }),
    }),
  );
}

export type ScenarioRow = {
  ROW_ID: number;
  AIRLINE: string;
  FLIGHT_NUMBER: number;
  ORIGIN_AIRPORT: string;
  DESTINATION_AIRPORT: string;
  ARRIVAL_DELAY: number;
  WEATHER_DELAY: number;
  LATE_AIRCRAFT_DELAY: number;
  MONTH: number;
  DAY: number;
};

export async function listScenarios(cause?: string, limit = 40): Promise<ScenarioRow[]> {
  return json(await fetch(`${API_URL}/scenarios?limit=${limit}${cause ? `&cause=${cause}` : ""}`));
}

export type Health = {
  ok: boolean;
  scenarios: number;
  model: string;
  live_available: boolean;
  storage: "postgres" | "memory";
};

/** Resolves to null when the API can't be reached (e.g. a static deployment). */
export async function getHealth(): Promise<Health | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}
