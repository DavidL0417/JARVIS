"use client"

import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  Hash,
  ListChecks,
  ListFilter,
  Plus,
  Sparkles,
  Tag,
  Type,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  FILTER_PROPERTIES,
  RELATIVE_PRESETS,
  SORT_KEYS,
  type FilterPropertyKey,
  type FilterRule,
  type FilterState,
  type FilterValue,
  type SortKey,
  type SortRule,
  defaultRuleForProperty,
  defaultSortRule,
  operatorsFor,
  operatorMeta,
  propertyOf,
  ruleSummary,
  valueForOperator,
} from "@/lib/task-filter"

const PROPERTY_ICON: Record<FilterPropertyKey, LucideIcon> = {
  name: Type,
  course: Hash,
  category: Tag,
  status: ListChecks,
  source: Sparkles,
  priority: ListFilter,
  due: CalendarDays,
}

function MiniSelect({
  value,
  onChange,
  options,
  className = "",
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={`h-7 rounded-sm border border-rule bg-transparent px-1.5 text-[11.5px] text-foreground transition-colors focus:border-copper focus:outline-none ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const inputClass =
  "h-7 rounded-sm border border-rule bg-transparent px-2 text-[11.5px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-copper focus:outline-none"

function ValueEditor({
  rule,
  options,
  onChange,
}: {
  rule: FilterRule
  options: string[]
  onChange: (value: FilterValue) => void
}) {
  const type = propertyOf(rule.property).type
  const op = operatorMeta(type, rule.operator)
  if (!op?.needsValue) {
    return null
  }

  if (type === "text") {
    return (
      <input
        type="text"
        autoFocus
        value={rule.value.text ?? ""}
        onChange={(event) => onChange({ text: event.target.value })}
        placeholder="Value…"
        className={`${inputClass} w-full`}
      />
    )
  }

  if (type === "date") {
    if (rule.operator === "relative") {
      return (
        <MiniSelect
          ariaLabel="Relative window"
          value={rule.value.preset ?? "this_week"}
          onChange={(preset) => onChange({ preset: preset as FilterValue["preset"] })}
          options={RELATIVE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
          className="w-full"
        />
      )
    }
    if (rule.operator === "between") {
      return (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={rule.value.date ?? ""}
            onChange={(event) => onChange({ ...rule.value, date: event.target.value })}
            className={`${inputClass} num flex-1`}
          />
          <span className="text-[11px] text-muted-foreground">→</span>
          <input
            type="date"
            value={rule.value.dateEnd ?? ""}
            onChange={(event) => onChange({ ...rule.value, dateEnd: event.target.value })}
            className={`${inputClass} num flex-1`}
          />
        </div>
      )
    }
    return (
      <input
        type="date"
        value={rule.value.date ?? ""}
        onChange={(event) => onChange({ date: event.target.value })}
        className={`${inputClass} num w-full`}
      />
    )
  }

  // select → toggle chips of the available values
  const selected = rule.value.values ?? []
  const toggle = (option: string) =>
    onChange({ values: selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option] })

  return (
    <div className="flex flex-wrap gap-1">
      {options.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">No values yet.</span>
      ) : (
        options.map((option) => {
          const active = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={`max-w-[12rem] truncate rounded-[5px] border px-1.5 py-[2px] text-[11px] transition-colors ${
                active ? "border-copper/40 bg-copper-soft text-copper" : "border-rule text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          )
        })
      )}
    </div>
  )
}

