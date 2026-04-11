"use client"

import { create } from "zustand"

// Calendar color presets (Apple iCal style)
export const CALENDAR_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Mint", value: "#4ade80" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Brown", value: "#a16207" },
] as const

export type CalendarColor = (typeof CALENDAR_COLORS)[number]["value"]

export interface Calendar {
  id: string
  name: string
  color: CalendarColor
  visible: boolean
  isDefault?: boolean
  source: "local" | "google" | "icloud" | "imported"
}

export interface CalendarTask {
  id: string
  calendarId: string
  title: string
  completed: boolean
  createdAt: string
  completedAt?: string
}

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  location?: string
  time?: string
  day: number
  startHour: number
  duration: number
}

interface CalendarStore {
  // Calendars
  calendars: Calendar[]
  activeCalendarId: string | null
  calendarSidebarOpen: boolean
  
  // Tasks
  tasks: CalendarTask[]
  
  // Events
  events: CalendarEvent[]
  
  // Calendar Actions
  addCalendar: (name: string, color: CalendarColor, source?: Calendar["source"]) => void
  updateCalendar: (id: string, updates: Partial<Omit<Calendar, "id">>) => void
  deleteCalendar: (id: string) => void
  toggleCalendarVisibility: (id: string) => void
  setActiveCalendar: (id: string | null) => void
  setCalendarSidebarOpen: (open: boolean) => void
  
  // Task Actions
  addTask: (calendarId: string, title: string) => void
  toggleTaskCompletion: (taskId: string) => void
  deleteTask: (taskId: string) => void
  
  // Getters
  getVisibleCalendarIds: () => string[]
  getTasksByCalendar: (calendarId: string) => { active: CalendarTask[]; completed: CalendarTask[] }
  getVisibleEvents: () => CalendarEvent[]
}

// Helper to generate unique IDs
const generateId = () => Math.random().toString(36).substring(2, 11)

// Default calendars
const defaultCalendars: Calendar[] = [
  { id: "cal-1", name: "Classes", color: "#3b82f6", visible: true, isDefault: true, source: "local" },
  { id: "cal-2", name: "Personal", color: "#22d3ee", visible: true, source: "local" },
  { id: "cal-3", name: "Work", color: "#f97316", visible: true, source: "local" },
  { id: "cal-4", name: "Project Vela", color: "#a855f7", visible: true, source: "local" },
]

