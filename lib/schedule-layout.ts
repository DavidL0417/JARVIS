// Apple Calendar-style overlap layout for timed events.
//
// The rule (from the user's reference screenshots): two overlapping events may be
// drawn on top of each other ONLY when neither title is obscured — i.e. the later
// event starts far enough below the earlier one's start that the earlier title row
// stays visible. Such events CASCADE: the later tile is indented slightly and drawn
// above. Events whose starts are too close must go SIDE BY SIDE in separate columns.
// Tiles must be opaque for cascading to read correctly (handled by the renderer).

export interface TimedLayoutEvent {
  id: string
  title: string
  day: number
  startHour: number
  duration: number
}

export interface TimedEventLayout {
  leftPct: number
  widthPct: number
  zIndex: number
}

// A cascaded tile must leave at least this much of the tile above it visible —
// roughly one title row (≈20px at 48px/hour ≈ 25 minutes).
export const MIN_CASCADE_GAP_MINUTES = 25
// Horizontal inset per cascade level, as a percentage of the full day column.
export const CASCADE_INDENT_PCT = 7
const MAX_CASCADE_INDENT_PCT = 24

export function getTimedEventBounds(event: { startHour: number; duration: number }) {
  const start = event.startHour * 60
  const end = start + Math.max(event.duration * 60, 1)

  return { start, end }
}

interface Placement {
  start: number
  end: number
  depth: number
}

function layoutCluster(cluster: TimedLayoutEvent[], layouts: Map<string, TimedEventLayout>) {
  const columns: Placement[][] = []
  const byId = new Map<string, { column: number; depth: number }>()

  for (const event of cluster) {
    const { start, end } = getTimedEventBounds(event)
    let placed = false

    // First choice: a column whose latest tile has already ended — the slot is
    // free again, full column width, no cascade.
    for (let column = 0; column < columns.length && !placed; column += 1) {
      const last = columns[column][columns[column].length - 1]
      if (start >= last.end) {
        columns[column].push({ start, end, depth: 0 })
        byId.set(event.id, { column, depth: 0 })
        placed = true
      }
    }

    // Second choice: cascade onto a column whose latest tile started long enough
    // ago that its title row stays visible above this tile.
    for (let column = 0; column < columns.length && !placed; column += 1) {
      const last = columns[column][columns[column].length - 1]
      if (start - last.start >= MIN_CASCADE_GAP_MINUTES) {
        const depth = last.depth + 1
        columns[column].push({ start, end, depth })
        byId.set(event.id, { column, depth })
        placed = true
      }
    }

    // Otherwise the starts are too close together — titles would collide — so the
    // event opens a new side-by-side column.
    if (!placed) {
      columns.push([{ start, end, depth: 0 }])
      byId.set(event.id, { column: columns.length - 1, depth: 0 })
    }
  }

  const columnCount = Math.max(columns.length, 1)
  const columnWidth = 100 / columnCount

  for (const event of cluster) {
    const placement = byId.get(event.id)
    if (!placement) continue
    const indent =
      Math.min(placement.depth * CASCADE_INDENT_PCT, MAX_CASCADE_INDENT_PCT) * (columnWidth / 100)

    layouts.set(event.id, {
      leftPct: placement.column * columnWidth + indent,
      widthPct: columnWidth - indent,
      zIndex: 10 + placement.depth,
    })
  }
}

export function buildTimedEventLayoutMap(events: TimedLayoutEvent[]): Map<string, TimedEventLayout> {
  const layouts = new Map<string, TimedEventLayout>()
  const eventsByDay = new Map<number, TimedLayoutEvent[]>()

  for (const event of events) {
    const current = eventsByDay.get(event.day) ?? []
    current.push(event)
    eventsByDay.set(event.day, current)
  }

  for (const dayEvents of eventsByDay.values()) {
    const sortedEvents = [...dayEvents].sort((left, right) => {
      const leftBounds = getTimedEventBounds(left)
      const rightBounds = getTimedEventBounds(right)
      return (
        leftBounds.start - rightBounds.start ||
        rightBounds.end - leftBounds.end ||
        left.title.localeCompare(right.title)
      )
    })

    // Group transitively-overlapping events into clusters; each cluster lays out
    // independently so unrelated parts of the day stay full width.
    const clusters: TimedLayoutEvent[][] = []
    let currentCluster: TimedLayoutEvent[] = []
    let currentClusterEnd = -Infinity

    for (const event of sortedEvents) {
      const { start, end } = getTimedEventBounds(event)

      if (currentCluster.length === 0 || start < currentClusterEnd) {
        currentCluster.push(event)
        currentClusterEnd = Math.max(currentClusterEnd, end)
      } else {
        clusters.push(currentCluster)
        currentCluster = [event]
        currentClusterEnd = end
      }
    }

    if (currentCluster.length > 0) {
      clusters.push(currentCluster)
    }

    for (const cluster of clusters) {
      layoutCluster(cluster, layouts)
    }
  }

  return layouts
}
