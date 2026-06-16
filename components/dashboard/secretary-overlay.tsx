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
        className="left-[50%] top-[7vh] max-h-[86vh] w-[min(95vw,920px)] max-w-none translate-x-[-50%] translate-y-0 gap-0 rounded-sm border-rule-strong p-0"
      >
        <DialogTitle className="sr-only">Secretary</DialogTitle>
        <div className="rail-scroll max-h-[86vh] overflow-y-auto px-5 py-5">
          <MasterInput tasks={tasks} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
