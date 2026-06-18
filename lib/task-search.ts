// Client-side relevance search for the task lookup. Pure + dependency-free so it
// runs on every keystroke with no lag, and is unit-testable in isolation.
//
// Matching is TOKEN-based, not whole-string. Every field is split into tokens on
// whitespace AND separators (_ - / . , & () :) so a course code like
// "2026SP_IEMS_225-0_SEC01_AND_ENTREP_225" becomes searchable tokens
// (…, "entrep", "225", …). Each query term is scored against the best matching
// token per field, strongest tier wins:
//   exact > prefix (either direction) > shared-prefix(≥4) > substring(term≥4) > fuzzy
// Field weight order is title > tags (the course lives here) > description. The
// fuzzy fallback is ANCHORED at a token start, which is what stops a 3-letter
// query like "mlm" from matching unrelated prose ("…confir[m]…wait[l]ist…4:22p[m]").

export type SearchableTask = {
  title: string
  tags: string[]
  description: string | null
}

const TOKEN_SPLIT = /[\s_\-/.,&():]+/

function tokenize(text: string): string[] {
  return text.toLowerCase().split(TOKEN_SPLIT).filter(Boolean)
}

// Are all of `needle`'s characters present in `haystack`, in order?
// e.g. "prsnt" -> "presentation". Kept exported: used for the anchored single-token
// fuzzy tier (and covered directly by tests).
export function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) {
    return false
  }
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) {
      i += 1
    }
  }
  return i === needle.length
}

function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) {
    i += 1
  }
  return i
}

type Tier = { exact: number; prefix: number; sharedPrefix: number; substring: number; fuzzy: number }

const TITLE_WEIGHTS: Tier = { exact: 120, prefix: 90, sharedPrefix: 55, substring: 45, fuzzy: 40 }
const TAG_WEIGHTS: Tier = { exact: 80, prefix: 60, sharedPrefix: 38, substring: 30, fuzzy: 26 }
const DESCRIPTION_WEIGHTS: Tier = { exact: 30, prefix: 22, sharedPrefix: 14, substring: 12, fuzzy: 0 }

// Exact / prefix / shared-prefix / substring tiers against a field's tokens.
function bestTokenScore(term: string, tokens: string[], weights: Tier): number {
  let best = 0
  for (const token of tokens) {
    if (token === term) {
      return weights.exact
    }
    // Prefix either direction (so "entrep" matches "entrep225" AND the full word
    // "entrepreneurship" shares enough), guarded to ≥3 chars to avoid stopword noise.
    if (
      Math.min(term.length, token.length) >= 3 &&
      (token.startsWith(term) || term.startsWith(token))
    ) {
      best = Math.max(best, weights.prefix)
    } else if (sharedPrefixLength(term, token) >= 4) {
      best = Math.max(best, weights.sharedPrefix)
    } else if (term.length >= 4 && token.includes(term)) {
      best = Math.max(best, weights.substring)
    }
  }
  return best
}

// Anchored single-token subsequence: term shares the first char of a token and is a
// subsequence of it ("mstr"->"mastering"). The anchor is the guard against the old
// "mlm matches any prose" bug.
function anchoredTokenFuzzy(term: string, tokens: string[]): boolean {
  return tokens.some((token) => token[0] === term[0] && isSubsequence(term, token))
}

// Compact / initialism across tokens, anchored at a token start ("wk6" -> "[w]ee[k] [6]").
// Skipped for digit-only terms so "220" never bleeds into "222"/"06".
function compactMatch(term: string, tokens: string[]): boolean {
  if (/^\d+$/.test(term)) {
    return false
  }
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start][0] !== term[0]) {
      continue
    }
    let consumed = 0
    for (let t = start; t < tokens.length && consumed < term.length; t += 1) {
      const token = tokens[t]
      for (let c = 0; c < token.length && consumed < term.length; c += 1) {
        if (token[c] === term[consumed]) {
          consumed += 1
        }
      }
    }
    if (consumed === term.length) {
      return true
    }
  }
  return false
}

function fieldScore(term: string, tokens: string[], weights: Tier): number {
  const direct = bestTokenScore(term, tokens, weights)
  if (direct > 0) {
    return direct
  }
  if (weights.fuzzy > 0 && term.length >= 3 && (anchoredTokenFuzzy(term, tokens) || compactMatch(term, tokens))) {
    return weights.fuzzy
  }
  return 0
}

export function scoreTaskMatch(task: SearchableTask, terms: string[], _fullQuery?: string): number {
  const titleTokens = tokenize(task.title)
  const tagTokens = tokenize(task.tags.join(" "))
  const descriptionTokens = tokenize(task.description ?? "")
  let score = 0
  let matched = 0

  for (const term of terms) {
    const best = Math.max(
      fieldScore(term, titleTokens, TITLE_WEIGHTS),
      fieldScore(term, tagTokens, TAG_WEIGHTS),
      fieldScore(term, descriptionTokens, DESCRIPTION_WEIGHTS),
    )
    if (best > 0) {
      score += best
      matched += 1
    }
  }

  if (matched === 0) {
    return 0
  }
  // Reward covering the whole query when there are multiple terms.
  if (terms.length > 1 && matched === terms.length) {
    score += 25
  }
  return score + matched * 15
}

// Rank `tasks` against `query`, best match first. Input order is preserved for
// equal scores (the caller pre-sorts by deadline, so ties stay deadline-ordered).
export function searchTasks<T extends SearchableTask>(tasks: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return []
  }
  const terms = normalized.split(TOKEN_SPLIT).filter(Boolean)
  if (terms.length === 0) {
    return []
  }
  return tasks
    .map((task, index) => ({ task, index, score: scoreTaskMatch(task, terms, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.task)
}
