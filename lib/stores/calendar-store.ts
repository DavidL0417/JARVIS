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

// Updated Event Data Model for Google Calendar Integration
export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  start: string // ISO Date string
  end: string // ISO Date string
  source: "google" | "local"
  isReadOnly: boolean
  location?: string
  // Legacy fields for backwards compatibility
  time?: string
  day: number
  startHour: number
  duration: number
}

// Sync state type
export type SyncStatus = "idle" | "syncing" | "synced" | "error"

interface CalendarStore {
  // Calendars
  calendars: Calendar[]
  activeCalendarId: string | null
  calendarSidebarOpen: boolean
  
  // Tasks
  tasks: CalendarTask[]
  
  // Events
  events: CalendarEvent[]
  
  // Sync state
  syncStatus: SyncStatus
  lastSyncTime: Date | null
  
  // View state
  selectedDate: Date
  viewMode: "1day" | "3days" | "7days" | "1month"
  
  // Theme
  theme: "dark" | "light"
  
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
  
  // Sync Actions
  syncWithGoogle: () => Promise<void>
  setSyncStatus: (status: SyncStatus) => void
  
  // View Actions
  setSelectedDate: (date: Date) => void
  setViewMode: (mode: "1day" | "3days" | "7days" | "1month") => void
  navigatePrevious: () => void
  navigateNext: () => void
  goToToday: () => void
  
  // Theme Actions
  toggleTheme: () => void
  setTheme: (theme: "dark" | "light") => void
  
  // Event Actions
  addEvent: (event: Omit<CalendarEvent, "id">) => void
  updateEvent: (id: string, updates: Partial<Omit<CalendarEvent, "id">>) => void
  deleteEvent: (id: string) => void
  
  // Getters
  getVisibleCalendarIds: () => string[]
  getTasksByCalendar: (calendarId: string) => { active: CalendarTask[]; completed: CalendarTask[] }
  getVisibleEvents: () => CalendarEvent[]
  getEventsForDateRange: (startDate: Date, days: number) => CalendarEvent[]
}

// Helper to generate unique IDs
const generateId = () => Math.random().toString(36).substring(2, 11)

// Use a fixed mock week so SSR and client hydration render the same calendar positions.
const MOCK_WEEK_START_ISO = "2026-04-06T00:00:00.000Z"
const MOCK_CREATED_AT_ISO = "2026-04-11T12:00:00.000Z"

// Helper to get ISO date strings
const getISOString = (day: number, startHour: number, duration: number) => {
  const startOfWeek = new Date(MOCK_WEEK_START_ISO)
  
  const eventDate = new Date(startOfWeek)
  eventDate.setDate(eventDate.getDate() + day)
  
  const start = new Date(eventDate)
  start.setHours(startHour, 0, 0, 0)
  
  const end = new Date(start)
  end.setHours(start.getHours() + Math.floor(duration), (duration % 1) * 60, 0, 0)
  
  return { start: start.toISOString(), end: end.toISOString() }
}

// Default calendars
const defaultCalendars: Calendar[] = [
  { id: "cal-1", name: "Classes", color: "#3b82f6", visible: true, isDefault: true, source: "local" },
  { id: "cal-2", name: "Personal", color: "#22d3ee", visible: true, source: "local" },
  { id: "cal-3", name: "Work", color: "#f97316", visible: true, source: "local" },
  { id: "cal-4", name: "Project Vela", color: "#a855f7", visible: true, source: "local" },
  { id: "cal-google", name: "Google Calendar", color: "#3b82f6", visible: true, source: "google" },
]

