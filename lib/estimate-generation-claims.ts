import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const ESTIMATE_GENERATION_IN_PROGRESS = "ESTIMATE_GENERATION_IN_PROGRESS";
export const BUSINESS_DELETION_IN_PROGRESS = "BUSINESS_DELETION_IN_PROGRESS";
export const BUSINESS_DELETION_UNAVAILABLE = "BUSINESS_DELETION_UNAVAILABLE";

export class EstimateGenerationInProgressError extends Error {
  constructor() {
    super(ESTIMATE_GENERATION_IN_PROGRESS);
  }
}

export class BusinessDeletionInProgressError extends Error {
  constructor() {
    super(BUSINESS_DELETION_IN_PROGRESS);
  }
}

export class BusinessDeletionUnavailableError extends Error {
  constructor() {
    super(BUSINESS_DELETION_UNAVAILABLE);
  }
}

export interface EstimateGenerationClaimInput {
  businessId: string;
  ownerUserId: string;
}

export async function claimEstimateGeneration(
  supabaseAdmin: SupabaseClient<Database>,
  input: EstimateGenerationClaimInput
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_estimate_generation", {
    p_business_id: input.businessId,
    p_owner_user_id: input.ownerUserId,
  });

  if (error) {
    console.error("[estimate-generation-claims] unable to create claim:", error.message);
    return null;
  }

  return data;
}

export async function releaseEstimateGenerationClaim(
  supabaseAdmin: SupabaseClient<Database>,
  input: EstimateGenerationClaimInput & { claimId: string }
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_estimate_generation_claim", {
    p_claim_id: input.claimId,
    p_business_id: input.businessId,
    p_owner_user_id: input.ownerUserId,
  });

  if (error) {
    console.error("[estimate-generation-claims] unable to release claim:", error.message);
  }
}

export async function beginBusinessDeletion(
  supabaseAdmin: SupabaseClient<Database>,
  input: EstimateGenerationClaimInput
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("begin_business_deletion", {
    p_business_id: input.businessId,
    p_owner_user_id: input.ownerUserId,
  });

  if (!error && data) return;
  if (!error) {
    throw new BusinessDeletionUnavailableError();
  }
  if (error.message === ESTIMATE_GENERATION_IN_PROGRESS) {
    throw new EstimateGenerationInProgressError();
  }
  if (error.message === BUSINESS_DELETION_IN_PROGRESS) {
    throw new BusinessDeletionInProgressError();
  }
  throw new Error("Unable to start account deletion safely");
}

export async function releaseBusinessDeletion(
  supabaseAdmin: SupabaseClient<Database>,
  input: EstimateGenerationClaimInput
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_business_deletion_claim", {
    p_business_id: input.businessId,
    p_owner_user_id: input.ownerUserId,
  });
  if (error) console.error("[estimate-generation-claims] unable to release deletion claim:", error.message);
}

export async function startWithEstimateGenerationClaim<T>(input: {
  claim: () => Promise<string | null>;
  release: (claimId: string) => Promise<void>;
  start: () => T;
}): Promise<{ claimId: string; value: T } | null> {
  const claimId = await input.claim();
  if (!claimId) return null;

  try {
    return { claimId, value: input.start() };
  } catch (error) {
    await input.release(claimId);
    throw error;
  }
}

export async function runWithEstimateGenerationClaim<T>(input: {
  claimId: string;
  release: (claimId: string) => Promise<void>;
  work: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.work();
  } finally {
    await input.release(input.claimId);
  }
}
