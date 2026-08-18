import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  runWithEstimateGenerationClaim,
  startWithEstimateGenerationClaim,
} from "../../lib/estimate-generation-claims";

test("does not start Anthropic work when the generation claim cannot be created", async () => {
  let providerStarts = 0;
  let releases = 0;

  const result = await startWithEstimateGenerationClaim({
    claim: async () => null,
    release: async () => {
      releases += 1;
    },
    start: () => {
      providerStarts += 1;
      return "provider-stream";
    },
  });

  expect(result).toBeNull();
  expect(providerStarts).toBe(0);
  expect(releases).toBe(0);
});

test("starts valid work after a claim and releases it after success", async () => {
  const releases: string[] = [];
  const started = await startWithEstimateGenerationClaim({
    claim: async () => "claim-1",
    release: async (claimId) => {
      releases.push(claimId);
    },
    start: () => "provider-stream",
  });

  expect(started).toEqual({ claimId: "claim-1", value: "provider-stream" });
  expect(releases).toEqual([]);

  const result = await runWithEstimateGenerationClaim({
    claimId: started?.claimId ?? "",
    release: async (claimId) => {
      releases.push(claimId);
    },
    work: async () => "saved-estimate",
  });

  expect(result).toBe("saved-estimate");
  expect(releases).toEqual(["claim-1"]);
});

test("releases the claim after provider or save work fails", async () => {
  const releases: string[] = [];
  await expect(
    runWithEstimateGenerationClaim({
      claimId: "claim-2",
      release: async (claimId) => {
        releases.push(claimId);
      },
      work: async () => {
        throw new Error("synthetic generation failure");
      },
    })
  ).rejects.toThrow("synthetic generation failure");

  expect(releases).toEqual(["claim-2"]);
});

test("releases the claim when starting the provider throws", async () => {
  const releases: string[] = [];

  await expect(
    startWithEstimateGenerationClaim({
      claim: async () => "claim-3",
      release: async (claimId) => {
        releases.push(claimId);
      },
      start: () => {
        throw new Error("synthetic provider start failure");
      },
    })
  ).rejects.toThrow("synthetic provider start failure");

  expect(releases).toEqual(["claim-3"]);
});

test("the route claims before Anthropic and always releases after stream work", () => {
  const source = readFileSync("app/api/generate-estimate/route.ts", "utf8");
  const claimStart = source.indexOf("await startWithEstimateGenerationClaim(");
  const providerStart = source.indexOf("client.messages.stream");

  expect(claimStart).toBeGreaterThanOrEqual(0);
  expect(providerStart).toBeGreaterThan(claimStart);
  expect(source).toContain("runWithEstimateGenerationClaim");
  expect(source).toContain("releaseEstimateGenerationClaim(supabaseAdmin");
});

test("the claim protocol is service-role-only and mutually excludes generation and deletion", () => {
  const migration = readFileSync("supabase/migrations/20260818150005_estimate_generation_claims.sql", "utf8");
  const deletionRoute = readFileSync("app/api/account/delete/route.ts", "utf8");

  expect(migration).toContain("tpe_estimate_generation_claims");
  expect(migration).toContain("on delete restrict");
  expect(migration).toContain("for key share");
  expect(migration).toContain('to service_role');
  expect(migration).toContain("set search_path = public");
  expect(migration).toContain("ESTIMATE_GENERATION_IN_PROGRESS");
  expect(migration).toContain("BUSINESS_DELETION_IN_PROGRESS");
  expect(migration).toContain("begin_business_deletion");
  expect(migration).toContain("release_business_deletion_claim");
  expect(migration).toContain("claim_type = 'generation'");
  expect(migration).toContain("claim_type = 'deletion'");
  expect(migration).toContain("BUSINESS_DELETION_CLAIM_REQUIRED");
  expect(migration).toContain("grant execute on function public.claim_estimate_generation");
  expect(migration).not.toMatch(/grant execute on function public\.claim_estimate_generation[^\n]* to authenticated/i);
  expect(deletionRoute).toContain("ESTIMATE_GENERATION_IN_PROGRESS");
  expect(deletionRoute).toContain("Estimate generation is in progress. Try again in a few minutes.");
  expect(deletionRoute).toContain("beginBusinessDeletionClaim");
  expect(deletionRoute).toContain("releaseBusinessDeletionClaim");
});
