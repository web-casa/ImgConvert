// SPDX-License-Identifier: Apache-2.0

const forbiddenLicense =
  /\b(?:(?:A?GPL|LGPL)\s*v?(?:[- ]?(?:1|2(?:\.1)?|3)(?:\.0)?(?:-only|-or-later)?)?|GNU\s+(?:Affero\s+|Lesser\s+)?General\s+Public\s+License)\b/i;

/**
 * Returns true when every valid choice in an SPDX-style expression requires
 * a GPL/AGPL/LGPL term. OR means the distributor may select a permissive
 * branch; AND means every branch applies. Unparseable legacy labels retain the
 * conservative historical substring check.
 */
export function requiresForbiddenLicense(expression) {
  const tokens = String(expression).match(/\(|\)|\bAND\b|\bOR\b|\bWITH\b|[^\s()]+/gi) ?? [];
  let index = 0;

  function parsePrimary() {
    const token = tokens[index];
    if (!token) throw new Error("missing license term");
    if (token === "(") {
      index += 1;
      const allowed = parseOr();
      if (tokens[index] !== ")") throw new Error("missing closing parenthesis");
      index += 1;
      return allowed;
    }
    if ([")", "AND", "OR", "WITH"].includes(token.toUpperCase())) {
      throw new Error("unexpected SPDX operator");
    }
    index += 1;
    const allowed = !forbiddenLicense.test(token);
    if (tokens[index]?.toUpperCase() === "WITH") {
      index += 1;
      const exception = tokens[index];
      if (!exception || ["(", ")", "AND", "OR", "WITH"].includes(exception.toUpperCase())) {
        throw new Error("missing SPDX exception");
      }
      index += 1;
    }
    return allowed;
  }

  function parseAnd() {
    let allowed = parsePrimary();
    while (tokens[index]?.toUpperCase() === "AND") {
      index += 1;
      allowed = parsePrimary() && allowed;
    }
    return allowed;
  }

  function parseOr() {
    let allowed = parseAnd();
    while (tokens[index]?.toUpperCase() === "OR") {
      index += 1;
      allowed = parseAnd() || allowed;
    }
    return allowed;
  }

  try {
    if (tokens.length === 0) return forbiddenLicense.test(String(expression));
    const hasPermissiveChoice = parseOr();
    if (index !== tokens.length) throw new Error("trailing SPDX tokens");
    return !hasPermissiveChoice;
  } catch {
    return forbiddenLicense.test(String(expression));
  }
}
