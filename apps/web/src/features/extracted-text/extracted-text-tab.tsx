import type { ClientValidationInput, InjectionMode } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ExtractedTextTabProps {
  pageTexts: string[];
  matches: ClientValidationInput["extractedText"]["pages"];
  targetPageIndex: number;
  normalizedInstruction: string;
  injectionMode: InjectionMode;
}

/**
 * Explains, per mode, why this tab's PDF.js-based view will not show the payload for a
 * deterministically-non-pdfjs-extractable mode — so an empty/no-match result reads as expected
 * behavior, not a bug. Only modes where pdfjs extraction is known to always miss the payload get
 * an entry here; every other mode relies on the plain extracted-text view speaking for itself.
 */
export const NON_EXTRACTABLE_MODE_NOTES: Partial<Record<InjectionMode, string>> = {
  unicode_tags:
    "Unicode Tag payload: present in the file, not visible to PDF.js text extraction " +
    "(Cf-category characters are filtered). Whether a provider's extractor sees it is what " +
    "the Model Test measures.",
  image_only:
    "Round-3 research probe, visible by design: the instruction is rasterized to an image, not " +
    "written as a text object at all. No text-based extractor — including PDF.js — can find it " +
    "here; this mode exists to test whether a provider's ingestion has a vision path instead.",
  freetext_annot:
    "Round-3 research probe: the payload is invisible (Tr 3) text inside a FreeText annotation's " +
    "appearance stream. PDF.js's page text extraction (used by this tab) does not walk annotation " +
    "appearance streams, so it will not appear here — that's expected, not a bug. It is extracted " +
    "by poppler's pdftotext, which is what this mode measures.",
  acroform_field:
    "Round-3 research probe: the payload is invisible (Tr 3) text inside an AcroForm text-field " +
    "widget's appearance. PDF.js's page text extraction (used by this tab) does not walk widget " +
    "appearance streams, so it will not appear here — that's expected, not a bug. It is extracted " +
    "by poppler's pdftotext, which is what this mode measures.",
  info_dict:
    "Round-3 research probe: the payload lives only in the PDF /Info dictionary's Subject and " +
    "Keywords fields, never in page text. No text extractor — including PDF.js — will show it " +
    "here; it is surfaced only by metadata reads such as pdfinfo.",
};

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-warning text-warning-foreground">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
}

/** Screen 4 "Extracted Text" tab — PDF.js `getTextContent()` view of the output PDF. */
export function ExtractedTextTab({
  pageTexts,
  matches,
  targetPageIndex,
  normalizedInstruction,
  injectionMode,
}: ExtractedTextTabProps) {
  const [selectedPage, setSelectedPage] = useState(targetPageIndex);

  const selectedMatch = matches.find((match) => match.pageIndex === selectedPage);
  const selectedText = pageTexts[selectedPage] ?? "";
  const nonExtractableNote = NON_EXTRACTABLE_MODE_NOTES[injectionMode];

  return (
    <div className="flex flex-col gap-4" data-testid="extracted-text-tab">
      <Alert data-testid="extracted-text-disclaimer">
        <AlertDescription>
          This is the PDF.js parser view and may differ from the actual LLM provider's document
          ingestion result.
        </AlertDescription>
      </Alert>

      {nonExtractableNote && (
        <Alert
          data-testid={
            // "extracted-text-unicode-tags-note" is the pre-existing testid (kept verbatim —
            // tests/e2e/tests/unicode-tags.spec.ts asserts on it); the 4 new round-3 probe modes
            // get their own testid in the same naming family.
            injectionMode === "unicode_tags"
              ? "extracted-text-unicode-tags-note"
              : `extracted-text-non-extractable-note-${injectionMode.replace(/_/g, "-")}`
          }
        >
          <AlertDescription>{nonExtractableNote}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-1">
        {pageTexts.map((_, index) => {
          const match = matches.find((m) => m.pageIndex === index);
          const anyMatch = match
            ? match.exactMatch || match.normalizedMatch || match.caseInsensitiveMatch
            : false;
          return (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: page index is the stable identifier here
              key={index}
              type="button"
              size="sm"
              variant={selectedPage === index ? "default" : "outline"}
              onClick={() => setSelectedPage(index)}
              data-testid={`extracted-text-page-button-${index}`}
            >
              Page {index + 1}
              {anyMatch && (
                <Badge variant="success" className="ml-1">
                  match
                </Badge>
              )}
              {index === targetPageIndex && <span className="ml-1 text-xs">(target)</span>}
            </Button>
          );
        })}
      </div>

      {selectedMatch && (
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4"
          data-testid="extracted-text-match-status"
        >
          <dt className="text-muted-foreground">Exact match</dt>
          <dd>{selectedMatch.exactMatch ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">Normalized match</dt>
          <dd>{selectedMatch.normalizedMatch ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">Case-insensitive match</dt>
          <dd>{selectedMatch.caseInsensitiveMatch ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">Target page match</dt>
          <dd>
            {selectedPage === targetPageIndex
              ? selectedMatch.exactMatch || selectedMatch.normalizedMatch
                ? "yes"
                : "no"
              : "n/a"}
          </dd>
          <dt className="text-muted-foreground">Text length</dt>
          <dd>{selectedMatch.textLength}</dd>
        </dl>
      )}

      <div
        className="rounded-md border border-border bg-secondary p-3 text-sm whitespace-pre-wrap"
        data-testid="extracted-text-content"
      >
        {highlight(selectedText, normalizedInstruction)}
      </div>
    </div>
  );
}
