"use strict";
// Compatibility manifest: "assume compatible, declare incompatible".
//
// A mod is compatible with every T3 version unless its mod.md lists the T3 major
// versions it is known not to work with:
//
//   incompatible-t3-majors: 2, 3        (also accepted: [2, 3] or a single 2)
//
// Pure and fail open: a malformed field or an unparsable T3 version means
// "compatible" (plus a warning). Nothing in here throws.

const FIELD = "incompatible-t3-majors";

/** Leading major of a version string ("2.1.0", "v3.0.0-nightly.1" -> 2, 3), or null. */
function majorOf(version) {
  const m = typeof version === "string" ? version.match(/^\s*v?(\d+)(?=$|[.\-+\s])/) : null;
  return m ? Number(m[1]) : null;
}

/** Parse the field's value into a list of majors. Returns null when it is malformed. */
function parseMajors(raw) {
  let items;
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === "number") items = [raw];
  else if (typeof raw === "string") items = raw.replace(/^\s*\[|\]\s*$/g, "").split(/[\s,]+/).filter(Boolean);
  else return null;
  const out = [];
  for (const it of items) {
    const n = typeof it === "string" && /^\d{1,6}$/.test(it) ? Number(it) : it;
    if (!Number.isInteger(n) || n < 0) return null;
    out.push(n);
  }
  return out;
}

/**
 * @param manifest   the mod's manifest fields (the parsed mod.md frontmatter)
 * @param t3Version  the running T3 version string, e.g. "2.4.1"
 * @param warn       optional (message) => void for fail-open warnings
 * @returns {{compatible: boolean, reason?: string}}
 */
function checkCompat(manifest, t3Version, warn = () => {}) {
  try {
    const raw = manifest?.[FIELD];
    if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return { compatible: true };
    const majors = parseMajors(raw);
    if (!majors) {
      warn(`${FIELD} is malformed (${JSON.stringify(raw)}); treating the mod as compatible`);
      return { compatible: true };
    }
    const major = majorOf(t3Version);
    if (major === null) {
      warn(`cannot read the T3 version (${JSON.stringify(t3Version)}); treating the mod as compatible`);
      return { compatible: true };
    }
    if (majors.includes(major)) return { compatible: false, reason: `Not compatible with T3 ${major}.x` };
    return { compatible: true };
  } catch (e) {
    try {
      warn(`compatibility check failed (${e?.message ?? e}); treating the mod as compatible`);
    } catch {}
    return { compatible: true };
  }
}

module.exports = { checkCompat, majorOf, parseMajors, FIELD };
