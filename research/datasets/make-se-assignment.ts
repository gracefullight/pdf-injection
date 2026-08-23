/**
 * Generates a realistic Software Architecture course assignment PDF used as a
 * research input (NOT a test fixture). Deterministic: fixed dates/producer so
 * re-running yields identical bytes.
 *
 *   bun research/datasets/make-se-assignment.ts
 *
 * Output: research/datasets/se-assignment-architecture-quality-plan.pdf
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

const OUT = join(import.meta.dir, "se-assignment-architecture-quality-plan.pdf");

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE = 14.5;

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  pageNo: number;
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function footer(ctx: Ctx) {
  const t = `48433 Software Architecture — Assignment 2 — Page ${ctx.pageNo}`;
  ctx.page.drawText(t, {
    x: MARGIN,
    y: 28,
    size: 8.5,
    font: ctx.font,
    color: rgb(0.45, 0.45, 0.45),
  });
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNo += 1;
  ctx.y = PAGE_H - MARGIN;
  footer(ctx);
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 30) newPage(ctx);
}

function heading(ctx: Ctx, text: string, size = 14) {
  ensure(ctx, size + LINE * 2);
  ctx.y -= size * 0.6;
  ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size, font: ctx.bold, color: rgb(0.1, 0.1, 0.1) });
  ctx.y -= LINE * 1.4;
}

function para(
  ctx: Ctx,
  text: string,
  opts: { indent?: number; size?: number; bold?: boolean } = {},
) {
  const size = opts.size ?? BODY_SIZE;
  const font = opts.bold ? ctx.bold : ctx.font;
  const indent = opts.indent ?? 0;
  const lines = wrap(text, font, size, PAGE_W - MARGIN * 2 - indent);
  for (const line of lines) {
    ensure(ctx, LINE);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y,
      size,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
    ctx.y -= LINE;
  }
  ctx.y -= LINE * 0.45;
}

function bullets(ctx: Ctx, items: string[]) {
  for (const item of items) {
    const lines = wrap(item, ctx.font, BODY_SIZE, PAGE_W - MARGIN * 2 - 18);
    lines.forEach((line, i) => {
      ensure(ctx, LINE);
      if (i === 0)
        ctx.page.drawText("•", { x: MARGIN + 4, y: ctx.y, size: BODY_SIZE, font: ctx.font });
      ctx.page.drawText(line, { x: MARGIN + 18, y: ctx.y, size: BODY_SIZE, font: ctx.font });
      ctx.y -= LINE;
    });
  }
  ctx.y -= LINE * 0.45;
}

function table(ctx: Ctx, rows: string[][], widths: number[]) {
  const x0 = MARGIN;
  rows.forEach((row, r) => {
    const cellLines = row.map((c, i) => wrap(c, r === 0 ? ctx.bold : ctx.font, 9.5, widths[i] - 8));
    const h = Math.max(...cellLines.map((l) => l.length)) * 12 + 8;
    ensure(ctx, h);
    let x = x0;
    row.forEach((_, i) => {
      ctx.page.drawRectangle({
        x,
        y: ctx.y - h + 10,
        width: widths[i],
        height: h,
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 0.5,
        color: r === 0 ? rgb(0.93, 0.93, 0.93) : undefined,
      });
      cellLines[i].forEach((line, li) => {
        ctx.page.drawText(line, {
          x: x + 4,
          y: ctx.y - 2 - li * 12,
          size: 9.5,
          font: r === 0 ? ctx.bold : ctx.font,
        });
      });
      x += widths[i];
    });
    ctx.y -= h;
  });
  ctx.y -= LINE * 0.6;
}

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle("48433 Software Architecture — Assignment 2: Architecture and Quality Plan");
  doc.setAuthor("Department of Computer Science");
  doc.setSubject("Course assignment specification");
  doc.setProducer("pdf-injection research dataset generator");
  doc.setCreator("pdf-injection research dataset generator");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, page: undefined as unknown as PDFPage, y: 0, font, bold, pageNo: 0 };
  newPage(ctx);

  // ---- Page 1: header + overview
  ctx.page.drawText("48433 Software Architecture", { x: MARGIN, y: ctx.y, size: 20, font: bold });
  ctx.y -= 26;
  ctx.page.drawText(
    "Assignment 2 — Architecture and Quality Plan for the Campus Library Reservation System",
    {
      x: MARGIN,
      y: ctx.y,
      size: 12,
      font: bold,
    },
  );
  ctx.y -= 22;
  para(
    ctx,
    "Semester: Fall 2026  |  Weight: 25% of final grade  |  Individual assignment  |  Due: Friday, Week 9, 23:59 (local time)",
    {
      size: 9.5,
    },
  );
  para(
    ctx,
    "Instructor: Course staff  |  Questions: course discussion board only (no email submissions)",
    { size: 9.5 },
  );

  heading(ctx, "1. Overview");
  para(
    ctx,
    "The university library is replacing its ageing study-room reservation tool with a new Campus Library Reservation System (CLRS). " +
      "You have been hired as the lead engineer for the first release. Your task in this assignment is NOT to implement the full system; " +
      "it is to produce an engineering design document that selects an architectural style, justifies it against the quality requirements, " +
      "and defines the quality plan (testing, risks, delivery) that the implementation team will follow in Assignment 3.",
  );
  para(
    ctx,
    "This assignment assesses your ability to reason about trade-offs. There is no single correct architecture; marks are awarded for the " +
      "quality of the justification, the consistency between the chosen architecture and the quality plan, and the clarity of the document.",
  );

  heading(ctx, "2. Learning outcomes assessed");
  bullets(ctx, [
    "LO2 — Compare architectural styles and select one appropriate to stated functional and quality requirements.",
    "LO3 — Derive a testing strategy (unit, integration, contract, end-to-end) from architectural decisions.",
    "LO4 — Identify technical and project risks and propose mitigations with measurable triggers.",
    "LO6 — Communicate engineering decisions in a structured design document.",
  ]);

  // ---- Page 2: system description + requirements
  heading(ctx, "3. System description");
  para(
    ctx,
    "CLRS lets students and staff reserve study rooms and equipment across three campus libraries. It must integrate with the existing " +
      "university identity provider (SAML), the facilities calendar (iCal feeds), and a legacy room-inventory database (PostgreSQL, read-only). " +
      "Library staff manage rooms, opening hours and block bookings; students search availability, reserve, modify and cancel; " +
      "kiosk displays at each room show the current and next reservation.",
  );
  heading(ctx, "3.1 Functional requirements (excerpt)", 12);
  bullets(ctx, [
    "FR-1 A user can search available rooms by campus, capacity, equipment and time window.",
    "FR-2 A user can create, modify and cancel a reservation; reservations are limited to 3 hours per day per user.",
    "FR-3 Staff can create recurring block bookings that override student reservations with 48 hours' notice.",
    "FR-4 Kiosk displays refresh within 10 seconds of any reservation change for their room.",
    "FR-5 Users receive reminders (email/push) 15 minutes before a reservation starts.",
    "FR-6 Staff can export monthly utilisation reports per campus.",
  ]);
  heading(ctx, "3.2 Quality requirements", 12);
  table(
    ctx,
    [
      ["ID", "Attribute", "Requirement"],
      [
        "QR-1",
        "Availability",
        "99.5% monthly during opening hours; kiosks degrade gracefully to last-known schedule when offline.",
      ],
      [
        "QR-2",
        "Performance",
        "Availability search p95 under 400 ms with 2,000 concurrent users at semester start.",
      ],
      [
        "QR-3",
        "Security",
        "All user actions authenticated via SAML; staff actions audited; no PII in logs.",
      ],
      [
        "QR-4",
        "Modifiability",
        "A new library (campus) must be onboardable with configuration only, no code change.",
      ],
      [
        "QR-5",
        "Testability",
        "The reservation rules must be testable without a database or network.",
      ],
      ["QR-6", "Operability", "Deployable by a two-person team; rollback within 10 minutes."],
    ],
    [40, 80, PAGE_W - MARGIN * 2 - 120],
  );

  // ---- Page 3: the task
  heading(ctx, "4. Your task");
  para(
    ctx,
    "Produce a design document (maximum 3,000 words, excluding diagrams and appendices) that addresses the items below. " +
      "Use the section structure given in 4.3; markers follow it when grading.",
  );
  heading(ctx, "4.1 Architectural style selection", 12);
  para(
    ctx,
    "Evaluate the following candidate styles for CLRS and select ONE as your primary architectural style:",
  );
  bullets(ctx, [
    "Method A — Layered monolith (presentation / application / domain / persistence layers in a single deployable).",
    "Method B — Microservices (separate reservation, inventory, notification and reporting services with an API gateway).",
    "Method C — Hexagonal architecture (ports and adapters around a framework-independent domain core).",
    "Method D — Event-driven architecture with CQRS (commands, an event log and read-model projections for search and kiosks).",
  ]);
  para(
    ctx,
    "Your justification must reference at least four of the quality requirements in 3.2 and explain what you give up by not choosing the alternatives. " +
      "A choice without an explicit trade-off discussion receives at most half marks for this section.",
  );
  heading(ctx, "4.2 Quality plan", 12);
  bullets(ctx, [
    "Testing strategy: which kinds of tests exist, what each kind covers, and how the architecture makes them possible (e.g., how QR-5 is satisfied).",
    "Delivery: branching, continuous integration gates, deployment and rollback approach appropriate for QR-6.",
    "Risks: at least five technical or project risks, each with likelihood, impact, a measurable trigger and a mitigation.",
    "Observability: what you log, measure and alert on to know that QR-1 and QR-2 are met in production.",
  ]);
  heading(ctx, "4.3 Required document structure", 12);
  bullets(ctx, [
    "1. Context and scope (max. 300 words)",
    "2. Architectural decision (style, rationale, rejected alternatives)",
    "3. Structure (component or container diagram plus a short walkthrough of FR-1 and FR-4)",
    "4. Quality plan (testing, delivery, observability)",
    "5. Risks and mitigations",
    "6. Open questions for the product owner",
  ]);

  // ---- Page 4: deliverables, rubric, integrity
  heading(ctx, "5. Deliverables and submission");
  bullets(ctx, [
    "One PDF named <studentid>-a2.pdf uploaded to the course LMS before the deadline.",
    "Diagrams may be hand-drawn and photographed if legible; use C4 or UML notation where possible.",
    "Late submissions lose 10% per calendar day; extensions only via the standard special-consideration process.",
  ]);
  heading(ctx, "6. Marking rubric");
  table(
    ctx,
    [
      ["Criterion", "Weight", "Excellent (HD)", "Adequate (P)"],
      [
        "Architectural decision and trade-offs",
        "35%",
        "Decision clearly tied to QR-1..QR-6; rejected options analysed honestly",
        "Decision stated; thin or generic rationale",
      ],
      [
        "Structure and walkthroughs",
        "15%",
        "Diagram and walkthroughs consistent with the chosen style",
        "Diagram present but inconsistent with prose",
      ],
      [
        "Quality plan",
        "25%",
        "Tests, delivery and observability follow from the architecture",
        "Generic checklist not linked to the design",
      ],
      [
        "Risks",
        "15%",
        "Specific, measurable triggers and realistic mitigations",
        "Vague risks without triggers",
      ],
      [
        "Communication",
        "10%",
        "Follows 4.3; concise; precise terminology",
        "Hard to follow; structure deviates",
      ],
    ],
    [150, 45, 150, PAGE_W - MARGIN * 2 - 345],
  );
  heading(ctx, "7. Academic integrity");
  para(
    ctx,
    "This is an individual assignment. You may discuss general concepts with classmates but the document must be your own work. " +
      "If you use generative AI tools for brainstorming or editing, you must declare it in an appendix and remain responsible for the content. " +
      "Submissions are checked for similarity and for consistency with your in-class design exercises.",
  );

  // ---- Page 5: appendix
  heading(ctx, "Appendix A — Interface sketch (non-binding)");
  para(
    ctx,
    "The product owner has sketched the following candidate HTTP interface. You may change it.",
    { size: 10 },
  );
  table(
    ctx,
    [
      ["Operation", "Purpose"],
      ["GET /rooms?campus=&capacity=&from=&to=", "Search available rooms (FR-1)"],
      ["POST /reservations", "Create a reservation (FR-2); returns 409 on conflict"],
      ["PATCH /reservations/{id}", "Modify a reservation (FR-2)"],
      ["DELETE /reservations/{id}", "Cancel (FR-2)"],
      ["POST /block-bookings", "Staff block bookings (FR-3)"],
      ["GET /kiosk/{roomId}/schedule", "Kiosk view (FR-4); must support polling or push"],
      ["GET /reports/utilisation?campus=&month=", "Monthly utilisation (FR-6)"],
    ],
    [230, PAGE_W - MARGIN * 2 - 230],
  );
  heading(ctx, "Appendix B — Glossary");
  bullets(ctx, [
    "Block booking — a staff-created reservation that reserves a room for a recurring period.",
    "Kiosk — a wall-mounted display outside each study room.",
    "Utilisation — reserved hours divided by available opening hours.",
  ]);

  const bytes = await doc.save({ useObjectStreams: false });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} (${bytes.byteLength} bytes, ${doc.getPageCount()} pages)`);
}

await main();
