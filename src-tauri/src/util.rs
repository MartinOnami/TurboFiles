//! Small shared helpers.

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Current UTC time as an RFC3339 string.
pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Replace characters that are invalid in a local filename with `replacement`,
/// so a server-supplied name can't produce an illegal or path-traversing local
/// file. `extra` adds user-configured characters on top of the always-illegal
/// set (path separators and control characters).
///
/// Returns the original string unchanged when nothing needs replacing.
pub fn sanitize_filename(name: &str, extra: &str, replacement: char) -> String {
    name.chars()
        .map(|c| {
            let illegal = c == '/' || c == '\\' || (c as u32) < 0x20 || extra.contains(c);
            if illegal {
                replacement
            } else {
                c
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn sanitize_replaces_separators_and_extra() {
        // Always-illegal: path separators and control characters.
        assert_eq!(sanitize_filename("a/b\\c", "", '_'), "a_b_c");
        // Configurable extras (e.g. Windows-reserved characters).
        assert_eq!(sanitize_filename("a:b?c", ":?", '_'), "a_b_c");
        // Clean names pass through untouched.
        assert_eq!(sanitize_filename("report.txt", ":?*", '_'), "report.txt");
    }
}