function FilterPill({
  rule,
  options,
  onChange,
  onRemove,
}: {
  rule: FilterRule
  options: string[]
  onChange: (rule: FilterRule) => void
  onRemove: () => void
}) {
  const type = propertyOf(rule.property).type
  const Icon = PROPERTY_ICON[rule.property]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-md border border-copper/40 bg-copper-soft px-2 py-1 text-[11.5px] font-medium text-copper transition-colors hover:bg-copper-soft/80"
        >
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{ruleSummary(rule)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[12px] font-medium text-foreground">{propertyOf(rule.property).label}</span>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove filter"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <MiniSelect
            ariaLabel="Operator"
            value={rule.operator}
            onChange={(operator) =>
              onChange({ ...rule, operator, value: valueForOperator(type, operator, rule.value) })
            }
            options={operatorsFor(type).map((operator) => ({ value: operator.value, label: operator.label }))}
            className="w-full"
          />
          <ValueEditor rule={rule} options={options} onChange={(value) => onChange({ ...rule, value })} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AddFilter({ onAdd }: { onAdd: (key: FilterPropertyKey) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const matches = FILTER_PROPERTIES.filter((property) =>
    property.label.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-rule-strong px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" aria-hidden="true" /> Filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by…"
          className={`${inputClass} mb-1 h-8 w-full`}
        />
        <ul className="max-h-72 overflow-auto">
          {matches.map((property) => {
            const Icon = PROPERTY_ICON[property.key]
            return (
              <li key={property.key}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(property.key)
                    setOpen(false)
                    setSearch("")
                  }}
                  className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-muted/40"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {property.label}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function FilterControls({
  state,
  onChange,
  optionsFor,
}: {
  state: FilterState
  onChange: (next: FilterState) => void
  optionsFor: (key: FilterPropertyKey) => string[]
}) {
  const addRule = (key: FilterPropertyKey) =>
    onChange({ ...state, rules: [...state.rules, defaultRuleForProperty(key)] })
  const updateRule = (rule: FilterRule) =>
    onChange({ ...state, rules: state.rules.map((existing) => (existing.id === rule.id ? rule : existing)) })
  const removeRule = (id: string) =>
    onChange({ ...state, rules: state.rules.filter((rule) => rule.id !== id) })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.rules.length >= 2 ? (
        <MiniSelect
          ariaLabel="Combine filters with"
          value={state.conjunction}
          onChange={(conjunction) => onChange({ ...state, conjunction: conjunction as FilterState["conjunction"] })}
          options={[
            { value: "and", label: "All" },
            { value: "or", label: "Any" },
          ]}
        />
      ) : null}
      {state.rules.map((rule) => (
        <FilterPill
          key={rule.id}
          rule={rule}
          options={optionsFor(rule.property)}
          onChange={updateRule}
          onRemove={() => removeRule(rule.id)}
        />
      ))}
      <AddFilter onAdd={addRule} />
      {state.rules.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange({ ...state, rules: [] })}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      ) : null}
    </div>
  )
}

export function SortControls({ sorts, onChange }: { sorts: SortRule[]; onChange: (next: SortRule[]) => void }) {
  const usedKeys = new Set(sorts.map((sort) => sort.key))
  const firstUnused = SORT_KEYS.find((option) => !usedKeys.has(option.key))?.key ?? "due"

  const update = (id: string, patch: Partial<SortRule>) =>
    onChange(sorts.map((sort) => (sort.id === id ? { ...sort, ...patch } : sort)))
  const remove = (id: string) => onChange(sorts.filter((sort) => sort.id !== id))
  const move = (index: number, delta: number) => {
    const next = [...sorts]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
            sorts.length > 0
              ? "border-copper/40 bg-copper-soft text-copper"
              : "border-rule text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
          Sort
          {sorts.length > 0 ? <span className="num">· {sorts.length}</span> : null}
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        {sorts.length === 0 ? (
          <p className="px-1 pb-2 pt-1 text-[11.5px] text-muted-foreground">No sorts yet — add one below.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sorts.map((sort, index) => (
              <li key={sort.id} className="flex items-center gap-1">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="flex h-3.5 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === sorts.length - 1}
                    aria-label="Move down"
                    className="flex h-3.5 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <MiniSelect
                  ariaLabel="Sort property"
                  value={sort.key}
                  onChange={(key) => update(sort.id, { key: key as SortKey })}
                  options={SORT_KEYS.map((option) => ({ value: option.key, label: option.label }))}
                  className="flex-1"
                />
                <MiniSelect
                  ariaLabel="Sort direction"
                  value={sort.direction}
                  onChange={(direction) => update(sort.id, { direction: direction as SortRule["direction"] })}
                  options={[
                    { value: "asc", label: "Ascending" },
                    { value: "desc", label: "Descending" },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => remove(sort.id)}
                  aria-label="Remove sort"
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => onChange([...sorts, defaultSortRule(firstUnused)])}
          className="mt-2 flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Add sort
        </button>
      </PopoverContent>
    </Popover>
  )
}
