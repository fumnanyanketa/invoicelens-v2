/**
 * InvoiceLens v2 - Mock invoice PDF generator
 *
 * Generates 30 synthetic invoice PDFs in lib/mock-invoices/.
 * Designed to exercise every triage lane in the demo:
 *   18 GREEN (clean invoices, known vendors)
 *    8 AMBER (typos, unknown vendors, partial data)
 *    4 RED   (sanctions hit, duplicate, malformed, low confidence)
 *
 * Run with: npx tsx scripts/generate-mock-invoices.ts
 *
 * The script is idempotent: re-running overwrites the existing files.
 */

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "lib", "mock-invoices");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Invoice template - the data shape every mock invoice follows.
 * Mirrors what Claude Haiku will be asked to extract in Stage 7.
 */
interface InvoiceTemplate {
  filename: string;
  // Lane this invoice is designed to land in (for our reference, not in the PDF)
  designedLane: "GREEN" | "AMBER" | "RED";
  // Why this invoice is in this lane
  designedReason: string;

  // Vendor block
  vendorName: string;
  vendorEmail: string;
  vendorAddress: string;
  vendorYTunnus: string;

  // Buyer block (always Saaristo Logistics)
  // Hardcoded below in renderPdf

  // Invoice meta
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;

  // Line items
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;

  // VAT
  vatRate: number; // e.g. 25.5 for Finnish standard VAT in 2026
  vatCode: string; // e.g. "ALV 25.5%"

  // Optional flags for special cases
  malformed?: boolean; // if true, intentionally corrupt the PDF
}

/**
 * The 30 invoice templates. Order doesn't matter; designedLane is what counts.
 */
