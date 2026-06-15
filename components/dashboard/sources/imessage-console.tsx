"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"

import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import {
  DetailHeader,
  InfoLine,
  InlineError,
  type ConnectorDefinition,
  type ConnectorState,
} from "@/components/dashboard/sources/shared"

interface ImessageContact {
  id: string
  displayName: string
  handle: string
  handleNorm: string
}

// Operator-only allowlist editor. Self-contained: fetches and mutates the curated
// contact list via the 404-gated /api/integrations/imessage/allowlist routes, so the
// host panel doesn't need any iMessage-specific state. Only rendered for the operator.
export function ImessageConsolePane({
  connector,
  state,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
}) {
  const [contacts, setContacts] = useState<ImessageContact[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [nameInput, setNameInput] = useState("")
  const [handleInput, setHandleInput] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError("")
      try {
        const response = await fetch("/api/integrations/imessage/allowlist")
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "iMessage console is not enabled for this account."
              : "Failed to load the allowlist.",
          )
        }
        const data = await response.json()
        if (!cancelled) {
          setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to load the allowlist.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAdd() {
    const displayName = nameInput.trim()
    const handle = handleInput.trim()
    if (!displayName || !handle) {
      return
    }

    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/integrations/imessage/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, handle }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to add the contact.")
      }
      setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
      setNameInput("")
      setHandleInput("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add the contact.")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: string) {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/integrations/imessage/allowlist?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to remove the contact.")
      }
      setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to remove the contact.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader connector={connector} state={state} />
      <p className="max-w-[60ch] text-[12px] leading-5 text-muted-foreground">
        A reader on your Mac forwards only these people&apos;s conversations into JARVIS — full message text is
        archived so the assistant can read your threads. Everyone else (spam, 2FA codes, shortcodes, and group chats
        with no one on this list) is dropped on your machine before anything is sent.
      </p>

      <div className="flex flex-col gap-2">
        <FieldLabel className="text-[12px]">Add a contact</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="min-w-0 flex-1 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name (e.g. Alan Tai)"
              disabled={busy}
              className="min-w-0 text-[12px]"
            />
          </InputGroup>
          <InputGroup className="min-w-0 flex-1 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              placeholder="Phone or email"
              disabled={busy}
              className="min-w-0 text-[12px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={handleAdd} disabled={busy || !nameInput.trim() || !handleInput.trim()}>
                <Plus aria-hidden="true" />
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <FieldDescription className="text-[11px]">
          Phones match on the last 10 digits; emails are case-insensitive.
        </FieldDescription>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-rule pb-2">
          <FieldLabel className="text-[12px]">Allowlisted contacts</FieldLabel>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{contacts.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-copper" aria-hidden="true" /> Loading…
          </div>
        ) : contacts.length === 0 ? (
          <p className="py-4 text-[12px] text-muted-foreground">
            No contacts yet. Add someone above to start forwarding their conversations.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {contacts.map((contact) => (
              <li
                key={contact.id}
                className="flex items-center justify-between gap-3 border-b border-rule/60 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{contact.displayName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{contact.handle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(contact.id)}
                  disabled={busy}
                  className="shrink-0 rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={`Remove ${contact.displayName}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col">
        <InfoLine label="Direction" value="Mac to JARVIS (one-way, read-only)" />
        <InfoLine label="Sync" value="3×/day via local launchd reader" />
      </div>

      <InlineError message={error} />
    </div>
  )
}
