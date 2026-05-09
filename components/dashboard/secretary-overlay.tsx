"use client"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { MasterInput } from "@/components/dashboard/master-input"
import type { Task } from "@/types"

export function SecretaryOverlay({
  isOpen,
  onOpenChange,
  tasks,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  tasks: Task[]
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="left-[50%] top-[8vh] max-h-[84vh] w-[min(92vw,720px)] max-w-none translate-x-[-50%] translate-y-0 gap-0 rounded-sm border-rule-strong p-0"
      >
        <DialogTitle className="sr-only">Secretary</DialogTitle>
        <div className="rail-scroll max-h-[84vh] overflow-y-auto px-5 py-5">
          <MasterInput tasks={tasks} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
