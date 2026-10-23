import React, { useState } from "react";
import { Ticket } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import SlipPanel from "@/components/slip/SlipPanel";
import { useSlip } from "@/lib/SlipProvider";

export default function SlipDock() {
  const { count } = useSlip();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border border-primary/40 bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] md:bottom-6 md:right-6"
        aria-label={`Abrir boletim de simulação (${count})`}
      >
        <Ticket className="h-4 w-4" aria-hidden="true" />
        Boletim
        {count > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-background/90 px-1 text-[11px] font-bold text-primary">
            {count}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col border-border bg-card sm:max-w-md">
          <SheetHeader className="border-b border-border pb-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-primary" aria-hidden="true" />
              Boletim de simulação
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden px-4 pt-3">
            <SlipPanel onDone={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}