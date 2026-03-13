export type FlowKind = 'extract' | 'derive' | 'generate';

export type FlowValue = {
  value: unknown;
  confidence?: number;
  sourceRef?: string;
};

export type FlowResults = Record<string, FlowValue>;

export type PromptFlow = {
  kind: FlowKind;
  instructions: string[];
  systemPrompt: string;
  userPrompt: string;
};

export type RunnerFlowState = {
  kind: FlowKind;
  status: 'pending' | 'running' | 'ok' | 'error' | 'skipped' | 'blocked';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  outputCount: number;
};

export type RunnerRunState = {
  runId: string;
  practiceId: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  mode: 'strict-openclaw';
  flows: Record<FlowKind, RunnerFlowState>;
};

export type OpenClawRunInput = {
  runId: string;
  practiceId: string;
  promptFlows: PromptFlow[];
  documents: Array<{ fileId: string; filename: string; text: string }>; // kept for audit payload only
  flowOverrides?: Partial<Record<FlowKind, FlowResults>>;
  retries?: number;
  perFlowTimeoutMs?: number;
  onFlowStart?: (kind: FlowKind) => Promise<void>;
  onFlowOk?: (kind: FlowKind, outputCount: number, durationMs: number) => Promise<void>;
  onFlowFail?: (kind: FlowKind, error: string, durationMs: number) => Promise<void>;
};

export type OpenClawRunOutput = {
  state: RunnerRunState;
  flowResults: Record<FlowKind, FlowResults>;
  mergedRow: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

function clampConfidence(v?: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.4;
  return Math.max(0, Math.min(1, v));
}

function buildEmptyFlowState(kind: FlowKind): RunnerFlowState {
  return { kind, status: 'pending', outputCount: 0 };
}

function normalizeFlowValues(input: FlowResults | undefined, sourceRefPrefix: string): FlowResults {
  const out: FlowResults = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    out[k] = {
      value: v?.value ?? null,
      confidence: clampConfidence(v?.confidence),
      sourceRef: v?.sourceRef ?? `${sourceRefPrefix}:${k}`
    };
  }
  return out;
}

async function runSingleFlow(flow: PromptFlow, override?: FlowResults): Promise<FlowResults> {
  if (!override) {
    throw new Error(`strict-openclaw runner requires explicit flow result for ${flow.kind}`);
  }
  return normalizeFlowValues(override, `openclaw-${flow.kind}`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs))
  ]);
}

export function mergeBuckets(values: Partial<Record<FlowKind, FlowResults>>) {
  const merged: Record<string, unknown> = {};
  const order: FlowKind[] = ['extract', 'derive', 'generate'];
  for (const kind of order) {
    const bucket = values[kind] ?? {};
    for (const [k, v] of Object.entries(bucket)) {
      merged[k] = v?.value ?? null;
    }
  }
  return merged;
}

export async function runOpenClawPipeline(input: OpenClawRunInput): Promise<OpenClawRunOutput> {
  const startedAt = nowIso();
  const state: RunnerRunState = {
    runId: input.runId,
    practiceId: input.practiceId,
    status: 'running',
    startedAt,
    mode: 'strict-openclaw',
    flows: {
      extract: buildEmptyFlowState('extract'),
      derive: buildEmptyFlowState('derive'),
      generate: buildEmptyFlowState('generate')
    }
  };

  const flowResults: Record<FlowKind, FlowResults> = { extract: {}, derive: {}, generate: {} };
  const retries = Math.max(0, Math.min(2, input.retries ?? 0));
  const timeoutMs = Math.max(1000, input.perFlowTimeoutMs ?? 20000);
  const flowsByKind = new Map(input.promptFlows.map((f) => [f.kind, f]));

  for (const kind of ['extract', 'derive', 'generate'] as FlowKind[]) {
    const flow = flowsByKind.get(kind);
    if (!flow) {
      state.flows[kind].status = 'skipped';
      continue;
    }

    const hasOverride = !!input.flowOverrides?.[kind];
    if (!hasOverride) {
      state.flows[kind] = {
        kind,
        status: 'blocked',
        startedAt: nowIso(),
        finishedAt: nowIso(),
        durationMs: 0,
        outputCount: 0,
        error: `Missing explicit OpenClaw output for flow ${kind}`
      };
      state.status = 'blocked';
      state.finishedAt = nowIso();
      state.durationMs = new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime();
      return { state, flowResults, mergedRow: mergeBuckets(flowResults) };
    }

    const started = Date.now();
    state.flows[kind].status = 'running';
    state.flows[kind].startedAt = nowIso();
    await input.onFlowStart?.(kind);

    let lastError = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await withTimeout(runSingleFlow(flow, input.flowOverrides?.[kind]), timeoutMs, `flow:${kind}`);
        flowResults[kind] = res;
        const durationMs = Date.now() - started;
        state.flows[kind] = {
          kind,
          status: 'ok',
          startedAt: state.flows[kind].startedAt,
          finishedAt: nowIso(),
          durationMs,
          outputCount: Object.keys(res).length
        };
        await input.onFlowOk?.(kind, Object.keys(res).length, durationMs);
        lastError = '';
        break;
      } catch (error) {
        lastError = (error as Error).message;
        if (attempt >= retries) {
          const durationMs = Date.now() - started;
          state.flows[kind] = {
            kind,
            status: 'error',
            startedAt: state.flows[kind].startedAt,
            finishedAt: nowIso(),
            durationMs,
            outputCount: 0,
            error: lastError
          };
          await input.onFlowFail?.(kind, lastError, durationMs);
        }
      }
    }

    if (state.flows[kind].status === 'error') {
      state.status = 'failed';
      state.finishedAt = nowIso();
      state.durationMs = new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime();
      return {
        state,
        flowResults,
        mergedRow: mergeBuckets(flowResults)
      };
    }
  }

  state.status = 'completed';
  state.finishedAt = nowIso();
  state.durationMs = new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime();

  return {
    state,
    flowResults,
    mergedRow: mergeBuckets(flowResults)
  };
}
