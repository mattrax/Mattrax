//! Five-field POSIX cron matching, evaluated in the host's local timezone.
//!
//! Field syntax is the subset the server validates: `*`, a number, a range
//! (`a-b`), a step (`*/n` or `a-b/n`) and comma-separated lists. Names
//! (`MON`) are not supported and never match, matching the Swift agent and
//! `cronExpressionProblem` in `packages/enterprise-domain`.

use chrono::{DateTime, Datelike, Local, Timelike};

/// Does one cron field match `value`? Unknown syntax is false rather than an
/// error: a profile delivered with a malformed expression must not stop the
/// daemon or run every minute.
pub fn field_matches(field: &str, value: u32) -> bool {
    for part in field.split(',') {
        let mut pieces = part.splitn(2, '/');
        let range = pieces.next().unwrap_or("");
        let step = pieces
            .next()
            .and_then(|step| step.parse::<u32>().ok())
            .unwrap_or(1);

        if step == 0 {
            continue;
        }

        if range == "*" {
            if value % step == 0 {
                return true;
            }

            continue;
        }

        // compactMap in Swift dropped non-numeric bounds, so "1-x" meant "1" and
        // "x-1" meant "1". Keep the same lenient parse.
        let bounds: Vec<u32> = range
            .split('-')
            .filter_map(|bound| bound.parse().ok())
            .collect();

        if bounds.len() == 2 && value >= bounds[0] && value <= bounds[1] {
            if (value - bounds[0]) % step == 0 {
                return true;
            }

            continue;
        }

        if bounds.len() == 1 && value == bounds[0] {
            return true;
        }
    }

    false
}

/// Does a five-field expression match `now`? Weeks start on Sunday and the
/// weekday field is 0-6, as cron defines it (chrono numbers Monday as 0).
pub fn matches_local(expression: &str, now: DateTime<Local>) -> bool {
    let fields: Vec<&str> = expression.split_whitespace().collect();

    if fields.len() != 5 {
        return false;
    }

    let weekday = now.weekday().num_days_from_sunday();

    field_matches(fields[0], now.minute())
        && field_matches(fields[1], now.hour())
        && field_matches(fields[2], now.day())
        && field_matches(fields[3], now.month())
        && field_matches(fields[4], weekday)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .expect("unambiguous local time")
    }

    #[test]
    fn steps_ranges_lists_and_wildcards() {
        assert!(field_matches("*", 0));
        assert!(field_matches("*/15", 0));
        assert!(field_matches("*/15", 45));
        assert!(!field_matches("*/15", 46));
        assert!(field_matches("1-5", 3));
        assert!(!field_matches("1-5", 6));
        assert!(field_matches("1-10/2", 3));
        assert!(!field_matches("1-10/2", 4));
        assert!(field_matches("1,4,9", 4));
        assert!(!field_matches("1,4,9", 5));
        assert!(field_matches("7", 7));
        assert!(!field_matches("7", 8));
    }

    #[test]
    fn malformed_fields_never_match() {
        assert!(!field_matches("MON", 1));
        assert!(!field_matches("", 1));
        assert!(!field_matches("1-2-3", 1));
        assert!(!field_matches("*/0", 0));
    }

    #[test]
    fn requires_five_fields() {
        let now = at(2026, 11, 15, 3, 0);

        assert!(!matches_local("0 3 * *", now));
        assert!(!matches_local("0 3 * * * *", now));
        assert!(matches_local("0 3 * * *", now));
    }

    #[test]
    fn weekday_is_sunday_zero() {
        // 2026-11-15 is a Sunday.
        let sunday = at(2026, 11, 15, 3, 0);
        let monday = at(2026, 11, 16, 3, 0);

        assert!(matches_local("0 3 * * 0", sunday));
        assert!(!matches_local("0 3 * * 0", monday));
        assert!(matches_local("0 3 * * 1", monday));
        assert!(matches_local("0 3 * * 0,1", sunday));
    }

    #[test]
    fn matches_minute_hour_day_month() {
        let now = at(2026, 11, 20, 14, 30);

        assert!(matches_local("30 14 20 11 *", now));
        assert!(!matches_local("31 14 20 11 *", now));
        assert!(matches_local("*/15 14 20 11 *", now));
    }
}
