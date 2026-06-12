// Deterministic duplicate detection for scheduler writes. Multiple sources (Gmail,
// Canvas, Notion, the planner, the secretary) can independently describe the same
// real-world commitment with different wording ("Piano Juries" vs "Non-Major Piano
// Juries Sign-up and Performance"). Before anything is written, callers check the
// proposed item against what already exists. This is intentionally conservative:
// a false positive only demotes an auto-approval to manual review, while a false
// negative creates a duplicate the user has to delete by hand.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "in", "on", "for", "to", "at", "w", "with", "your", "my",
])

const TIME_TOLERANCE_MS = 48 * 60 * 60 * 1000

export interface CommitmentRef {
  title: string
  // Best-known timestamp for the commitment (due date, scheduled time, or event
  // start). Null when the item has no time anchor.
  at: string | null
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1)
  }
  return token
}

export function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map(stemToken)
  return new Set(tokens)
}

export function titlesLookSimilar(left: string, right: string): boolean {
  const leftTokens = titleTokens(left)
  const rightTokens = titleTokens(right)

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false
  }

  const [smaller, larger] =
    leftTokens.size <= rightTokens.size ? [leftTokens, rightTokens] : [rightTokens, leftTokens]
  let shared = 0
  for (const token of smaller) {
    if (larger.has(token)) shared += 1
  }

  // Containment: one title is a subset of the other ("Piano Juries" within
  // "Non-Major Piano Juries Sign-up and Performance").
  if (shared === smaller.size) {
    return true
  }

  // Jaccard overlap: reworded variants of the same item share most tokens.
  const union = leftTokens.size + rightTokens.size - shared
  return union > 0 && shared / union >= 0.5
}

function exactTitleMatch(left: string, right: string): boolean {
  const leftTokens = [...titleTokens(left)].sort().join(" ")
  const rightTokens = [...titleTokens(right)].sort().join(" ")
  return leftTokens.length > 0 && leftTokens === rightTokens
}

function timesNearby(left: string, right: string, toleranceMs: number): boolean {
  const leftMs = new Date(left).getTime()
  const rightMs = new Date(right).getTime()
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return false
  }
  return Math.abs(leftMs - rightMs) <= toleranceMs
}

// A proposed commitment duplicates an existing one when the titles look similar AND
// the times are close. Without a time anchor on both sides, only an exact (token-set)
// title match counts — fuzzy title matching alone is too aggressive.
export function findDuplicateCommitment(
  item: CommitmentRef,
  existing: CommitmentRef[],
  toleranceMs = TIME_TOLERANCE_MS,
): CommitmentRef | null {
  for (const candidate of existing) {
    if (item.at && candidate.at) {
      if (timesNearby(item.at, candidate.at, toleranceMs) && titlesLookSimilar(item.title, candidate.title)) {
        return candidate
      }
      continue
    }

    if (exactTitleMatch(item.title, candidate.title)) {
      return candidate
    }
  }

  return null
}

export interface TimedBlock {
  title: string
  start: string
  end: string
}

// True when a proposed block overlaps an existing one in time and the titles look
// similar — used to stop the planner/secretary writing a block on top of a calendar
// event that already represents the same commitment.
export function overlapsSimilarBlock(block: TimedBlock, existing: TimedBlock[]): boolean {
  const blockStart = new Date(block.start).getTime()
  const blockEnd = new Date(block.end).getTime()
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) {
    return false
  }

  return existing.some((other) => {
    const otherStart = new Date(other.start).getTime()
    const otherEnd = new Date(other.end).getTime()
    return (
      Number.isFinite(otherStart) &&
      Number.isFinite(otherEnd) &&
      otherStart < blockEnd &&
      otherEnd > blockStart &&
      titlesLookSimilar(block.title, other.title)
    )
  })
}
