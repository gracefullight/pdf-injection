import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ValidationScreen } from "@/features/validation-result/validation-screen";

export interface SetMember {
  jobId: string;
  /**
   * The member job's own token, when the server still returns one (e.g. a
   * variant-set create response). `GET` responses for a set no longer
   * re-display individual member tokens (empty string historically, `null`
   * per the current contract) — see `setAccessToken` below.
   */
  accessToken: string | null;
  label: string;
}

export interface SetMemberDialogProps {
  member: SetMember | null;
  /**
   * The variant-set / student-keyed-set's own access token. Fixes CRITICAL
   * C-02 (r11 review): every "Open" on a polled set previously built its
   * `ValidationScreen` from `member.accessToken`, which the `GET
   * /variant-sets/:id` / `GET /student-keyed-sets/:id` responses never
   * populate (empty string) — every member read 403'd. The set's own token
   * now authorizes reads against `/jobs/:memberJobId*` for any job that
   * belongs to that set, so it's used whenever the member doesn't carry its
   * own token.
   */
  setAccessToken: string;
  sourceStem: string;
  onClose: () => void;
}

/**
 * Opens a variant-set / student-keyed-set member's own Validation screen in
 * a dialog. This app has no router (single wizard-state `App.tsx`), so
 * "open a variant's validation view" is implemented as an in-page embed of
 * the existing `ValidationScreen` rather than a navigation — the member job
 * has its own jobId and is otherwise a normal completed job.
 */
export function SetMemberDialog({
  member,
  setAccessToken,
  sourceStem,
  onClose,
}: SetMemberDialogProps) {
  const accessToken = member?.accessToken || setAccessToken;

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl" data-testid="set-member-dialog">
        <DialogHeader>
          <DialogTitle>{member ? `Validation: ${member.label}` : "Validation"}</DialogTitle>
        </DialogHeader>
        {member && (
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <ValidationScreen
              jobId={member.jobId}
              accessToken={accessToken}
              sourceStem={`${sourceStem}.${member.label}`}
              onDeleted={onClose}
              onStartOver={onClose}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
