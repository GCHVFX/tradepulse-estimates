import { NextRequest, NextResponse } from "next/server";
import {
  AccountDeletionError,
  cancelOwnedStripeSubscription,
  deleteAuthenticatedAccount,
  type AccountDeletionBusiness,
  type StorageObject,
} from "@/lib/account-deletion";
import { stripe } from "@/lib/stripe";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import {
  beginBusinessDeletion as beginBusinessDeletionClaim,
  BusinessDeletionInProgressError,
  BusinessDeletionUnavailableError,
  ESTIMATE_GENERATION_IN_PROGRESS,
  EstimateGenerationInProgressError,
  releaseBusinessDeletion as releaseBusinessDeletionClaim,
} from "@/lib/estimate-generation-claims";

function isMissingAuthUser(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "user_not_found" || /user.*not found/i.test(error?.message ?? "");
}

function isEstimateGenerationInProgress(error: { message?: string } | null): boolean {
  return error?.message === ESTIMATE_GENERATION_IN_PROGRESS;
}

function hasCrossOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);

  if (hasCrossOriginRequest(request)) {
    return applyTo(NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 }));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body: { confirmation?: unknown };
  try {
    body = (await request.json()) as { confirmation?: unknown };
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  try {
    await deleteAuthenticatedAccount({
      confirmation: body.confirmation,
      userId: user.id,
      lastSignInAt: user.last_sign_in_at,
      dependencies: {
        async findOwnedBusiness(userId): Promise<AccountDeletionBusiness | null> {
          const { data, error } = await supabaseAdmin
            .from("tpe_businesses")
            .select("id, owner_user_id, stripe_customer_id, stripe_subscription_id, logo_url")
            .eq("owner_user_id", userId)
            .maybeSingle();

          if (error) throw error;
          if (!data?.owner_user_id) return null;

          return {
            id: data.id,
            ownerUserId: data.owner_user_id,
            stripeCustomerId: data.stripe_customer_id,
            stripeSubscriptionId: data.stripe_subscription_id,
            logoUrl: data.logo_url,
          };
        },
        async beginBusinessDeletion(business): Promise<void> {
          try {
            await beginBusinessDeletionClaim(supabaseAdmin, {
              businessId: business.id,
              ownerUserId: business.ownerUserId,
            });
          } catch (error) {
            if (error instanceof EstimateGenerationInProgressError) {
              throw new AccountDeletionError("Estimate generation is in progress. Try again in a few minutes.", 409);
            }
            if (error instanceof BusinessDeletionInProgressError) {
              throw new AccountDeletionError("Account deletion is already in progress. Try again in a few minutes.", 409);
            }
            if (error instanceof BusinessDeletionUnavailableError) {
              throw new AccountDeletionError("Your account is no longer available for deletion. Please sign in again.", 409);
            }
            throw error;
          }
        },
        async releaseBusinessDeletion(business): Promise<void> {
          await releaseBusinessDeletionClaim(supabaseAdmin, {
            businessId: business.id,
            ownerUserId: business.ownerUserId,
          });
        },
        async listStorageObjects(business): Promise<StorageObject[]> {
          const { data: estimates, error: estimatesError } = await supabaseAdmin
            .from("tpe_estimates")
            .select("id")
            .eq("business_id", business.id);
          if (estimatesError) throw estimatesError;

          const estimateIds = (estimates ?? []).map((estimate) => estimate.id);
          const storageObjects: StorageObject[] = [];

          if (estimateIds.length > 0) {
            const { data: photos, error: photosError } = await supabaseAdmin
              .from("tpe_estimate_photos")
              .select("storage_path")
              .in("estimate_id", estimateIds);
            if (photosError) throw photosError;

            storageObjects.push(
              ...(photos ?? []).map((photo) => ({
                bucket: "tpe-estimate-photos" as const,
                path: photo.storage_path,
              }))
            );
          }

          if (business.logoUrl) {
            storageObjects.push({ bucket: "logos", path: `${business.ownerUserId}/logo` });
          }

          return storageObjects;
        },
        async removeStorageObjects(storageObjects): Promise<void> {
          const byBucket = new Map<StorageObject["bucket"], string[]>();
          for (const storageObject of storageObjects) {
            const paths = byBucket.get(storageObject.bucket) ?? [];
            paths.push(storageObject.path);
            byBucket.set(storageObject.bucket, paths);
          }

          for (const [bucket, paths] of byBucket) {
            const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
            if (error && error.statusCode !== "404") throw error;
          }
        },
        async cancelSubscription(business): Promise<void> {
          await cancelOwnedStripeSubscription(stripe, business);
        },
        async deleteBusinessData(business): Promise<void> {
          const { error } = await supabaseAdmin.rpc("tpe_delete_business_account_data", {
            p_business_id: business.id,
            p_owner_user_id: business.ownerUserId,
          });
          if (isEstimateGenerationInProgress(error)) {
            throw new AccountDeletionError("Estimate generation is in progress. Try again in a few minutes.", 409);
          }
          if (error) throw error;
        },
        async deleteAuthUser(userId): Promise<void> {
          const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
          if (error && !isMissingAuthUser(error)) throw error;
        },
        async clearSession(): Promise<void> {
          const { error } = await supabase.auth.signOut({ scope: "local" });
          if (error) throw error;
        },
      },
    });
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return applyTo(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    console.error("[account-delete] failed:", error instanceof Error ? error.message : error);
    return applyTo(
      NextResponse.json(
        { error: "We could not finish account deletion. Please try again or contact support." },
        { status: 500 }
      )
    );
  }

  return applyTo(NextResponse.json({ success: true }));
}
