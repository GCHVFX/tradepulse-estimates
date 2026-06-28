"use client";

import { useState } from "react";

const plans = [
  {
    id: "starter" as const,
    name: "Starter",
    price: 39,
    features: ["Unlimited estimates", "SMS and email sending", "Custom rates and price book", "Your logo on estimates", "PDF download"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 69,
    features: ["Everything in Starter", "Google review requests", "Payment tracking and reminders", "Follow-up (coming soon)"],
  },
];

export function PlanPicker({
  defaultPlan,
  disabled,
}: {
  defaultPlan: "starter" | "pro";
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<"starter" | "pro">(defaultPlan);

  return (
    <>
      <div className="flex flex-col gap-4 mb-4">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelected(plan.id)}
            className={`w-full text-left bg-zinc-900 rounded-2xl p-6 transition-colors border-2 ${
              selected === plan.id
                ? "border-amber-500"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-end gap-2 mb-3">
              <span className="text-3xl font-bold">${plan.price}</span>
              <span className="text-zinc-400 mb-0.5">/month</span>
            </div>
            <p className="text-white font-semibold text-base mb-3">{plan.name}</p>
            <ul className="space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-3 text-sm text-zinc-300">
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true">
                    <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {disabled ? (
        <button
          type="button"
          disabled
          className="w-full bg-amber-500 opacity-40 cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 min-h-[56px]"
        >
          Subscribe, ${selected === "pro" ? "69" : "39"}/month
        </button>
      ) : (
        <form action={`/api/billing/checkout?plan=${selected}`} method="POST">
          <button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            Subscribe, ${selected === "pro" ? "69" : "39"}/month
          </button>
        </form>
      )}
    </>
  );
}
