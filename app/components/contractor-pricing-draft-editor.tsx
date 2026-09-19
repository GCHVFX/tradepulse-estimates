"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ContractorPricingEditor,
  type ContractorPricingEditorHandle,
  type ContractorPricingEditorProps,
  type ContractorPricingEditorState,
} from "@/app/components/contractor-pricing-editor";

/**
 * The pricing editor for an undelivered contractor_pricing draft on
 * /estimates/[id], with the page's one sticky primary action while pricing is
 * not ready to send: Save Pricing.
 *
 * app/estimates/[id]/page.tsx is a server component, so it cannot hand the
 * editor's ref to anything. This client component owns that ref and calls
 * the editor's own save() through it, the same pattern /new uses. It holds
 * nothing but the read-only projection the editor reports; dirty, saving and
 * the save error all stay inside ContractorPricingEditor.
 *
 * The two primary actions never show together. This bar renders only while
 * the editor reports sendReady false, and EstimateActions' Send bar renders
 * for a draft only while the editor's published readiness is true (the
 * PRICING_CHANGE_EVENT it listens for). Both read the one isPricingSendReady
 * value, so exactly one of Save Pricing and Send Estimate is on screen.
 *
 * A delivered estimate does not use this: its pricing is locked, and the
 * page renders ContractorPricingEditor directly with its inline Save, as
 * before.
 */
export function ContractorPricingDraftEditor(
  props: Omit<ContractorPricingEditorProps, "isDelivered" | "onStateChange" | "hideInlineSaveButton">
) {
  const editorRef = useRef<ContractorPricingEditorHandle>(null);
  // null until the editor's first report, one effect after mount.
  const [editorState, setEditorState] = useState<ContractorPricingEditorState | null>(null);

  const showSaveBar = editorState !== null && !editorState.sendReady;
  const saving = editorState?.status === "saving";

  async function handleSave() {
    await editorRef.current?.save();
  }

  // Same approach as EstimateActions' own bar: publish this bar's measured
  // height so app/estimates/[id]/page.tsx reserves room for it. A separate
  // property from EstimateActions' one, so neither bar can overwrite the
  // other's value; the two bars never show together, so the page's sum of
  // both is the visible one.
  const observerRef = useRef<ResizeObserver | null>(null);
  const barRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) {
      document.documentElement.style.setProperty("--tp-pricing-action-bar-height", "0px");
      return;
    }
    const publishHeight = () => {
      document.documentElement.style.setProperty("--tp-pricing-action-bar-height", `${el.offsetHeight}px`);
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      document.documentElement.style.removeProperty("--tp-pricing-action-bar-height");
    };
  }, []);

  return (
    <>
      <ContractorPricingEditor
        {...props}
        ref={editorRef}
        isDelivered={false}
        hideInlineSaveButton
        onStateChange={setEditorState}
      />
      {showSaveBar && (
        <div
          ref={barRef}
          className="fixed left-0 right-0 px-5 pb-7 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent flex flex-col gap-3 z-30"
          style={{ bottom: "calc(var(--tp-bottom-nav-height, 87px) - 3px)" }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            {saving ? "Saving..." : "Save Pricing"}
          </button>
        </div>
      )}
    </>
  );
}
