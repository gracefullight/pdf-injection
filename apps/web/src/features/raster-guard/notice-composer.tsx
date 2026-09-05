import {
  generateNoticeKey,
  type LintNoticeResult,
  NOTICE_TEMPLATES,
  type NoticeTemplateId,
  type NoticeVariables,
} from "@pdf-injection/raster-guard";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface NoticeComposerProps {
  templateId: NoticeTemplateId;
  onTemplateIdChange: (id: NoticeTemplateId) => void;
  variables: NoticeVariables;
  onVariablesChange: (variables: NoticeVariables) => void;
  /** Fully rendered notice, for the preview. */
  noticeText: string;
  lint: LintNoticeResult;
}

/**
 * Composes the notice: pick a template, fill in the subject and contact, and
 * read back exactly what will be painted.
 *
 * The response sentence gets its own field because it is the one line that
 * matters twice — it is what the assistant is asked to say, and it is the
 * canary an instructor later scores a submission against.
 */
export function NoticeComposer({
  templateId,
  onTemplateIdChange,
  variables,
  onVariablesChange,
  noticeText,
  lint,
}: NoticeComposerProps) {
  const template = NOTICE_TEMPLATES.find((entry) => entry.id === templateId) ?? NOTICE_TEMPLATES[0];

  function update<K extends keyof NoticeVariables>(field: K, value: NoticeVariables[K]) {
    onVariablesChange({ ...variables, [field]: value });
  }

  return (
    <Card data-testid="raster-guard-notice-composer">
      <CardHeader>
        <CardTitle className="text-base">2. Notice</CardTitle>
        <CardDescription>
          What an assistant reads when a student uploads this document, and what it is asked to say
          back to them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="notice-template">Template</Label>
          <Select
            value={templateId}
            onValueChange={(value) => onTemplateIdChange(value as NoticeTemplateId)}
          >
            <SelectTrigger id="notice-template" data-testid="notice-template-select">
              <SelectValue placeholder="Select a notice template" />
            </SelectTrigger>
            <SelectContent>
              {NOTICE_TEMPLATES.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{template?.description}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-institution">Institution</Label>
            <Input
              id="notice-institution"
              value={variables.institution}
              onChange={(event) => update("institution", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-subject">Subject or task</Label>
            <Input
              id="notice-subject"
              placeholder="31251 Programming Fundamentals, Assignment 2"
              value={variables.subject}
              onChange={(event) => update("subject", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-contact">Who to contact</Label>
            <Input
              id="notice-contact"
              value={variables.contact}
              onChange={(event) => update("contact", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-key">Reference code</Label>
            <div className="flex gap-2">
              <Input
                id="notice-key"
                value={variables.key}
                placeholder="ABCD2345"
                onChange={(event) => update("key", event.target.value.toUpperCase())}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => update("key", generateNoticeKey())}
                data-testid="notice-key-generate"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                <span className="sr-only">Generate a reference code</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Printed in the notice and scored as a canary. Issue a different code per student to
              make a surfaced notice traceable to one copy.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notice-response">Sentence the assistant is asked to reply with</Label>
          <Textarea
            id="notice-response"
            rows={3}
            value={variables.response}
            placeholder={template?.defaultResponse}
            onChange={(event) => update("response", event.target.value)}
            data-testid="notice-response-input"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to use the template's own wording. This sentence is also the primary canary,
            so keep at least a few distinctive words in it.
          </p>
        </div>

        {lint.errors.map((issue) => (
          <Alert key={issue.id} variant="destructive" data-testid={`notice-lint-${issue.id}`}>
            <AlertTitle>This notice cannot be used</AlertTitle>
            <AlertDescription>{issue.message}</AlertDescription>
          </Alert>
        ))}
        {lint.warnings.map((issue) => (
          <Alert key={issue.id} variant="warning" data-testid={`notice-lint-${issue.id}`}>
            <AlertTitle>Check this before generating</AlertTitle>
            <AlertDescription>{issue.message}</AlertDescription>
          </Alert>
        ))}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Exactly what gets painted</p>
          <pre
            className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed text-foreground"
            data-testid="notice-preview"
          >
            {noticeText}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