const invoices: InvoiceTemplate[] = [
  // ===========================================================================
  // GREEN LANE - 18 clean invoices from known vendors
  // ===========================================================================
  {
    filename: "INV-001-neste.pdf",
    designedLane: "GREEN",
    designedReason: "Clean fuel invoice from known vendor",
    vendorName: "Neste Markkinointi Oy",
    vendorEmail: "laskutus@neste.fi",
    vendorAddress: "Keilaranta 21, 02150 Espoo, Finland",
    vendorYTunnus: "1853571-1",
    invoiceNumber: "NM-2026-04-1182",
    invoiceDate: "2026-04-15",
    dueDate: "2026-05-15",
    lineItems: [
      { description: "Diesel fuel, fleet card transactions April 2026", quantity: 1, unitPrice: 4218.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-002-neste.pdf",
    designedLane: "GREEN",
    designedReason: "Second clean Neste invoice",
    vendorName: "Neste Markkinointi Oy",
    vendorEmail: "laskutus@neste.fi",
    vendorAddress: "Keilaranta 21, 02150 Espoo, Finland",
    vendorYTunnus: "1853571-1",
    invoiceNumber: "NM-2026-04-1247",
    invoiceDate: "2026-04-22",
    dueDate: "2026-05-22",
    lineItems: [
      { description: "Diesel fuel, fleet card transactions April 2026 (week 17)", quantity: 1, unitPrice: 3187.4 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-003-turun.pdf",
    designedLane: "GREEN",
    designedReason: "Routine truck repair from regular workshop",
    vendorName: "Turun Konekorjaamo Oy",
    vendorEmail: "myynti@turunkonekorjaamo.fi",
    vendorAddress: "Pansiontie 14, 20240 Turku, Finland",
    vendorYTunnus: "2486194-3",
    invoiceNumber: "TKK-26-04-0341",
    invoiceDate: "2026-04-18",
    dueDate: "2026-05-18",
    lineItems: [
      { description: "Brake pad replacement, Volvo FH16 (reg. ABC-123)", quantity: 1, unitPrice: 412.0 },
      { description: "Labour, 3 hrs", quantity: 3, unitPrice: 85.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-004-dna.pdf",
    designedLane: "GREEN",
    designedReason: "Routine telecoms subscription",
    vendorName: "DNA Business Oyj",
    vendorEmail: "yritysasiakkaat@dna.fi",
    vendorAddress: "Lansisatamankatu 13, 00180 Helsinki, Finland",
    vendorYTunnus: "0592509-6",
    invoiceNumber: "DNA-2026-04-9981",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-30",
    lineItems: [
      { description: "Mobile data plans, 47 lines, April 2026", quantity: 47, unitPrice: 24.9 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-005-posti.pdf",
    designedLane: "GREEN",
    designedReason: "Standard postage charge",
    vendorName: "Posti Group Oyj",
    vendorEmail: "laskutus@posti.fi",
    vendorAddress: "Postintaival 7A, 00230 Helsinki, Finland",
    vendorYTunnus: "1531864-4",
    invoiceNumber: "POSTI-2026-04-12774",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-14",
    lineItems: [
      { description: "Parcel postage, April 2026", quantity: 1, unitPrice: 487.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-006-microsoft.pdf",
    designedLane: "GREEN",
    designedReason: "Recurring Microsoft 365 subscription, IE vendor with valid VAT reverse charge",
    vendorName: "Microsoft Ireland Operations Ltd",
    vendorEmail: "billing@microsoft.com",
    vendorAddress: "One Microsoft Place, South County Business Park, Leopardstown, Dublin 18, Ireland",
    vendorYTunnus: "IE8256796U",
    invoiceNumber: "MS-INV-7728341",
    invoiceDate: "2026-05-01",
    dueDate: "2026-05-31",
    lineItems: [
      { description: "Microsoft 365 Business Standard, 180 seats", quantity: 180, unitPrice: 11.7 },
    ],
    vatRate: 0,
    vatCode: "ALV 0% (kaanteinen verovelvollisuus)",
  },
  {
    filename: "INV-007-tallink.pdf",
    designedLane: "GREEN",
    designedReason: "Travel expense, ferry crossing",
    vendorName: "Tallink Silja Oy",
    vendorEmail: "yritysmyynti@tallinksilja.com",
    vendorAddress: "Erottajankatu 19, 00130 Helsinki, Finland",
    vendorYTunnus: "1797667-3",
    invoiceNumber: "TS-2026-04-5523",
    invoiceDate: "2026-04-28",
    dueDate: "2026-05-28",
    lineItems: [
      { description: "Helsinki-Tallinn cargo crossing, 3 trailers", quantity: 3, unitPrice: 248.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-008-helsingin.pdf",
    designedLane: "GREEN",
    designedReason: "Routine workshop supply",
    vendorName: "Helsingin Saksitehdas Oy",
    vendorEmail: "myynti@helsinginsaksitehdas.fi",
    vendorAddress: "Tiilenlyojankatu 4, 00880 Helsinki, Finland",
    vendorYTunnus: "2913847-5",
    invoiceNumber: "HS-2026-04-0817",
    invoiceDate: "2026-04-20",
    dueDate: "2026-05-20",
    lineItems: [
      { description: "Industrial lubricant, 200L barrel", quantity: 1, unitPrice: 489.0 },
      { description: "Cutting fluid concentrate, 25L", quantity: 4, unitPrice: 78.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-009-neste.pdf",
    designedLane: "GREEN",
    designedReason: "Third Neste invoice - high frequency vendor",
    vendorName: "Neste Markkinointi Oy",
    vendorEmail: "laskutus@neste.fi",
    vendorAddress: "Keilaranta 21, 02150 Espoo, Finland",
    vendorYTunnus: "1853571-1",
    invoiceNumber: "NM-2026-04-1318",
    invoiceDate: "2026-04-29",
    dueDate: "2026-05-29",
    lineItems: [
      { description: "Diesel fuel, fleet card transactions April 2026 (week 18)", quantity: 1, unitPrice: 3892.7 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-010-turun.pdf",
    designedLane: "GREEN",
    designedReason: "Routine maintenance",
    vendorName: "Turun Konekorjaamo Oy",
    vendorEmail: "myynti@turunkonekorjaamo.fi",
    vendorAddress: "Pansiontie 14, 20240 Turku, Finland",
    vendorYTunnus: "2486194-3",
    invoiceNumber: "TKK-26-04-0388",
    invoiceDate: "2026-04-25",
    dueDate: "2026-05-25",
    lineItems: [
      { description: "Annual safety inspection, Scania R500 (reg. DEF-456)", quantity: 1, unitPrice: 285.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-011-posti.pdf",
    designedLane: "GREEN",
    designedReason: "Routine postage",
    vendorName: "Posti Group Oyj",
    vendorEmail: "laskutus@posti.fi",
    vendorAddress: "Postintaival 7A, 00230 Helsinki, Finland",
    vendorYTunnus: "1531864-4",
    invoiceNumber: "POSTI-2026-04-12891",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-14",
    lineItems: [
      { description: "Parcel postage, April 2026 (settlement adjustment)", quantity: 1, unitPrice: 124.8 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-012-helsingin.pdf",
    designedLane: "GREEN",
    designedReason: "Routine workshop supply",
    vendorName: "Helsingin Saksitehdas Oy",
    vendorEmail: "myynti@helsinginsaksitehdas.fi",
    vendorAddress: "Tiilenlyojankatu 4, 00880 Helsinki, Finland",
    vendorYTunnus: "2913847-5",
    invoiceNumber: "HS-2026-04-0892",
    invoiceDate: "2026-04-26",
    dueDate: "2026-05-26",
    lineItems: [
      { description: "Hydraulic hose assembly, 12mm x 4m", quantity: 6, unitPrice: 47.2 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-013-dna.pdf",
    designedLane: "GREEN",
    designedReason: "Routine fixed-line subscription",
    vendorName: "DNA Business Oyj",
    vendorEmail: "yritysasiakkaat@dna.fi",
    vendorAddress: "Lansisatamankatu 13, 00180 Helsinki, Finland",
    vendorYTunnus: "0592509-6",
    invoiceNumber: "DNA-2026-04-10018",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-30",
    lineItems: [
      { description: "Office fixed-line and broadband, April 2026", quantity: 1, unitPrice: 189.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-014-turun.pdf",
    designedLane: "GREEN",
    designedReason: "Routine repair",
    vendorName: "Turun Konekorjaamo Oy",
    vendorEmail: "myynti@turunkonekorjaamo.fi",
    vendorAddress: "Pansiontie 14, 20240 Turku, Finland",
    vendorYTunnus: "2486194-3",
    invoiceNumber: "TKK-26-04-0412",
    invoiceDate: "2026-04-27",
    dueDate: "2026-05-27",
    lineItems: [
      { description: "Tyre replacement, 4 x 315/80R22.5", quantity: 4, unitPrice: 287.0 },
      { description: "Labour, 1.5 hrs", quantity: 1.5, unitPrice: 85.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-015-tallink.pdf",
    designedLane: "GREEN",
    designedReason: "Travel expense",
    vendorName: "Tallink Silja Oy",
    vendorEmail: "yritysmyynti@tallinksilja.com",
    vendorAddress: "Erottajankatu 19, 00130 Helsinki, Finland",
    vendorYTunnus: "1797667-3",
    invoiceNumber: "TS-2026-04-5604",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-30",
    lineItems: [
      { description: "Helsinki-Tallinn cargo crossing, 2 trailers", quantity: 2, unitPrice: 248.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-016-helsingin.pdf",
    designedLane: "GREEN",
    designedReason: "Routine supply",
    vendorName: "Helsingin Saksitehdas Oy",
    vendorEmail: "myynti@helsinginsaksitehdas.fi",
    vendorAddress: "Tiilenlyojankatu 4, 00880 Helsinki, Finland",
    vendorYTunnus: "2913847-5",
    invoiceNumber: "HS-2026-04-0918",
    invoiceDate: "2026-04-28",
    dueDate: "2026-05-28",
    lineItems: [
      { description: "Wheel bearing kit, heavy duty", quantity: 8, unitPrice: 92.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-017-microsoft.pdf",
    designedLane: "GREEN",
    designedReason: "Routine M365 add-on",
    vendorName: "Microsoft Ireland Operations Ltd",
    vendorEmail: "billing@microsoft.com",
    vendorAddress: "One Microsoft Place, South County Business Park, Leopardstown, Dublin 18, Ireland",
    vendorYTunnus: "IE8256796U",
    invoiceNumber: "MS-INV-7728502",
    invoiceDate: "2026-05-01",
    dueDate: "2026-05-31",
    lineItems: [
      { description: "Microsoft 365 Power BI Pro, 12 seats", quantity: 12, unitPrice: 9.4 },
    ],
    vatRate: 0,
    vatCode: "ALV 0% (kaanteinen verovelvollisuus)",
  },
  {
    filename: "INV-018-posti.pdf",
    designedLane: "GREEN",
    designedReason: "Routine freight",
    vendorName: "Posti Group Oyj",
    vendorEmail: "laskutus@posti.fi",
    vendorAddress: "Postintaival 7A, 00230 Helsinki, Finland",
    vendorYTunnus: "1531864-4",
    invoiceNumber: "POSTI-2026-04-13002",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-14",
    lineItems: [
      { description: "Express freight, 14 shipments April 2026", quantity: 14, unitPrice: 38.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },

  // ===========================================================================
  // AMBER LANE - 8 invoices that need human review
  // ===========================================================================
  {
    filename: "INV-019-neste-typo.pdf",
    designedLane: "AMBER",
    designedReason: "Vendor name has typo: 'Neste Markinointi' instead of 'Neste Markkinointi'",
    vendorName: "Neste Markinointi Oy",
    vendorEmail: "laskutus@neste.fi",
    vendorAddress: "Keilaranta 21, 02150 Espoo, Finland",
    vendorYTunnus: "1853571-1",
    invoiceNumber: "NM-2026-04-1402",
    invoiceDate: "2026-04-29",
    dueDate: "2026-05-29",
    lineItems: [
      { description: "Diesel fuel, fleet card transactions late April", quantity: 1, unitPrice: 2987.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-020-unknown-vendor.pdf",
    designedLane: "AMBER",
    designedReason: "Vendor not in master: Saaristo Catering Oy (first-time supplier)",
    vendorName: "Saaristo Catering Oy",
    vendorEmail: "laskut@saaristocatering.fi",
    vendorAddress: "Linnankatu 18, 20100 Turku, Finland",
    vendorYTunnus: "3204871-2",
    invoiceNumber: "SC-2026-04-0029",
    invoiceDate: "2026-04-25",
    dueDate: "2026-05-09",
    lineItems: [
      { description: "Lunch catering, 180 staff, all-staff Q2 kickoff event", quantity: 180, unitPrice: 18.5 },
    ],
    vatRate: 14,
    vatCode: "ALV 14%",
  },
  {
    filename: "INV-021-amount-anomaly.pdf",
    designedLane: "AMBER",
    designedReason: "Amount 3.5x higher than typical for this vendor",
    vendorName: "Posti Group Oyj",
    vendorEmail: "laskutus@posti.fi",
    vendorAddress: "Postintaival 7A, 00230 Helsinki, Finland",
    vendorYTunnus: "1531864-4",
    invoiceNumber: "POSTI-2026-04-13145",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-14",
    lineItems: [
      { description: "Bulk customer mailing, marketing campaign", quantity: 14000, unitPrice: 0.62 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-022-konekorjaamo-variant.pdf",
    designedLane: "AMBER",
    designedReason: "Vendor uses name variant 'Turun Konepaja' instead of 'Turun Konekorjaamo'",
    vendorName: "Turun Konepaja Oy",
    vendorEmail: "myynti@turunkonekorjaamo.fi",
    vendorAddress: "Pansiontie 14, 20240 Turku, Finland",
    vendorYTunnus: "2486194-3",
    invoiceNumber: "TKK-26-04-0445",
    invoiceDate: "2026-04-29",
    dueDate: "2026-05-29",
    lineItems: [
      { description: "Engine oil change, full synthetic", quantity: 1, unitPrice: 312.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-023-no-ytunnus.pdf",
    designedLane: "AMBER",
    designedReason: "Y-tunnus missing from invoice",
    vendorName: "Aurinko Kahvila Oy",
    vendorEmail: "info@aurinkokahvila.fi",
    vendorAddress: "Ratapihankatu 22, 20100 Turku, Finland",
    vendorYTunnus: "",
    invoiceNumber: "AK-0418",
    invoiceDate: "2026-04-22",
    dueDate: "2026-05-06",
    lineItems: [
      { description: "Coffee service, board meeting catering", quantity: 1, unitPrice: 247.5 },
    ],
    vatRate: 14,
    vatCode: "ALV 14%",
  },
  {
    filename: "INV-024-helsingin-variant.pdf",
    designedLane: "AMBER",
    designedReason: "Short-form vendor name 'HS Oy' requires fuzzy match",
    vendorName: "HS Oy",
    vendorEmail: "myynti@helsinginsaksitehdas.fi",
    vendorAddress: "Tiilenlyojankatu 4, 00880 Helsinki, Finland",
    vendorYTunnus: "2913847-5",
    invoiceNumber: "HS-2026-04-0945",
    invoiceDate: "2026-04-29",
    dueDate: "2026-05-29",
    lineItems: [
      { description: "Replacement air filter, set of 12", quantity: 12, unitPrice: 18.4 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-025-unusual-currency.pdf",
    designedLane: "AMBER",
    designedReason: "Foreign vendor billing in USD (uncommon for Saaristo)",
    vendorName: "Atlantic Marine Spares LLC",
    vendorEmail: "billing@atlanticmarinespares.com",
    vendorAddress: "200 Harborfront Plaza, Newport, RI 02840, USA",
    vendorYTunnus: "US04-3829471",
    invoiceNumber: "AMS-INV-2026-2841",
    invoiceDate: "2026-04-23",
    dueDate: "2026-05-23",
    lineItems: [
      { description: "Specialised marine bearing, custom order", quantity: 1, unitPrice: 1875.0 },
    ],
    vatRate: 0,
    vatCode: "ALV 0% (export)",
  },
  {
    filename: "INV-026-partial-data.pdf",
    designedLane: "AMBER",
    designedReason: "Invoice number and date present but due date missing",
    vendorName: "Tallink Silja Oy",
    vendorEmail: "yritysmyynti@tallinksilja.com",
    vendorAddress: "Erottajankatu 19, 00130 Helsinki, Finland",
    vendorYTunnus: "1797667-3",
    invoiceNumber: "TS-2026-04-5731",
    invoiceDate: "2026-04-30",
    dueDate: "",
    lineItems: [
      { description: "Helsinki-Tallinn passenger crossing, 6 staff", quantity: 6, unitPrice: 89.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },

  // ===========================================================================
  // RED LANE - 4 invoices that should block
  // ===========================================================================
  {
    filename: "INV-027-karelia-sanctions.pdf",
    designedLane: "RED",
    designedReason: "Sanctioned vendor: Karelia Logistics Holding Ltd",
    vendorName: "Karelia Logistics Holding Ltd",
    vendorEmail: "accounts@karelialogistics.ru",
    vendorAddress: "Lenina prospekt 12, Petrozavodsk, Republic of Karelia, 185000, Russia",
    vendorYTunnus: "7714039284",
    invoiceNumber: "KLH-2026-0418",
    invoiceDate: "2026-04-26",
    dueDate: "2026-05-26",
    lineItems: [
      { description: "Subcontracted freight haulage, FI-RU corridor, March 2026", quantity: 1, unitPrice: 8742.0 },
    ],
    vatRate: 0,
    vatCode: "ALV 0% (kaanteinen verovelvollisuus)",
  },
  {
    filename: "INV-028-duplicate.pdf",
    designedLane: "RED",
    designedReason: "Exact duplicate of INV-001-neste (same invoice number, same amount)",
    vendorName: "Neste Markkinointi Oy",
    vendorEmail: "laskutus@neste.fi",
    vendorAddress: "Keilaranta 21, 02150 Espoo, Finland",
    vendorYTunnus: "1853571-1",
    invoiceNumber: "NM-2026-04-1182",
    invoiceDate: "2026-04-15",
    dueDate: "2026-05-15",
    lineItems: [
      { description: "Diesel fuel, fleet card transactions April 2026", quantity: 1, unitPrice: 4218.5 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
  {
    filename: "INV-029-malformed.pdf",
    designedLane: "RED",
    designedReason: "Intentionally corrupt PDF that extraction will fail on",
    vendorName: "(unparseable)",
    vendorEmail: "",
    vendorAddress: "",
    vendorYTunnus: "",
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    lineItems: [],
    vatRate: 0,
    vatCode: "",
    malformed: true,
  },
  {
    filename: "INV-030-extreme-amount.pdf",
    designedLane: "RED",
    designedReason: "Amount of EUR 482,150 - far above any normal Saaristo invoice",
    vendorName: "Premium Heavy Logistics Oy",
    vendorEmail: "billing@premiumheavy.fi",
    vendorAddress: "Satamatie 8, 65100 Vaasa, Finland",
    vendorYTunnus: "3148209-7",
    invoiceNumber: "PHL-2026-04-0001",
    invoiceDate: "2026-04-30",
    dueDate: "2026-05-14",
    lineItems: [
      { description: "Mobilisation fee, special-equipment haulage contract Q2-Q4 2026", quantity: 1, unitPrice: 482150.0 },
    ],
    vatRate: 25.5,
    vatCode: "ALV 25.5%",
  },
];

/**
 * Buyer block - hardcoded since every invoice is sent TO Saaristo Logistics.
 */
const BUYER = {
  name: "Saaristo Logistics Oy",
  address: "Linnankatu 14, 20100 Turku, Finland",
  yTunnus: "2987145-1",
  email: "laskut@saaristo.fi",
};

/**
 * Render a single invoice PDF to disk.
 * For malformed invoices, write a corrupt file that pdf parsers will reject.
 */
function renderPdf(template: InvoiceTemplate): void {
  const outputPath = path.join(OUTPUT_DIR, template.filename);

  // Special case: malformed PDF
  if (template.malformed) {
    // Write a file with a PDF header but corrupt body
    // Real PDF parsers will reject this with a parse error
    const corruptContent = "%PDF-1.4\n%corrupt-malformed-content-for-testing\n";
    fs.writeFileSync(outputPath, corruptContent);
    return;
  }

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // Header
  doc.fontSize(20).font("Helvetica-Bold").text("INVOICE", { align: "right" });
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica").text(`Invoice #: ${template.invoiceNumber}`, { align: "right" });
  doc.text(`Issue date: ${template.invoiceDate}`, { align: "right" });
  if (template.dueDate) {
    doc.text(`Due date: ${template.dueDate}`, { align: "right" });
  }

  doc.moveDown(2);

  // Vendor block (FROM)
  doc.fontSize(9).font("Helvetica-Bold").text("FROM");
  doc.font("Helvetica").fontSize(11).text(template.vendorName);
  doc.fontSize(9).text(template.vendorAddress);
  if (template.vendorYTunnus) {
    doc.text(`Y-tunnus / VAT: ${template.vendorYTunnus}`);
  }
  doc.text(template.vendorEmail);

  doc.moveDown(1.5);

  // Buyer block (TO)
  doc.fontSize(9).font("Helvetica-Bold").text("TO");
  doc.font("Helvetica").fontSize(11).text(BUYER.name);
  doc.fontSize(9).text(BUYER.address);
  doc.text(`Y-tunnus: ${BUYER.yTunnus}`);
  doc.text(BUYER.email);

  doc.moveDown(2);

  // Line items table header
  const tableTop = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Description", 50, tableTop);
  doc.text("Qty", 350, tableTop, { width: 50, align: "right" });
  doc.text("Unit price", 400, tableTop, { width: 70, align: "right" });
  doc.text("Total", 470, tableTop, { width: 75, align: "right" });
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

  // Line items rows
  let lineY = tableTop + 22;
  let netTotal = 0;
  doc.font("Helvetica");

  for (const item of template.lineItems) {
    const lineTotal = item.quantity * item.unitPrice;
    netTotal += lineTotal;

    doc.text(item.description, 50, lineY, { width: 290 });
    doc.text(item.quantity.toString(), 350, lineY, { width: 50, align: "right" });
    doc.text(item.unitPrice.toFixed(2), 400, lineY, { width: 70, align: "right" });
    doc.text(lineTotal.toFixed(2), 470, lineY, { width: 75, align: "right" });
    lineY += 20;
  }

  // Totals
  const vatAmount = (netTotal * template.vatRate) / 100;
  const grossTotal = netTotal + vatAmount;

  doc.moveTo(350, lineY + 5).lineTo(545, lineY + 5).stroke();
  lineY += 12;

  doc.font("Helvetica").fontSize(9);
  doc.text("Net total:", 350, lineY, { width: 120, align: "right" });
  doc.text(`${netTotal.toFixed(2)} EUR`, 470, lineY, { width: 75, align: "right" });
  lineY += 15;

  doc.text(`VAT (${template.vatCode}):`, 350, lineY, { width: 120, align: "right" });
  doc.text(`${vatAmount.toFixed(2)} EUR`, 470, lineY, { width: 75, align: "right" });
  lineY += 15;

  doc.font("Helvetica-Bold");
  doc.text("Gross total:", 350, lineY, { width: 120, align: "right" });
  doc.text(`${grossTotal.toFixed(2)} EUR`, 470, lineY, { width: 75, align: "right" });

  // Payment terms footer
  doc.moveDown(4);
  doc.fontSize(8).font("Helvetica");
  if (template.dueDate) {
    doc.text(`Payment due: ${template.dueDate}. Bank transfer to IBAN on file.`, 50, doc.y);
  }
  doc.text("Thank you for your business.", 50, doc.y + 10);

  doc.end();
}

/**
 * Main entry point. Generate all 30 invoices, log lane distribution.
 */
function main(): void {
  console.log(`Generating ${invoices.length} mock invoices to ${OUTPUT_DIR}\n`);

  const laneCounts = { GREEN: 0, AMBER: 0, RED: 0 };

  for (const template of invoices) {
    renderPdf(template);
    laneCounts[template.designedLane]++;
    console.log(`  [${template.designedLane}] ${template.filename} - ${template.designedReason}`);
  }

  console.log(`\nGenerated ${invoices.length} invoices:`);
  console.log(`  GREEN lane: ${laneCounts.GREEN}`);
  console.log(`  AMBER lane: ${laneCounts.AMBER}`);
  console.log(`  RED lane:   ${laneCounts.RED}`);
}

main();