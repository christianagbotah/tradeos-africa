import PDFDocument from "pdfkit";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// The Latin subset contains the amount digits; Latin Extended contains U+20B5.
const BODY_FONT = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff");
const BOLD_FONT = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff");
const CEDI_FONT = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff");

export interface PurchaseOrderAttachmentSnapshot {
  number: string;
  businessName: string;
  branchName: string;
  supplierName: string;
  currency: string;
  expectedDate: string | null;
  totalMinor: number;
  notes: string;
  lines: Array<{
    name: string;
    unit: string;
    quantity: number;
    unitCostMinor: number;
    lineTotalMinor: number;
  }>;
}
function safeText(value: unknown, max = 220): string {
  if (typeof value !== "string") throw new Error("PO_PDF_SNAPSHOT_INVALID");
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (cleaned.length > max) throw new Error("PO_PDF_TEXT_TOO_LONG");
  return cleaned;
}
function safeMoney(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("PO_PDF_AMOUNT_INVALID");
  }
  return value;
}
function validateSnapshot(value: unknown): PurchaseOrderAttachmentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PO_PDF_SNAPSHOT_INVALID");
  }
  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.lines) || snapshot.lines.length < 1 ||
      snapshot.lines.length > 500) throw new Error("PO_PDF_LINES_INVALID");
  const currency = safeText(snapshot.currency, 8);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("PO_PDF_CURRENCY_INVALID");
  const expectedDate = snapshot.expectedDate === null ? null :
    safeText(snapshot.expectedDate, 10);
  if (expectedDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    throw new Error("PO_PDF_DATE_INVALID");
  }
  return {
    number: safeText(snapshot.number, 80),
    businessName: safeText(snapshot.businessName),
    branchName: safeText(snapshot.branchName),
    supplierName: safeText(snapshot.supplierName),
    currency, expectedDate,
    notes: safeText(snapshot.notes, 2000),
    totalMinor: safeMoney(snapshot.totalMinor),
    lines: snapshot.lines.map(entry => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("PO_PDF_LINE_INVALID");
      }
      const line = entry as Record<string, unknown>;
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12) {
        throw new Error("PO_PDF_QUANTITY_INVALID");
      }
      return {
        name: safeText(line.name, 400),
        unit: safeText(line.unit, 100),
        quantity,
        unitCostMinor: safeMoney(line.unitCostMinor),
        lineTotalMinor: safeMoney(line.lineTotalMinor),
      };
    }),
  };
}
function amount(minor: number) {
  return new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(minor / 100);
}
function drawAmount(doc: PDFKit.PDFDocument, minor: number, currency: string,
  x: number, y: number, width: number, size = 9, bold = false) {
  const number = amount(minor);
  const numberFont = bold ? BOLD_FONT : BODY_FONT;
  doc.font(numberFont).fontSize(size);
  const numberWidth = doc.widthOfString(number);
  const prefix = currency === "GHS" ? "₵" : currency + " ";
  doc.font(currency === "GHS" ? CEDI_FONT : numberFont).fontSize(size);
  const prefixWidth = doc.widthOfString(prefix);
  const startX = x + width - numberWidth - prefixWidth;
  doc.text(prefix, startX, y, { lineBreak: false });
  doc.font(numberFont).fontSize(size).text(number, startX + prefixWidth, y, {
    lineBreak: false,
  });
}
const INK = "#16223d";
const MUTED = "#536079";
const ACCENT = "#0b806d";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = PAGE_HEIGHT - 70;

function drawPageHeader(doc: PDFKit.PDFDocument, snapshot: PurchaseOrderAttachmentSnapshot,
  firstPage: boolean) {
  doc.font(BOLD_FONT).fontSize(20).fillColor(INK)
    .text(firstPage ? "PURCHASE ORDER" : "PURCHASE ORDER (CONTINUED)", MARGIN, 42);
  doc.font(BODY_FONT).fontSize(9).fillColor(MUTED)
    .text(snapshot.number, MARGIN, 74);
  doc.moveTo(MARGIN, 98).lineTo(PAGE_WIDTH - MARGIN, 98)
    .lineWidth(1.4).strokeColor(ACCENT).stroke();
}
function tableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(MARGIN, y, CONTENT, 27).fill(INK);
  doc.font(BOLD_FONT).fontSize(9).fillColor("#ffffff");
  doc.text("Item / unit", MARGIN + 11, y + 8, { width: 233, lineBreak: false });
  doc.text("Qty", 296, y + 8, { width: 54, align: "right", lineBreak: false });
  doc.text("Unit price", 355, y + 8, { width: 81, align: "right", lineBreak: false });
  doc.text("Line total", 445, y + 8, { width: 94, align: "right", lineBreak: false });
  return y + 27;
}

