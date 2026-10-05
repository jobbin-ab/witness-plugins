/**
 * The page's names for the statuses, retired keys included: a copy of `STATUSES` and
 * `RETIRED_STATUSES` in witness's `src/vocabulary.ts`, which the plugin cannot import.
 * `test/plugin-labels.test.ts` in the witness repository holds the two together.
 * The status line alone uses it: a person reads that line; the agent reads keys.
 */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  triage: 'Triage',
  investigating: 'Investigating',
  decision: 'Awaiting decision',
  ready: 'Ready to build',
  blocked: 'Blocked',
  verify: 'Needs verification',
  done: 'Done',
  byDesign: 'By design',
  parked: 'Parked',
  cancelled: 'Cancelled',
  open: 'Open',
  fixed: 'Fixed',
  inbox: 'Inbox',
}

export function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key
}