// Default events with new data model
const defaultEvents: CalendarEvent[] = [
  // Monday (day 0) - Local events
  { id: "1", calendarId: "cal-1", title: "MATH 240-0", location: "Lunt 105", day: 0, startHour: 10, duration: 1, source: "local", isReadOnly: false, ...getISOString(0, 10, 1) },
  { id: "2", calendarId: "cal-1", title: "HISTORY 382", location: "Locy Hall 111", day: 0, startHour: 11, duration: 1, source: "local", isReadOnly: false, ...getISOString(0, 11, 1) },
  { id: "3", calendarId: "cal-1", title: "PHIL 101-8", location: "Crowe 3-178", time: "2:30 PM-3:00 PM", day: 0, startHour: 15, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(0, 15, 0.5) },
  { id: "4", calendarId: "cal-1", title: "PHIL 101-8 (seminar)", location: "Shepard Hall", day: 0, startHour: 16, duration: 1, source: "local", isReadOnly: false, ...getISOString(0, 16, 1) },
  { id: "5", calendarId: "cal-4", title: "Project Vela Meeting", day: 0, startHour: 16.5, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(0, 16.5, 0.5) },
  { id: "6", calendarId: "cal-2", title: "PAD Meeting", location: "University Hall", time: "6:00 PM-8:30 PM", day: 0, startHour: 18, duration: 2.5, source: "local", isReadOnly: false, ...getISOString(0, 18, 2.5) },

  // Tuesday (day 1) - Mix of local and Google events
  { id: "7", calendarId: "cal-1", title: "MATH 240-0", location: "Lunt Hall 103", day: 1, startHour: 10, duration: 1, source: "local", isReadOnly: false, ...getISOString(1, 10, 1) },
  { id: "8", calendarId: "cal-google", title: "Team Standup", location: "Google Meet", day: 1, startHour: 9, duration: 0.5, source: "google", isReadOnly: true, ...getISOString(1, 9, 0.5) },
  { id: "9", calendarId: "cal-1", title: "LEGAL_ST 221-0", location: "Harris Hall", time: "12:30 PM-1:30 PM", day: 1, startHour: 13, duration: 1, source: "local", isReadOnly: false, ...getISOString(1, 13, 1) },
  { id: "10", calendarId: "cal-1", title: "COMP_SCI 397-0", location: "RB135 - Tech", time: "2:35 PM-5:00 PM", day: 1, startHour: 14.5, duration: 2.5, source: "local", isReadOnly: false, ...getISOString(1, 14.5, 2.5) },
  { id: "11", calendarId: "cal-4", title: "Project Vela Sprint", day: 1, startHour: 16.5, duration: 1.5, source: "local", isReadOnly: false, ...getISOString(1, 16.5, 1.5) },

  // Wednesday (day 2)
  { id: "12", calendarId: "cal-1", title: "HISTORY 382", location: "Locy Hall 111", day: 2, startHour: 11, duration: 1, source: "local", isReadOnly: false, ...getISOString(2, 11, 1) },
  { id: "13", calendarId: "cal-google", title: "1:1 with Manager", location: "Zoom", day: 2, startHour: 14, duration: 0.5, source: "google", isReadOnly: true, ...getISOString(2, 14, 0.5) },
  { id: "14", calendarId: "cal-1", title: "PHIL 101-8", location: "Crowe 3-178", time: "2:30 PM-3:00 PM", day: 2, startHour: 15, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(2, 15, 0.5) },
  { id: "15", calendarId: "cal-1", title: "PHIL 101-8 (seminar)", location: "Shepard Hall", day: 2, startHour: 16, duration: 1, source: "local", isReadOnly: false, ...getISOString(2, 16, 1) },
  { id: "16", calendarId: "cal-4", title: "Project Vela Demo", day: 2, startHour: 16.5, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(2, 16.5, 0.5) },
  { id: "17", calendarId: "cal-2", title: "Feiyi Recital", location: "Galvin Recital", time: "6:00 PM-7:00 PM", day: 2, startHour: 18, duration: 1, source: "local", isReadOnly: false, ...getISOString(2, 18, 1) },

  // Thursday (day 3)
  { id: "18", calendarId: "cal-google", title: "All Hands Meeting", location: "Google Meet", day: 3, startHour: 10, duration: 1, source: "google", isReadOnly: true, ...getISOString(3, 10, 1) },
  { id: "19", calendarId: "cal-1", title: "LEGAL_ST 221-0", location: "Harris Hall", time: "12:30 PM-1:30 PM", day: 3, startHour: 13, duration: 1, source: "local", isReadOnly: false, ...getISOString(3, 13, 1) },
  { id: "20", calendarId: "cal-1", title: "LEGAL_ST 221", location: "Kresge Center", day: 3, startHour: 16, duration: 1, source: "local", isReadOnly: false, ...getISOString(3, 16, 1) },
  { id: "21", calendarId: "cal-4", title: "Project Vela Review", day: 3, startHour: 16.5, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(3, 16.5, 0.5) },
  { id: "22", calendarId: "cal-2", title: "Dinner w Evan", time: "6:00 PM-7:00 PM", day: 3, startHour: 18, duration: 1, source: "local", isReadOnly: false, ...getISOString(3, 18, 1) },

  // Friday (day 4)
  { id: "23", calendarId: "cal-1", title: "MATH 240-0", location: "Lunt 105", day: 4, startHour: 10, duration: 1, source: "local", isReadOnly: false, ...getISOString(4, 10, 1) },
  { id: "24", calendarId: "cal-1", title: "HISTORY 382", location: "Locy Hall 111", day: 4, startHour: 11, duration: 1, source: "local", isReadOnly: false, ...getISOString(4, 11, 1) },
  { id: "25", calendarId: "cal-3", title: "Innovation Lab", location: "Microsoft Tech", day: 4, startHour: 13, duration: 1, source: "local", isReadOnly: false, ...getISOString(4, 13, 1) },
  { id: "26", calendarId: "cal-1", title: "HISTORY 382 Lab", location: "Kresge Center", day: 4, startHour: 14, duration: 1, source: "local", isReadOnly: false, ...getISOString(4, 14, 1) },
  { id: "27", calendarId: "cal-4", title: "Project Vela Planning", day: 4, startHour: 16.5, duration: 0.5, source: "local", isReadOnly: false, ...getISOString(4, 16.5, 0.5) },
  { id: "28", calendarId: "cal-2", title: "Hotpot", time: "6:00 PM-9:00 PM", day: 4, startHour: 18, duration: 3, source: "local", isReadOnly: false, ...getISOString(4, 18, 3) },
  
  // Saturday & Sunday (day 5, 6) - Weekend events
  { id: "29", calendarId: "cal-google", title: "Weekend Sync", location: "Zoom", day: 5, startHour: 11, duration: 0.5, source: "google", isReadOnly: true, ...getISOString(5, 11, 0.5) },
  { id: "30", calendarId: "cal-2", title: "Brunch", location: "Cafe", day: 5, startHour: 12, duration: 2, source: "local", isReadOnly: false, ...getISOString(5, 12, 2) },
  { id: "31", calendarId: "cal-2", title: "Study Session", location: "Library", day: 6, startHour: 14, duration: 3, source: "local", isReadOnly: false, ...getISOString(6, 14, 3) },
]

