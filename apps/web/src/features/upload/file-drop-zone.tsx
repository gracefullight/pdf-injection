import { UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface FileDropZoneProps {
  /** Single-file mode (default) — Screen 1's PDF upload. */
  onFileSelected?: (file: File) => void;
  /** Multi-file mode — pass `multiple` too. Used by the Screenshot OCR panel (r11 review M-09:
   * every other upload surface in the app uses this drop-zone pattern; the OCR panel used to be
   * a bare, unstyled native `<input type="file">` with no label/helper text). */
  onFilesSelected?: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  label?: string;
  helperText?: string;
  "data-testid-input"?: string;
  "data-testid-container"?: string;
}

/** Drag-and-drop + file-picker upload target, reused across upload surfaces. */
export function FileDropZone({
  onFileSelected,
  onFilesSelected,
  multiple = false,
  accept = "application/pdf",
  disabled,
  label = "Drag and drop a PDF here, or click to browse",
  helperText = "PDF only, up to 25 MB, up to 100 pages",
  "data-testid-input": inputTestId = "upload-file-input",
  "data-testid-container": containerTestId = "upload-drop-zone",
}: FileDropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (multiple) onFilesSelected?.(files);
    else if (files[0]) onFileSelected?.(files[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    handleFiles(event.dataTransfer.files);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    event.target.value = "";
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: this div wraps a nested <input type="file"> (line ~88); a native <button> cannot contain an interactive <input> descendant (invalid HTML content model). Keyboard access (Enter/Space) is handled explicitly below.
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      data-testid={containerTestId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragActive(true);
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={disabled ? undefined : handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-input p-10 text-center transition-colors",
        isDragActive && "border-accent-foreground bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <UploadCloud className="size-10 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
      </div>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        data-testid={inputTestId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        disabled={disabled}
        onChange={handleInputChange}
      />
    </div>
  );
}
