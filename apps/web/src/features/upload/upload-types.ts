export interface UploadedSource {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  encrypted: boolean;
  hasSignatureHint: boolean;
  pdfJsVersion: string;
}

export interface UploadValidationIssue {
  message: string;
}
