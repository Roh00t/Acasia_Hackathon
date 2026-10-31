// Mirrors the run JSON produced by backend/atm/coordinator.py.

export type AgentName = "ATC" | "PILOT" | "GROUND";
export type Subsystem = "ROUTINE" | "WEATHER" | "EMERGENCY";
export type Level = "L0" | "L1" | "L2" | "L3";

export const AGENTS: AgentName[] = ["ATC", "PILOT", "GROUND"];
export const SUBSYSTEMS: Subsystem[] = ["ROUTINE", "WEATHER", "EMERGENCY"];

export type Check = { ok: boolean; code: string; detail: string };

export type CandidateSummary = {
  id: string;
  kind: "LAND" | "DIVERT";
  t: number | null;
  gate: string | null;
  metrics: Record<string, number>;
  costs: Record<AgentName, number>;
  total_cost: number;
};

export type AgentMessage = {
  agent: AgentName;
  round: number;
  decision: "RANK" | "ACCEPT" | "REJECT";
  candidate_id: string | null;
  ranking: string[];
  reason_code: string;
  reason: string;
  counter: string | null;
  red_lines: string[];
  level: "L0" | "L1";
  meta?: { model?: string; attempts?: number; fallback_reason?: string | null; unverified_numbers?: string[] };
};

export type LogEntry = {
  seq: number;
  ts: string;
  kind: string;
  sender: string;
  round: number | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

export type Run = {
  run_id: string;
  mode: "live" | "offline";
  inject_unsafe: boolean;
  scenario: {
    scenario_id: string;
    row_id: number;
    subsystem: Subsystem;
    base_cause: Subsystem;
    row: Record<string, string | number | null>;
    airport: { code: string; name?: string; city?: string; state?: string };
    t0_clock: string;
    narrative: string;
    runway: {
      name: string;
      normal_cap_per_hr: number;
      arrival_cap_per_hr: number;
      closure: { start: number; end: number; cause: string } | null;
      taxiway_block: { taxiway: string; gates: string[]; until: number } | null;
      queue: { callsign: string; wake: string; t: number }[];
    };
    flight: {
      callsign: string;
      wake: string;
      fuel_endurance_min: number;
      reserve_min: number;
      alternate: string;
      alternate_min: number;
      connections: { flight: string; pax: number; departs: number }[];
    };
    ground: {
      planned_gate: string;
      crew_shift_end: number;
      turnaround_min: number;
      gates: { id: string; widebody: boolean; busy?: [number, number][] }[];
    };
    synthetic: string[];
  };
  candidates: {
    total: number;
    feasible: number;
    fail_counts: Record<string, number>;
    grid: { id: string; t: number | null; gate: string | null; kind: string; ok: boolean; fail: string | null }[];
    feasible_list: CandidateSummary[];
  };
  rounds: { round: number; proposal: CandidateSummary | null; messages: AgentMessage[] }[];
  vetoes: { agent: AgentName; candidate: string; round: number; failed: Record<string, Check> }[];
  stand_ins: number;
  unsafe_candidate: string | null;
  outcome: {
    level: Level;
    consensus: boolean;
    rounds_used: number;
    candidate: CandidateSummary | null;
    checks?: Record<AgentName, Check>;
    action: string;
    baseline_fcfs: CandidateSummary | null;
    baseline_uncoordinated: (CandidateSummary & { violations: Record<string, Check> }) | null;
  };
  log: LogEntry[];
  chain_valid: boolean;
  chain_alg?: "hmac-sha256" | "sha256";
  chain_head?: string;
  approval?: { approver: string; decision: string; note: string };
};

export type BatchSubsystem = {
  rows: number;
  consensus_pct: number;
  levels: Record<string, number>;
  mean_rounds: number;
  validator_vetoes: number;
  llm_stand_ins: number;
  unsafe_plans_accepted: number;
  uncoordinated_plans_broken_pct: number;
  uncoordinated_violations: Record<string, number>;
  divert_pct: Record<string, number>;
  negotiated: Record<string, number>;
  fcfs: Record<string, number>;
  fallback_only: Record<string, number>;
};

export type Batch = {
  n_per_subsystem: number;
  mode: string;
  model?: string | null;
  label: string;
  subsystems: Record<Subsystem, BatchSubsystem>;
};

export const AGENT_COLOR: Record<AgentName, string> = {
  ATC: "var(--color-atc)",
  PILOT: "var(--color-pilot)",
  GROUND: "var(--color-ground)",
};

export const LEVEL_TEXT: Record<Level, string> = {
  L0: "Consensus: LLM agents",
  L1: "Consensus: rule agents",
  L2: "Fallback: deterministic pick",
  L3: "Escalated to duty manager",
};

/** One chapter of the scroll story: web/public/story/s{1,2,3}.json from `atm.story export`. */
export type StoryChapter = {
  chapter: number;
  key: string;
  title: "Routine" | "Weather" | "Emergency";
  subsystem: Subsystem;
  row_id: number;
  model: string | null;
  real: Record<string, string | number | null>;
  derived: {
    weather_share: number | null;
    window_arrivals: number;
    window_weather_delayed: number;
    next_leg: { flight: string; dest: string; dep: string } | null;
  };
  synthetic: string[];
  cost: { input: number; output: number; cache_read: number; usd: number };
  latency_s: number;
  live: Run;
  offline: Run;
};
