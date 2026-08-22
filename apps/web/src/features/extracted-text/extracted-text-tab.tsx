import type { ClientValidationInput } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ExtractedTextTabProps {
  pageTexts: string[];
  matches: ClientValidationInput["extractedText"]["pages"];
  targetPageIndex: number;
  normalizedInstruction: string;
}

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
}: ExtractedTextTabProps) {
  const [selectedPage, setSelectedPage] = useState(targetPageIndex);

  const selectedMatch = matches.find((match) => match.pageIndex === selectedPage);
  const selectedText = pageTexts[selectedPage] ?? "";

  return (
    <div className="flex flex-col gap-4" data-testid="extracted-text-tab">
      <Alert data-testid="extracted-text-disclaimer">
        <AlertDescription>
          This is the PDF.js parser view and may differ from the actual LLM provider's document
          ingestion result.
        </AlertDescription>
      </Alert>

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
