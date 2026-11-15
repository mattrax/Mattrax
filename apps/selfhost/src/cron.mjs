/**
 * The Cloudflare deployment gets its cron triggers from the platform. A
 * container has no scheduler, so the host has to provide one. Expressions are
 * the same five-field syntax the Worker config declares.
 */
const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 6 },
];

const parseNumber = (value, field) => {
  if (!/^\d+$/.test(value)) throw new Error(`invalid ${field.name} value "${value}"`);

  const number = Number(value);

  if (number < field.min || number > field.max)
    throw new Error(`${field.name} value ${number} is outside ${field.min}-${field.max}`);

  return number;
};

const parseField = (source, field) => {
  const values = new Set();

  for (const item of source.split(",")) {
    const [range, stepSource] = item.split("/");
    const step = stepSource === undefined ? 1 : parseNumber(stepSource, field);

    if (step === 0) throw new Error(`${field.name} step must be greater than zero`);

    let start;
    let end;

    if (range === "*") {
      start = field.min;
      end = field.max;
    } else if (range.includes("-")) {
      const [from, to] = range.split("-");

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
export const parseCron = (expression) => {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) throw new Error(`cron "${expression}" must have five fields`);

  const sets = fields.map((source, index) => parseField(source, FIELDS[index]));
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;
  // Standard cron: when both day fields are restricted either may match.
  const dayRestricted = !fields[2].startsWith("*") && !fields[4].startsWith("*");

  return (date) => {
    if (!minutes.has(date.getMinutes())) return false;

    if (!hours.has(date.getHours())) return false;

    if (!months.has(date.getMonth() + 1)) return false;

    // JavaScript counts Sunday as 0, matching cron; some crons use 7 instead.
    const weekDay = date.getDay() % 7;
    const domMatches = daysOfMonth.has(date.getDate());
    const dowMatches = daysOfWeek.has(weekDay);

    return dayRestricted ? domMatches || dowMatches : domMatches && dowMatches;
  };
};

export const startCronScheduler = ({ expressions, trigger, log = console.log }) => {
  const schedules = [];

  for (const expression of expressions) {
    try {
      schedules.push({ expression, matches: parseCron(expression) });
    } catch (cause) {
      console.error(`mattrax self-host: ignoring cron "${expression}"`, cause.message);
    }
  }

  if (schedules.length === 0) return () => {};

  let lastMinute;
  let running = false;

  const tick = async () => {
    const now = new Date();
    const minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

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
