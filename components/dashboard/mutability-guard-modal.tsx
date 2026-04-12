"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, Lock, Unlock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface MutabilityGuardModalProps {
  open: boolean
  calendarName: string
  sourceLabel: string
  onCancel: () => void
  onSave: (isImmutable: boolean) => Promise<void> | void
  isSaving?: boolean
}

export function MutabilityGuardModal({
  open,
  calendarName,
  sourceLabel,
  onCancel,
  onSave,
  isSaving = false,
}: MutabilityGuardModalProps) {
  const [selectedValue, setSelectedValue] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) {
      setSelectedValue(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSaving && onCancel()}>
      <DialogContent className="sm:max-w-md border-red-200/80 bg-red-50/95 text-slate-900 shadow-2xl dark:border-red-900/60 dark:bg-[#2f1418] dark:text-red-50">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-200/80 text-red-700 dark:bg-red-950/70 dark:text-red-200">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>Mutability Guard</DialogTitle>
          <DialogDescription className="text-red-900/80 dark:text-red-100/80">
            Choose a default mutability for <span className="font-semibold">{calendarName}</span> before
            this {sourceLabel} calendar can be created or imported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {[
            {
              value: true,
              title: "Immutable",
              description: "New items default to locked timing. They can’t be moved casually after sync.",
              icon: Lock,
            },
            {
              value: false,
              title: "Mutable",
              description: "New items default to editable timing. You can still lock individual items later.",
              icon: Unlock,
            },
          ].map((option) => {
            const Icon = option.icon
            const isSelected = selectedValue === option.value

            return (
              <button
                type="button"
                key={option.title}
                onClick={() => setSelectedValue(option.value)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-red-400 bg-white shadow-md dark:border-red-400 dark:bg-red-950/50"
                    : "border-red-200/70 bg-white/70 hover:border-red-300 dark:border-red-900/70 dark:bg-black/10"
                }`}
              >
                <div
                  className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full ${
                    isSelected
                      ? "bg-red-200 text-red-700 dark:bg-red-900/80 dark:text-red-100"
                      : "bg-red-100 text-red-500 dark:bg-red-950/70 dark:text-red-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{option.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-red-100/75">
                    {option.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (selectedValue === null) {
                return
              }

              void onSave(selectedValue)
            }}
            disabled={selectedValue === null || isSaving}
            className="bg-red-400 text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Guard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
