/** Event schedules use the chosen IANA timezone, independently of the viewer's device. */
export function eventLocalInput(instant, timezone) {
  if (!instant) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function eventInstant(local, timezone) {
  if (!local) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Enter a complete event date and time.');
  const naive = Date.parse(local + ':00Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== local) throw new Error('Enter a valid event date and time.');
  const candidates = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = naive + hours * 3600000;
    const offset = Date.parse(eventLocalInput(probe, timezone) + ':00Z') - probe;
    const candidate = naive - offset;
    if (eventLocalInput(candidate, timezone) === local) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error(candidates.size ? 'This time repeats during a daylight-saving change. Choose an unambiguous event time.' : 'This local time does not exist during a daylight-saving change. Choose another time.');
  return new Date([...candidates][0]).toISOString();
}
