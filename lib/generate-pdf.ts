import jsPDF from "jspdf";

interface GenerateEstimatePdfOptions {
  businessName?: string;
  logoUrl?: string | null;
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1");
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
}

export async function generateEstimatePDF(
  title: string,
  summary: string,
  options: GenerateEstimatePdfOptions = {}
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = 210;
  const pageH = 297;
  const ml = 20;
  const mr = 20;
  const mt = 22;
  const mb = 28;
  const cw = pageW - ml - mr;

  let y = mt;

  function checkBreak(needed: number): void {
    if (y + needed > pageH - mb) {
      doc.addPage();
      y = mt;
    }
  }

  const businessName = options.businessName?.trim() || "TradePulse";
  const logoDataUrl = options.logoUrl ? await loadImageAsDataUrl(options.logoUrl) : null;
  const headerTop = y;
  let textStartX = ml;

  if (logoDataUrl) {
    const logoW = 16;
    const logoH = 16;
    doc.addImage(logoDataUrl, imageFormatFromDataUrl(logoDataUrl), ml, headerTop - 3, logoW, logoH);
    textStartX = ml + logoW + 5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(businessName, textStartX, headerTop + 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(176, 111, 22);
  doc.text("ESTIMATE", textStartX, headerTop + 8.5);

  y = headerTop + 16;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(ml, y, pageW - mr, y);
  y += 9;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 15, 15);
  const titleLines = doc.splitTextToSize(title, cw);
  doc.text(titleLines, ml, y);
  y += titleLines.length * 7.5 + 6;

  const lines = summary.split("\n");
  let tableRows: string[][] = [];

  function flushTable(): void {
    if (tableRows.length === 0) return;

    const rowH = 7;
    const padX = 3;
    const col1W = cw * 0.72;
    const col2W = cw * 0.28;
    const isMultiCol = tableRows.some((r) => r.length > 2);
    const colCount = Math.max(...tableRows.map((r) => r.length));
    const eqColW = cw / colCount;

    tableRows.forEach((row, ri) => {
      checkBreak(rowH + 2);

      const rowY = y;

      if (ri === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(ml, rowY - 5, cw, rowH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(80, 80, 80);
      } else {
        doc.setDrawColor(235, 235, 235);
        doc.setLineWidth(0.2);
        doc.line(ml, rowY - 5, ml + cw, rowY - 5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(25, 25, 25);
      }

      if (!isMultiCol && colCount === 2) {
        const c1 = stripInline(row[0] ?? "");
        const c2 = stripInline(row[1] ?? "");
        const c1Lines = doc.splitTextToSize(c1, col1W - padX * 2);
        doc.text(c1Lines, ml + padX, rowY);
        doc.text(c2, ml + cw - padX, rowY, { align: "right" });
        const lineH = Math.max(c1Lines.length, 1) * (rowH - 1);
        y += lineH > rowH ? lineH : rowH;
      } else {
        row.forEach((cell, ci) => {
          const cellText = doc.splitTextToSize(stripInline(cell), eqColW - padX * 2);
          doc.text(cellText, ml + ci * eqColW + padX, rowY);
        });
        y += rowH;
      }
    });

    y += 5;
    tableRows = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|")) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
      const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      tableRows.push(cells);
      continue;
    }
    if (tableRows.length > 0) flushTable();

    if (/^#\s/.test(trimmed)) continue;

    if (/^##\s/.test(trimmed)) {
      y += 4;
      checkBreak(10);
      const text = trimmed.replace(/^##\s+/, "").toUpperCase();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 100, 100);
      const h2Lines = doc.splitTextToSize(text, cw);
      doc.text(h2Lines, ml, y);
      y += h2Lines.length * 5 + 2;
      continue;
    }

    if (/^###\s/.test(trimmed)) {
      y += 2;
      checkBreak(8);
      const text = stripInline(trimmed.replace(/^###\s+/, ""));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20, 20, 20);
      const h3Lines = doc.splitTextToSize(text, cw);
      doc.text(h3Lines, ml, y);
      y += h3Lines.length * 5.5 + 2;
      continue;
    }

    if (/^[-*]{3,}$/.test(trimmed)) {
      y += 3;
      checkBreak(6);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(ml, y, pageW - mr, y);
      y += 5;
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      const text = stripInline(trimmed.replace(/^[-*]\s+/, ""));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(25, 25, 25);
      const bulletLines = doc.splitTextToSize(text, cw - 8);
      checkBreak(bulletLines.length * 5.2 + 1);
      doc.text("•", ml + 2, y);
      doc.text(bulletLines, ml + 7, y);
      y += bulletLines.length * 5.2 + 1;
      continue;
    }

    if (trimmed === "") {
      y += 2;
      continue;
    }

    const text = stripInline(trimmed);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(25, 25, 25);
    const pLines = doc.splitTextToSize(text, cw);
    checkBreak(pLines.length * 5.2 + 1);
    doc.text(pLines, ml, y);
    y += pLines.length * 5.2 + 2;
  }

  if (tableRows.length > 0) flushTable();

  const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(190, 190, 190);
    doc.text(`Generated by ${businessName}`, ml, pageH - 12);
    if (totalPages > 1) {
      doc.text(`${i} / ${totalPages}`, pageW - mr, pageH - 12, {
        align: "right",
      });
    }
  }

  const filename =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-") + ".pdf";

  doc.save(filename);
}
