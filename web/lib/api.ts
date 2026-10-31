import type { Run } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010";

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

export async function listScenarios(cause?: string): Promise<ScenarioRow[]> {
  return json(await fetch(`${API_URL}/scenarios?limit=40${cause ? `&cause=${cause}` : ""}`));
}
