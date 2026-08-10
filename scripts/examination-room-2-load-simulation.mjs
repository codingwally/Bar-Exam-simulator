import { fileURLToPath } from 'node:url';

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function randomGenerator(seedInput) {
  let state = (Number(seedInput) || 20260809) >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function simulateExaminationRoomLoad(options = {}) {
  const candidates = integer(options.candidates, 100, 1, 2_000);
  const questions = integer(options.questions, 20, 1, 200);
  const editsPerQuestion = integer(options.editsPerQuestion, 3, 1, 20);
  const durationMinutes = integer(options.durationMinutes, 120, 5, 480);
  const reconnectAtSeconds = integer(options.reconnectAtSeconds, 300, 5, durationMinutes * 60);
  const random = randomGenerator(options.seed);
  const events = [];

  function add(candidate, type, atSeconds, operationId) {
    events.push({ candidate, type, atSeconds: Math.max(0, Math.round(atSeconds * 1000) / 1000), operationId });
  }

  for (let candidate = 1; candidate <= candidates; candidate += 1) {
    const candidateId = `candidate-${String(candidate).padStart(4, '0')}`;
    const start = random() * 90;
    add(candidateId, 'session.open', start, `${candidateId}-session`);
    let sequence = 0;
    for (let question = 1; question <= questions; question += 1) {
      const questionBase = start + ((durationMinutes * 60 * 0.82) * ((question - 1) / questions));
      for (let edit = 1; edit <= editsPerQuestion; edit += 1) {
        sequence += 1;
        const at = questionBase + (random() * Math.max(1, (durationMinutes * 60 * 0.8) / questions));
        add(candidateId, 'answer.save', at, `${candidateId}-op-${sequence}`);
      }
    }
    // A school-network recovery burst: every candidate retries two already-idempotent operations.
    add(candidateId, 'answer.retry', reconnectAtSeconds + (random() * 15), `${candidateId}-retry-1`);
    add(candidateId, 'answer.retry', reconnectAtSeconds + (random() * 15), `${candidateId}-retry-2`);
    add(candidateId, 'heartbeat', reconnectAtSeconds + (random() * 20), `${candidateId}-heartbeat`);
    add(candidateId, 'submission', (durationMinutes * 60) - 20 + (random() * 40), `${candidateId}-submission-stable`);
  }

  events.sort((left, right) => left.atSeconds - right.atSeconds || left.operationId.localeCompare(right.operationId));
  const perSecond = new Map();
  const byType = new Map();
  const operationIds = new Set();
  for (const event of events) {
    const second = Math.floor(event.atSeconds);
    perSecond.set(second, (perSecond.get(second) || 0) + 1);
    byType.set(event.type, (byType.get(event.type) || 0) + 1);
    if (operationIds.has(event.operationId)) throw new Error(`Duplicate simulation operation ID: ${event.operationId}`);
    operationIds.add(event.operationId);
  }

  const busiest = [...perSecond.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]).slice(0, 10);
  return {
    mode: 'offline-simulation-only',
    warning: 'No network request was made. Run authenticated staging load tests separately; never point load traffic at production.',
    configuration: { candidates, questions, editsPerQuestion, durationMinutes, reconnectAtSeconds },
    totalEvents: events.length,
    uniqueOperationIds: operationIds.size,
    byType: Object.fromEntries([...byType.entries()].sort()),
    maximumEventsPerSecond: busiest[0]?.[1] || 0,
    busiestSeconds: busiest.map(([second, count]) => ({ second, count })),
  };
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const result = simulateExaminationRoomLoad({
    candidates: integer(process.env.EXAM_LOAD_CANDIDATES, 100, 1, 2_000),
    questions: integer(process.env.EXAM_LOAD_QUESTIONS, 20, 1, 200),
    editsPerQuestion: integer(process.env.EXAM_LOAD_EDITS, 3, 1, 20),
    durationMinutes: integer(process.env.EXAM_LOAD_DURATION_MINUTES, 120, 5, 480),
    reconnectAtSeconds: integer(process.env.EXAM_LOAD_RECONNECT_SECONDS, 300, 5, 28_800),
    seed: integer(process.env.EXAM_LOAD_SEED, 20260809, 1, 0x7fffffff),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
