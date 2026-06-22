interface QuoteTemplate {
  title: string;
  scope: string;
  lineItems: string[];
  assumptions: string[];
}

const TEMPLATES: { keywords: RegExp; template: QuoteTemplate }[] = [
  {
    keywords: /toilet|wc|replace toilet|toilet needs replacing|install toilet/i,
    template: {
      title: "Toilet replacement estimate",
      scope:
        "Remove the existing toilet, prepare the flange area, install the replacement toilet, connect the water supply, test for leaks and proper flushing, and clean the work area.",
      lineItems: [
        "Remove existing toilet",
        "Install replacement toilet",
        "Basic installation materials: wax ring, bolts, supply line as needed",
        "Haul away/disposal of old toilet",
        "Test toilet operation and clean work area",
      ],
      assumptions: [
        "Pricing may change if the flange, shutoff valve, flooring, or drain connection requires repair.",
        "Toilet supply cost should be confirmed if the contractor is supplying the fixture.",
      ],
    },
  },
  {
    keywords: /water heater|hot water tank|no hot water|tank/i,
    template: {
      title: "Water heater service estimate",
      scope:
        "Inspect the water heater issue, identify repair or replacement requirements, complete approved work, and test operation.",
      lineItems: [
        "Inspect water heater issue",
        "Repair or replacement labour",
        "Parts/materials allowance",
        "Test system operation",
        "Cleanup",
      ],
      assumptions: [
        "If replacement is required, a separate quote for the unit and installation will be provided.",
        "Pricing may change based on venting, gas line, or code requirements.",
      ],
    },
  },
  {
    keywords: /faucet|tap|sink fixture|handle|cartridge/i,
    template: {
      title: "Faucet repair estimate",
      scope:
        "Inspect the faucet issue, repair or replace affected components, test operation, and check for leaks.",
      lineItems: [
        "Diagnose faucet issue",
        "Repair or replace cartridge, supply line, or fixture component",
        "Materials allowance",
        "Test faucet operation and check for leaks",
        "Cleanup",
      ],
      assumptions: [
        "If the faucet cannot be repaired, replacement options and pricing will be provided before proceeding.",
        "Customer-supplied fixtures are welcome.",
      ],
    },
  },
  {
    keywords: /clog|clogged|blocked|backup|backing up|slow drain|drain/i,
    template: {
      title: "Drain clearing estimate",
      scope:
        "Diagnose the blocked or slow drain, clear the obstruction where accessible, test drainage, and advise if further inspection is required.",
      lineItems: [
        "Diagnose blocked drain",
        "Clear drain blockage",
        "Test drainage and flow",
        "Cleanup",
        "Optional camera inspection if required",
      ],
      assumptions: [
        "Pricing assumes blockage is accessible without opening walls or floors.",
        "Camera inspection quoted separately if required.",
      ],
    },
  },
  {
    keywords: /leak|leaking|drip|dripping|water under|water damage/i,
    template: {
      title: "Plumbing leak repair estimate",
      scope:
        "Locate the source of the reported leak, complete the required repair, test the repaired area, and clean the work area.",
      lineItems: [
        "Diagnose leak source",
        "Repair leaking pipe, fitting, valve, or fixture connection",
        "Materials allowance",
        "Test repair under normal use",
        "Cleanup",
      ],
      assumptions: [
        "Final pricing subject to on-site assessment of leak severity.",
        "Additional work may be required if concealed damage is found behind walls or under flooring.",
      ],
    },
  },
];

const GENERIC_TEMPLATE: QuoteTemplate = {
  title: "Plumbing service estimate",
  scope:
    "Review the customer's website quote request, confirm the issue on site, complete the approved plumbing work, test the repair, and clean the work area.",
  lineItems: [
    "Diagnose plumbing issue",
    "Complete approved plumbing repair or installation",
    "Materials allowance",
    "Test completed work",
    "Cleanup",
  ],
  assumptions: [
    "Final pricing subject to on-site assessment.",
    "Additional work beyond the original scope will be quoted separately.",
  ],
};

export interface PricebookItem {
  name: string;
  description: string;
  price: number;
}

const STOP_WORDS = new Set(["and", "or", "the", "a", "of", "for", "as", "to", "in", "on", "is", "if", "be", "an", "at", "by"]);

function stem(word: string): string {
  return word
    .replace(/ment$/, "")
    .replace(/tion$/, "")
    .replace(/sion$/, "")
    .replace(/ing$/, "")
    .replace(/ance$/, "")
    .replace(/ence$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ness$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/ful$/, "")
    .replace(/ed$/, "")
    .replace(/er$/, "")
    .replace(/ly$/, "")
    .replace(/al$/, "")
    .replace(/s$/, "");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
}

function findBestMatch(
  templateLabel: string,
  pricebookItems: PricebookItem[],
): PricebookItem | null {
  const templateStems = new Set(tokenize(templateLabel));
  let bestItem: PricebookItem | null = null;
  let bestScore = 0;

  for (const item of pricebookItems) {
    const itemText = [item.name, item.description].filter(Boolean).join(" ");
    const itemStems = tokenize(itemText);
    const uniqueItemStems = new Set(itemStems);
    const overlap = [...uniqueItemStems].filter((s) => templateStems.has(s)).length;
    const minRequired = uniqueItemStems.size <= 2 ? 1 : 2;
    if (overlap >= minRequired && overlap > bestScore) {
      bestScore = overlap;
      bestItem = item;
    }
  }

  return bestItem;
}

export function matchTemplate(description: string): QuoteTemplate {
  const text = description.toLowerCase();
  for (const entry of TEMPLATES) {
    if (entry.keywords.test(text)) {
      return entry.template;
    }
  }
  return GENERIC_TEMPLATE;
}

export function buildDraftSummary(
  template: QuoteTemplate,
  customerDescription: string,
  pricebookItems?: PricebookItem[],
): string {
  const remaining = [...(pricebookItems ?? [])];
  const lineItemRows = template.lineItems
    .map((label) => {
      const match = remaining.length > 0 ? findBestMatch(label, remaining) : null;
      if (match && match.price > 0) {
        const idx = remaining.indexOf(match);
        if (idx !== -1) remaining.splice(idx, 1);
        return `| ${match.name} | $${match.price.toFixed(2)} |`;
      }
      return `| ${label} | — |`;
    })
    .join("\n");

  const assumptionBullets = template.assumptions
    .map((a) => `- ${a}`)
    .join("\n");

  return [
    `Customer request: ${customerDescription}`,
    "",
    `## Scope of Work`,
    "",
    ...template.scope.split(", ").map((s) => {
      const trimmed = s.replace(/^and /, "").replace(/\.$/, "").trim();
      return `- ${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
    }),
    "",
    `## Line Items`,
    "",
    `| Item | Cost |`,
    `|------|------|`,
    lineItemRows,
    "",
    `## Assumptions and Exclusions`,
    "",
    assumptionBullets,
    "",
    `## Pricing Summary`,
    "",
    `| | |`,
    `|---|---|`,
    `| Subtotal | $0 |`,
    `| Tax (GST 5%) | $0 |`,
    `| **Total** | **$0** |`,
    `| No deposit required | |`,
    `| Balance on completion | $0 |`,
    "",
    `## Payment Terms`,
    "",
    `This estimate is valid for 30 days.`,
  ].join("\n");
}