/** Server-created PDF of the persisted delivery draft, never current mutable catalog data. */
export async function renderSupplierPurchaseOrderPdf(raw: unknown): Promise<Buffer> {
  const snapshot = validateSnapshot(raw);
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN,
      bufferPages: true, autoFirstPage: false, info: {
        Title: "Purchase order " + snapshot.number,
        Author: "TradeOS Africa",
        Subject: "Supplier purchase order - not evidence of receipt or payment",
      }});
    const chunks: Buffer[] = [];
    let collected = 0;
    doc.on("data", (chunk: Buffer) => {
      collected += chunk.length;
      if (collected > 6_000_000) {
        doc.destroy(new Error("PO_PDF_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    try {
      doc.addPage();
      drawPageHeader(doc, snapshot, true);
      doc.font(BOLD_FONT).fontSize(9).fillColor(MUTED)
        .text("ISSUING BUSINESS", MARGIN, 116)
        .text("SUPPLIER", 318, 116);
      doc.font(BOLD_FONT).fontSize(12).fillColor(INK)
        .text(snapshot.businessName, MARGIN, 132, { width: 246 })
        .text(snapshot.supplierName, 318, 132, { width: 235 });
      const infoY = Math.max(doc.y, 172);
      doc.font(BODY_FONT).fontSize(9).fillColor(MUTED)
        .text("Branch: " + snapshot.branchName, MARGIN, infoY, { width: 245 });
      const date = snapshot.expectedDate ?
        snapshot.expectedDate.split("-").reverse().join("/") : "To be confirmed";
      doc.text("Expected delivery: " + date, MARGIN, infoY + 20);
      let y = tableHeader(doc, Math.max(doc.y + 35, 226));
      snapshot.lines.forEach((line, index) => {
        doc.font(BODY_FONT).fontSize(9);
        const text = line.name + " (" + line.unit + ")";
        const rowHeight = Math.max(35, doc.heightOfString(text, {
          width: 224, lineGap: 1,
        }) + 18);
        if (y + rowHeight > PAGE_BOTTOM - 84) {
          doc.addPage();
          drawPageHeader(doc, snapshot, false);
          y = tableHeader(doc, 120);
        }
        if (index % 2 === 0) doc.rect(MARGIN, y, CONTENT, rowHeight).fill("#f3f6f9");
        doc.font(BODY_FONT).fontSize(9).fillColor(INK)
          .text(text, MARGIN + 11, y + 9, { width: 224, lineGap: 1 });
        doc.text(new Intl.NumberFormat("en-GH", { maximumFractionDigits: 4 }).format(
          line.quantity), 296, y + 9, { width: 54, align: "right", lineBreak: false });
        drawAmount(doc, line.unitCostMinor, snapshot.currency, 355, y + 9, 81);
        drawAmount(doc, line.lineTotalMinor, snapshot.currency, 445, y + 9, 94);
        y += rowHeight;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.4)
          .strokeColor("#d8e0ea").stroke();
      });
      if (y + 122 > PAGE_BOTTOM) {
        doc.addPage();
        drawPageHeader(doc, snapshot, false);
        y = 120;
      }
      doc.rect(329, y + 16, 224, 37).fill(INK);
      doc.font(BOLD_FONT).fontSize(10).fillColor("#ffffff")
        .text("TOTAL", 340, y + 27, { width: 56, lineBreak: false });
      doc.fillColor("#ffffff");
      drawAmount(doc, snapshot.totalMinor, snapshot.currency, 400, y + 27, 140, 10, true);
      y += 69;
      if (snapshot.notes) {
        doc.font(BODY_FONT).fontSize(8.5);
        const words = snapshot.notes.split(/\s+/);
        const noteLines: string[] = [];
        let line = "";
        for (const word of words) {
          const candidate = line ? line + " " + word : word;
          if (doc.widthOfString(candidate) <= CONTENT) {
            line = candidate;
            continue;
          }
          if (line) noteLines.push(line);
          line = "";
          // Break exceptionally long identifiers so they cannot escape the page.
          for (const character of word) {
            if (line && doc.widthOfString(line + character) > CONTENT) {
              noteLines.push(line);
              line = "";
            }
            line += character;
          }
        }
        if (line) noteLines.push(line);
        if (y + 40 > PAGE_HEIGHT - 106) {
          doc.addPage();
          drawPageHeader(doc, snapshot, false);
          y = 120;
        }
        doc.font(BOLD_FONT).fontSize(9).fillColor(INK)
          .text("Notes", MARGIN, y, { lineBreak: false });
        y += 20;
        doc.font(BODY_FONT).fontSize(8.5).fillColor(MUTED);
        for (const noteLine of noteLines) {
          if (y + 14 > PAGE_HEIGHT - 106) {
            doc.addPage();
            drawPageHeader(doc, snapshot, false);
            y = 120;
            doc.font(BOLD_FONT).fontSize(9).fillColor(INK)
              .text("Notes (continued)", MARGIN, y, { lineBreak: false });
            y += 20;
          }
          doc.font(BODY_FONT).fontSize(8.5).fillColor(MUTED)
            .text(noteLine, MARGIN, y, { lineBreak: false });
          y += 13;
        }
      }
      // Footer on every page: clearer than a receipt-like tax summary.
      const pageRange = doc.bufferedPageRange();
      for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
        doc.switchToPage(index);
        doc.moveTo(MARGIN, PAGE_HEIGHT - 85).lineTo(MARGIN + CONTENT, PAGE_HEIGHT - 85)
          .lineWidth(0.5).strokeColor("#d8e0ea").stroke();
        doc.font(BODY_FONT).fontSize(7.5).fillColor(MUTED)
          .text("Purchase order only. Not proof of delivery, receipt or payment.",
            MARGIN, PAGE_HEIGHT - 78, { width: 435, lineBreak: false });
        doc.text("Page " + (index + 1), 498, PAGE_HEIGHT - 78, {
          width: 54, align: "right", lineBreak: false,
        });
      }
      doc.end();
    } catch (error) {
      doc.destroy(error instanceof Error ? error : new Error("PO_PDF_RENDER_FAILED"));
    }
  });
}
