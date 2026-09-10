import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  estimateCompanyName,
  preparedByLabel,
} from "../../lib/estimate-identity";
import { CompanyEstimateHeader } from "../../app/components/company-estimate-header";

const root = path.resolve(__dirname, "../..");

test("logo and company name remain visible when the preference is on", () => {
  expect(
    estimateCompanyName({
      businessName: "Circuit & Co Electrical",
      logoUrl: "https://example.com/logo.png",
      showCompanyNameBelowLogo: true,
    })
  ).toBe("Circuit & Co Electrical");

  expect(
    estimateCompanyName({
      businessName: "Circuit & Co Electrical",
      logoUrl: "https://example.com/logo.png",
    })
  ).toBe("Circuit & Co Electrical");
});

test("logo can suppress only the separate company-name text", () => {
  expect(
    estimateCompanyName({
      businessName: "Circuit & Co Electrical",
      logoUrl: "https://example.com/logo.png",
      showCompanyNameBelowLogo: false,
    })
  ).toBe("");
});

test("company name remains visible without a logo regardless of the preference", () => {
  expect(
    estimateCompanyName({
      businessName: "Circuit & Co Electrical",
      logoUrl: null,
      showCompanyNameBelowLogo: false,
    })
  ).toBe("Circuit & Co Electrical");
});

test("the estimate header keeps the logo while toggling only its name line", () => {
  type ElementShape = { props: { children: unknown[] } };

  const visible = CompanyEstimateHeader({
    logoUrl: "https://example.com/logo.png",
    businessName: "Circuit & Co Electrical",
    showCompanyNameBelowLogo: true,
  }) as unknown as ElementShape;
  const hidden = CompanyEstimateHeader({
    logoUrl: "https://example.com/logo.png",
    businessName: "Circuit & Co Electrical",
    showCompanyNameBelowLogo: false,
  }) as unknown as ElementShape;
  const noLogo = CompanyEstimateHeader({
    logoUrl: null,
    businessName: "Circuit & Co Electrical",
    showCompanyNameBelowLogo: false,
  }) as unknown as ElementShape;

  expect(visible.props.children[0]).toBeTruthy();
  expect(visible.props.children[1]).toBeTruthy();
  expect(hidden.props.children[0]).toBeTruthy();
  expect(hidden.props.children[1]).toBeFalsy();
  expect(noLogo.props.children[0]).toBeFalsy();
  expect(noLogo.props.children[1]).toBeTruthy();
});

test("Prepared by is labelled only when a profile name exists", () => {
  expect(preparedByLabel("Greg")).toBe("Prepared by Greg");
  expect(preparedByLabel("  Greg  ")).toBe("Prepared by Greg");
  expect(preparedByLabel(" ")).toBe("");
  expect(preparedByLabel(null)).toBe("");
});

test("estimate, share, and PDF use the shared identity behaviour", () => {
  const companyHeader = readFileSync(
    path.join(root, "app/components/company-estimate-header.tsx"),
    "utf8"
  );
  const customerDetails = readFileSync(
    path.join(root, "app/components/customer-details-block.tsx"),
    "utf8"
  );
  const sharePage = readFileSync(path.join(root, "app/share/[id]/page.tsx"), "utf8");
  const estimatePage = readFileSync(path.join(root, "app/estimates/[id]/page.tsx"), "utf8");
  const newEstimatePage = readFileSync(path.join(root, "app/new/page.tsx"), "utf8");
  const pdf = readFileSync(path.join(root, "lib/generate-pdf.ts"), "utf8");

  expect(companyHeader).toContain("estimateCompanyName");
  expect(customerDetails).not.toContain("preparedByLabel");
  expect(sharePage).toContain("preparedByLabel");
  expect(sharePage).toContain("showCompanyNameBelowLogo={showCompanyNameBelowLogo}");
  expect(estimatePage).toContain("showCompanyNameBelowLogo={showCompanyNameBelowLogo}");
  expect(newEstimatePage).toContain("showCompanyNameBelowLogo={showCompanyNameBelowLogo}");
  expect(pdf).toContain("estimateCompanyName");
  expect(pdf).toContain("preparedByLabel");
});

test("email identity still comes from the stored company name", () => {
  const emailRoute = readFileSync(path.join(root, "app/api/send-email/route.ts"), "utf8");

  expect(emailRoute).toContain('const businessName = business?.name?.trim() ?? "";');
  expect(emailRoute).toContain("Your estimate from ${businessName}");
  expect(emailRoute).not.toContain("show_company_name_below_logo");
});

test("the Profile checkbox persists independently with an on-by-default schema", () => {
  const profileForm = readFileSync(path.join(root, "app/components/profile-form.tsx"), "utf8");
  const profileRoute = readFileSync(path.join(root, "app/api/profile/route.ts"), "utf8");
  const migration = readFileSync(
    path.join(
      root,
      "supabase/migrations/20260910074638_add_show_company_name_below_logo.sql"
    ),
    "utf8"
  );

  expect(profileForm).toContain("Show company name below logo");
  expect(profileForm).toContain("show_company_name_below_logo: showCompanyNameBelowLogo");
  expect(profileRoute).toContain("typeof body.show_company_name_below_logo === \"boolean\"");
  expect(migration).toContain(
    "show_company_name_below_logo boolean not null default true"
  );
});
