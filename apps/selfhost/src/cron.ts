/**
 * The Cloudflare deployment gets its cron triggers from the platform. A
 * container has no scheduler, so the host has to provide one. Expressions are
 * the same five-field syntax the Worker config declares.
 */
interface CronField {
  name: string;
  min: number;
  max: number;
}

const FIELDS: readonly CronField[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 6 },
];

const parseNumber = (value: string, field: CronField): number => {
  if (!/^\d+$/.test(value)) throw new Error(`invalid ${field.name} value "${value}"`);

  const number = Number(value);

  if (number < field.min || number > field.max)
    throw new Error(`${field.name} value ${number} is outside ${field.min}-${field.max}`);

  return number;
};

const parseField = (source: string, field: CronField): Set<number> => {
  const values = new Set<number>();

  for (const item of source.split(",")) {
    // `split` yields a single element when the step is omitted.
    const [range, stepSource] = item.split("/") as [string, string | undefined];
    const step = stepSource === undefined ? 1 : parseNumber(stepSource, field);

    if (step === 0) throw new Error(`${field.name} step must be greater than zero`);

    let start: number;
    let end: number;

    if (range === "*") {
      start = field.min;
      end = field.max;
    } else if (range.includes("-")) {
      const [from, to] = range.split("-") as [string, string];

      start = parseNumber(from, field);
      end = parseNumber(to, field);
    } else {
      start = parseNumber(range, field);
      end = start;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values;
};

/** Returns a predicate over a local `Date`. */
export const parseCron = (expression: string): ((date: Date) => boolean) => {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) throw new Error(`cron "${expression}" must have five fields`);

  const sets = fields.map((source, index) => parseField(source, FIELDS[index]));
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;
  // Standard cron: when both day fields are restricted either may match.
  const dayRestricted = !fields[2].startsWith("*") && !fields[4].startsWith("*");

  return (date: Date) => {
    // Cloudflare evaluates cron expressions in UTC, so a container must too:
    // local-time accessors drift by the host offset and on DST changes.
    if (!minutes.has(date.getUTCMinutes())) return false;

    if (!hours.has(date.getUTCHours())) return false;

    if (!months.has(date.getUTCMonth() + 1)) return false;

    // JavaScript counts Sunday as 0, matching cron; some crons use 7 instead.
    const weekDay = date.getUTCDay() % 7;
    const domMatches = daysOfMonth.has(date.getUTCDate());
    const dowMatches = daysOfWeek.has(weekDay);

    return dayRestricted ? domMatches || dowMatches : domMatches && dowMatches;
  };
};

interface CronSchedule {
  expression: string;
  matches: (date: Date) => boolean;
}

export interface CronSchedulerOptions {
  expressions: readonly string[];
  trigger: (expression: string) => Promise<unknown> | unknown;
  log?: (message: string) => void;
}

export const startCronScheduler = ({
  expressions,
  trigger,
  log = console.log,
}: CronSchedulerOptions): (() => void) => {
  const schedules: CronSchedule[] = [];

  for (const expression of expressions) {
    try {
      schedules.push({ expression, matches: parseCron(expression) });
    } catch (cause) {
      console.error(
        `mattrax self-host: ignoring cron "${expression}"`,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  if (schedules.length === 0) return () => {};

  let lastMinute: string | undefined;
  let running = false;

  const tick = async (): Promise<void> => {
    const now = new Date();
    const minute = now.toISOString().slice(0, 16);

    if (minute === lastMinute || running) return;
    lastMinute = minute;
    running = true;

    try {
      for (const schedule of schedules) {
        if (!schedule.matches(now)) continue;

        log(`mattrax self-host: running cron ${schedule.expression}`);

        try {
          await trigger(schedule.expression);
        } catch (cause) {
          console.error(`mattrax self-host: cron ${schedule.expression} failed`, cause);
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), 15_000);

  timer.unref();

  return () => clearInterval(timer);
};