// Default tasks
const defaultTasks: CalendarTask[] = [
  { id: "task-1", calendarId: "cal-1", title: "Review MATH 240 problem set", completed: false, createdAt: MOCK_CREATED_AT_ISO },
  { id: "task-2", calendarId: "cal-1", title: "Read Chapter 5 for HISTORY", completed: false, createdAt: MOCK_CREATED_AT_ISO },
  { id: "task-3", calendarId: "cal-4", title: "Update project documentation", completed: false, createdAt: MOCK_CREATED_AT_ISO },
  { id: "task-4", calendarId: "cal-4", title: "Design review meeting prep", completed: true, createdAt: MOCK_CREATED_AT_ISO, completedAt: MOCK_CREATED_AT_ISO },
  { id: "task-5", calendarId: "cal-2", title: "Book dinner reservation", completed: true, createdAt: MOCK_CREATED_AT_ISO, completedAt: MOCK_CREATED_AT_ISO },
]

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  // Initial state
  calendars: defaultCalendars,
  activeCalendarId: null,
  calendarSidebarOpen: false,
  tasks: defaultTasks,
  events: defaultEvents,
  syncStatus: "idle",
  lastSyncTime: null,
  selectedDate: new Date(MOCK_WEEK_START_ISO),
  viewMode: "7days",
  theme: "dark",

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

  // Sync Actions
  syncWithGoogle: async () => {
    set({ syncStatus: "syncing" })
    
    // API Placeholder: Replace this mock implementation with actual Google Calendar API call
    // Example:
    // const response = await fetch('/api/calendar/sync/google', { method: 'POST' })
    // const googleEvents = await response.json()
    
    await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate API call
    
    set({ 
      syncStatus: "synced",
      lastSyncTime: new Date()
    })
    
    // Reset status after a few seconds
    setTimeout(() => {
      set({ syncStatus: "idle" })
    }, 3000)
  },

  setSyncStatus: (status) => {
    set({ syncStatus: status })
  },

  // View Actions
  setSelectedDate: (date) => {
    set({ selectedDate: date })
  },

  setViewMode: (mode) => {
    set({ viewMode: mode })
  },

  navigatePrevious: () => {
    const { selectedDate, viewMode } = get()
    const newDate = new Date(selectedDate)
    
    switch (viewMode) {
      case "1day":
        newDate.setDate(newDate.getDate() - 1)
        break
      case "3days":
        newDate.setDate(newDate.getDate() - 3)
        break
      case "7days":
        newDate.setDate(newDate.getDate() - 7)
        break
      case "1month":
        newDate.setMonth(newDate.getMonth() - 1)
        break
    }
    
    set({ selectedDate: newDate })
  },

  navigateNext: () => {
    const { selectedDate, viewMode } = get()
    const newDate = new Date(selectedDate)
    
    switch (viewMode) {
      case "1day":
        newDate.setDate(newDate.getDate() + 1)
        break
      case "3days":
        newDate.setDate(newDate.getDate() + 3)
        break
      case "7days":
        newDate.setDate(newDate.getDate() + 7)
        break
      case "1month":
        newDate.setMonth(newDate.getMonth() + 1)
        break
    }
    
    set({ selectedDate: newDate })
  },

  goToToday: () => {
    set({ selectedDate: new Date() })
  },

  // Theme Actions
  toggleTheme: () => {
    const newTheme = get().theme === "dark" ? "light" : "dark"
    set({ theme: newTheme })
    
    // Update document class for Tailwind dark mode
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", newTheme === "dark")
    }
  },

  setTheme: (theme) => {
    set({ theme })
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark")
    }
  },

  // Event Actions
  addEvent: (event) => {
    const newEvent: CalendarEvent = {
      ...event,
      id: `event-${generateId()}`,
    }
    set((state) => ({
      events: [...state.events, newEvent],
    }))
  },

  updateEvent: (id, updates) => {
    set((state) => ({
      events: state.events.map((event) =>
        event.id === id ? { ...event, ...updates } : event
      ),
    }))
  },

  deleteEvent: (id) => {
    set((state) => ({
      events: state.events.filter((event) => event.id !== id),
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

  getEventsForDateRange: (startDate, days) => {
    const visibleIds = get().getVisibleCalendarIds()
    const events = get().events.filter((event) => visibleIds.includes(event.calendarId))
    
    // Filter events within the date range
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + days)
    
    return events.filter((event) => {
      const eventStart = new Date(event.start)
      return eventStart >= startDate && eventStart < endDate
    })
  },
}))

// Hook for calendar events - API placeholder for backend integration
// Replace the mock implementation inside with actual API calls
export function useCalendarEvents() {
  const { events, getVisibleEvents, syncStatus, lastSyncTime, syncWithGoogle } = useCalendarStore()
  
  return {
    events,
    visibleEvents: getVisibleEvents(),
    syncStatus,
    lastSyncTime,
    syncWithGoogle,
    // API Placeholder: Add refetch function here
    // refetch: () => fetch('/api/calendar/events').then(res => res.json())
  }
}
