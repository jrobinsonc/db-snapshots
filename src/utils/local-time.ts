const TIMESTAMP_PART_WIDTH = 2;

/** A time in local time, split so each caller picks its separators. */
export interface LocalTimeParts {
  /** For example `2026-10-31`. */
  date: string;
  /** Hours, minutes and seconds, each two digits. */
  time: [string, string, string];
}

/**
 * Splits a time into zero-padded local date and time parts.
 *
 * @param value - The time.
 * @returns For example `{ date: '2026-10-31', time: ['21', '30', '00'] }`.
 */
export function localTimeParts(value: Date): LocalTimeParts {
  const pad = (part: number): string =>
    String(part).padStart(TIMESTAMP_PART_WIDTH, '0');

  return {
    date: [
      value.getFullYear(),
      pad(value.getMonth() + 1),
      pad(value.getDate()),
    ].join('-'),
    time: [
      pad(value.getHours()),
      pad(value.getMinutes()),
      pad(value.getSeconds()),
    ],
  };
}