// Default events (mapped from the existing mockEvents)
const defaultEvents: CalendarEvent[] = [
  // Monday (day 0)
  { id: "1", calendarId: "cal-1", title: "MATH 240-0", location: "Lunt 105", day: 0, startHour: 10, duration: 1 },
  { id: "2", calendarId: "cal-1", title: "HISTORY 38...", location: "Locy Hall 111", day: 0, startHour: 11, duration: 1 },
  { id: "3", calendarId: "cal-1", title: "PHIL 101-8 O...", location: "Crowe 3-178", time: "2:30 PM-3:...", day: 0, startHour: 15, duration: 0.5 },
  { id: "4", calendarId: "cal-1", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", day: 0, startHour: 16, duration: 1 },
  { id: "5", calendarId: "cal-4", title: "Project Vela...", day: 0, startHour: 16.5, duration: 0.5 },
  { id: "6", calendarId: "cal-2", title: "PAD Meeting", location: "University...", time: "6:00 PM-7:...", day: 0, startHour: 18, duration: 2.5 },

  // Tuesday (day 1)
  { id: "7", calendarId: "cal-1", title: "MATH 240-0...", location: "Lunt Hall 103", day: 1, startHour: 10, duration: 1 },
  { id: "8", calendarId: "cal-1", title: "LEGAL_ST 221-0", location: "Harris Hall...", time: "12:30 PM-1:...", day: 1, startHour: 13, duration: 1 },
  { id: "9", calendarId: "cal-1", title: "COMP_SCI 397-0 (semi...", location: "RB135 - Th...", time: "2:35 PM-5:...", day: 1, startHour: 14.5, duration: 2.5 },
  { id: "10", calendarId: "cal-4", title: "Project Vela...", day: 1, startHour: 16.5, duration: 1.5 },

  // Wednesday (day 2)
  { id: "11", calendarId: "cal-1", title: "HISTORY 38...", location: "Locy Hall 111", day: 2, startHour: 11, duration: 1 },
  { id: "12", calendarId: "cal-1", title: "PHIL 101-8 O...", location: "Crowe 3-178", time: "2:30 PM-3:...", day: 2, startHour: 15, duration: 0.5 },
  { id: "13", calendarId: "cal-1", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", day: 2, startHour: 16, duration: 1 },
  { id: "14", calendarId: "cal-4", title: "Project Vela...", day: 2, startHour: 16.5, duration: 0.5 },
  { id: "15", calendarId: "cal-2", title: "Feiyi Recital", location: "Galvin Reci...", time: "6:00 PM-7:...", day: 2, startHour: 18, duration: 1 },

  // Thursday (day 3)
  { id: "16", calendarId: "cal-1", title: "LEGAL_ST 221-0", location: "Harris Hall...", time: "12:30 PM-1:...", day: 3, startHour: 13, duration: 1 },
  { id: "17", calendarId: "cal-1", title: "LEGAL_ST 2...", location: "Kresge Cen...", day: 3, startHour: 16, duration: 1 },
  { id: "18", calendarId: "cal-4", title: "Project Vela...", day: 3, startHour: 16.5, duration: 0.5 },
  { id: "19", calendarId: "cal-2", title: "Dinner w Evan", time: "6:00 PM-7:...", day: 3, startHour: 18, duration: 1 },

  // Friday (day 4)
  { id: "20", calendarId: "cal-1", title: "MATH 240-0", location: "Lunt 105", day: 4, startHour: 10, duration: 1 },
  { id: "21", calendarId: "cal-1", title: "HISTORY 38...", location: "Locy Hall 111", day: 4, startHour: 11, duration: 1 },
  { id: "22", calendarId: "cal-3", title: "Innovation L...", location: "Microsoft T...", day: 4, startHour: 13, duration: 1 },
  { id: "23", calendarId: "cal-1", title: "HISTORY 38...", location: "Kresge Cen...", day: 4, startHour: 14, duration: 1 },
  { id: "24", calendarId: "cal-4", title: "Project Vela...", day: 4, startHour: 16.5, duration: 0.5 },
  { id: "25", calendarId: "cal-2", title: "Hotpot", time: "6:00 PM-9:...", day: 4, startHour: 18, duration: 3 },
]

// Default tasks
const defaultTasks: CalendarTask[] = [
  { id: "task-1", calendarId: "cal-1", title: "Review MATH 240 problem set", completed: false, createdAt: new Date().toISOString() },
  { id: "task-2", calendarId: "cal-1", title: "Read Chapter 5 for HISTORY", completed: false, createdAt: new Date().toISOString() },
  { id: "task-3", calendarId: "cal-4", title: "Update project documentation", completed: false, createdAt: new Date().toISOString() },
  { id: "task-4", calendarId: "cal-4", title: "Design review meeting prep", completed: true, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
  { id: "task-5", calendarId: "cal-2", title: "Book dinner reservation", completed: true, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
]

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  // Initial state
  calendars: defaultCalendars,
  activeCalendarId: null,
  calendarSidebarOpen: false,
  tasks: defaultTasks,
  events: defaultEvents,

  // Calendar Actions
  addCalendar: (name, color, source = "local") => {
    const newCalendar: Calendar = {
      id: `cal-${generateId()}`,
      name,
      color,
      visible: true,
      source,
    }
    set((state) => ({
      calendars: [...state.calendars, newCalendar],
    }))
  },

  updateCalendar: (id, updates) => {
    set((state) => ({
      calendars: state.calendars.map((cal) =>
        cal.id === id ? { ...cal, ...updates } : cal
      ),
    }))
  },

  deleteCalendar: (id) => {
    set((state) => ({
      calendars: state.calendars.filter((cal) => cal.id !== id),
      tasks: state.tasks.filter((task) => task.calendarId !== id),
      events: state.events.filter((event) => event.calendarId !== id),
      activeCalendarId: state.activeCalendarId === id ? null : state.activeCalendarId,
    }))
  },

  toggleCalendarVisibility: (id) => {
    set((state) => ({
      calendars: state.calendars.map((cal) =>
        cal.id === id ? { ...cal, visible: !cal.visible } : cal
      ),
    }))
  },

  setActiveCalendar: (id) => {
    set({ activeCalendarId: id })
  },

  setCalendarSidebarOpen: (open) => {
    set({ calendarSidebarOpen: open })
  },

  // Task Actions
  addTask: (calendarId, title) => {
    const newTask: CalendarTask = {
      id: `task-${generateId()}`,
      calendarId,
      title,
      completed: false,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      tasks: [...state.tasks, newTask],
    }))
  },

  toggleTaskCompletion: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              completed: !task.completed,
              completedAt: !task.completed ? new Date().toISOString() : undefined,
            }
          : task
      ),
    }))
  },

  deleteTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
    }))
  },

  // Getters
  getVisibleCalendarIds: () => {
    return get().calendars.filter((cal) => cal.visible).map((cal) => cal.id)
  },

  getTasksByCalendar: (calendarId) => {
    const tasks = get().tasks.filter((task) => task.calendarId === calendarId)
    return {
      active: tasks.filter((task) => !task.completed),
      completed: tasks.filter((task) => task.completed),
    }
  },

  getVisibleEvents: () => {
    const visibleIds = get().getVisibleCalendarIds()
    return get().events.filter((event) => visibleIds.includes(event.calendarId))
  },
}))
