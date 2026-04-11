# JARVIS (Just A Rather Very Intelligent Scheduler)
JARVIS: the first scheduler that automatically rebuilds your day when life happens.
An intelligent, behavior-aware scheduling assistant that adapts to real life by automatically updating your calendar when plans change.

---

## Overview

JARVIS is an AI-powered scheduler that:

- Learns how you actually work, including habits, energy levels, and tendencies
- Creates realistic schedules based on your constraints
- Continuously adapts when tasks are missed or disruptions occur
- Automatically updates your Google Calendar in real time

Unlike traditional planners, JARVIS focuses on **recovery and adaptation**, not just planning.

---

## Core Features

- **Behavior-Aware Scheduling**
  - Accounts for procrastination, energy dips, sleep habits, and personal work style

- **Automatic Google Calendar Sync**
  - Writes and updates events directly in Google Calendar

- **Reactive Replanning**
  - If you miss a task or life interferes, JARVIS reschedules intelligently

- **Check-in System**
  - Prompts users to confirm whether a task was completed
  - Supports responses like yes, no, or added context

- **Persistent Memory**
  - Learns long-term preferences
  - Adapts based on recent behavior and disruptions

---

## Tech Stack

### Frontend
- Next.js (App Router)
- React
- TypeScript
- v0 for rapid UI generation

### Backend
- Next.js Route Handlers

### Database
- Supabase (PostgreSQL + Auth)

### AI Layer
- Claude API for parsing, scheduling, and replanning

### Integrations
- Google Calendar API

### Hosting
- Vercel

---

## Project Structure

```text
app/
  api/
    schedule/        # Initial schedule generation
    replan/          # Reactive replanning
    checkin/         # Task completion updates
  dashboard/         # Main app UI
  onboarding/        # User setup flow

components/          # UI components, including v0-generated components

lib/
  supabase.ts        # Database client
  claude.ts          # Claude API wrapper
  calendar.ts        # Google Calendar integration

types/
  index.ts           # Shared application types

utils/
  validation.ts      # Schema validation helpers
  parsing.ts         # Input parsing and transformation helpers

sql/
  schema.sql         # Database schema

# 🧠 JARVIS — Adaptive Scheduling System

JARVIS is not just a planner. It’s a **self-correcting scheduling system** that learns how users actually behave and continuously adapts their calendar in real time.

---

## 🚀 Overview

JARVIS combines:

* Structured task planning
* Behavioral learning
* Reactive replanning

The result: schedules that **actually survive real life**.

---

## 🗄️ MVP Database Schema

### `users`

* `id`
* `email`

### `preferences`

* `id`
* `user_id`
* `sleep_pattern`
* `energy_profile`
* `procrastination_pattern`

### `tasks`

* `id`
* `user_id`
* `title`
* `deadline`
* `duration`
* `priority`
* `status`

### `schedule_events`

* `id`
* `task_id`
* `start_time`
* `end_time`
* `calendar_event_id`

### `checkins`

* `id`
* `task_id`
* `status`
* `context`

### `memory_logs`

* `id`
* `user_id`
* `insight`

---

## ⚙️ Workflow

### 1. Onboarding

**User inputs:**

* Tasks and deadlines
* Preferences (sleep, energy, work style)
* Constraints (classes, meetings, commitments)

**System actions:**

* Parses inputs with Claude
* Stores structured data in Supabase
* Generates an initial schedule

**User actions:**

* Reviews and approves schedule
* Schedule is pushed to Google Calendar

---

### 2. Initial Scheduling

Claude generates a structured schedule based on:

* Task priority
* Deadlines
* User preferences
* Time constraints

Then:

* Backend validates the output
* Approved schedule is written to Google Calendar

---

### 3. Check-in Loop

JARVIS periodically asks:

> “Did you complete this task?”

User responses:

* Yes
* No
* Context (e.g., “Too tired”, “Emergency”, “Took longer than expected”)

---

### 4. Reactive Replanning

When disruption is detected, JARVIS:

* Parses user feedback
* Updates short-term context and memory
* Reprioritizes remaining tasks
* Generates an updated schedule
* Writes changes directly to Google Calendar

---

### 5. Memory & Learning

JARVIS continuously learns:

* Long-term preferences
* Short-term behavioral signals
* Productivity patterns
* Missed-task trends

**Result:**

* More realistic schedules
* Better alignment with behavior
* Increased resilience to disruption

---

## 🛠️ Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start development server

```bash
pnpm dev
```

### 3. Configure environment variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

ANTHROPIC_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

---

## 🧠 Design Principles

### 1. LLM does NOT control execution

* Claude returns structured decisions
* Backend validates before writing to DB or Calendar

### 2. Realistic > Optimal

* Plans reflect real human behavior
* Not theoretical perfection

### 3. Recovery > Perfection

* The system is designed to adapt when plans break
* Resilience is the core value

---

## 🎬 Demo Flow

1. User inputs tasks, habits, deadlines, and constraints
2. JARVIS generates a schedule → pushes to Google Calendar
3. User misses a task and provides context
4. JARVIS replans automatically
5. Updated schedule appears in Google Calendar

---

## 🔮 Future Improvements

* Stronger behavioral modeling
* Multi-day optimization
* Push & mobile notifications
* Voice assistant interaction
* Integrations with more productivity tools

---

## ✨ Summary

JARVIS is an **adaptive scheduling engine** that:

* Learns from user behavior
* Adjusts in real time
* Keeps plans aligned with reality

> The goal isn’t a perfect schedule — it’s a schedule that *keeps working*.

---

## 🤝 Contributing

Eric Zhou, Cindy Jiang, David Liu

---

## 📄 License

MIT




# mydearestjarvis

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_RyyIa3L49yx2zoG0858My3tw9Zrl)

## Getting Started

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

<a href="https://v0.app/chat/api/kiro/clone/Cwjxdsaycheese/mydearestjarvis" alt="Open in Kiro"><img src="https://pdgvvgmkdvyeydso.public.blob.vercel-storage.com/open%20in%20kiro.svg?sanitize=true" /></a>
