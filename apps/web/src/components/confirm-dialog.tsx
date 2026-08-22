import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmingLabel?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  "data-testid"?: string;
  confirmTestId?: string;
}

/**
 * Shared confirm/cancel dialog for destructive row actions. Fixes H-07
 * (r11 review): row-level deletes across submissions / model-test runs /
 * robustness runs had no confirmation at all. Also fixes M-16: initial
 * keyboard focus lands on Cancel, not the destructive action, so pressing
 * Enter right after the dialog opens never destroys data by accident.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmingLabel,
  confirming,
  onConfirm,
  onCancel,
  "data-testid": testId,
  confirmTestId,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        data-testid={testId}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={confirming}
            data-testid={confirmTestId}
          >
            {confirming ? (confirmingLabel ?? "Deleting…") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
