import { useCallback, useEffect, useState } from "react";

const NOT_AVAILABLE: PitwallCreditsState = { available: false, dev: false, signedIn: false, email: "" };

/**
 * The Pitwall account as the renderer sees it: whether credits exist in this
 * build, who is signed in, and where the plan stands. The key itself stays in
 * the main process.
 */
export function useCredits() {
  const [state, setState] = useState<PitwallCreditsState>(NOT_AVAILABLE);
  const [account, setAccount] = useState<PitwallAccount | null>(null);
  const [plans, setPlans] = useState<{ plans: PitwallPlan[]; checkoutAvailable: boolean; markupPercent: number } | null>(null);
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const next = (await window.braveli?.creditsState?.()) ?? NOT_AVAILABLE;
    setState(next);
    if (!next.available) return next;
    const plansReply = await window.braveli?.creditsPlans?.();
    if (plansReply?.ok) {
      setPlans({ plans: plansReply.data.plans, checkoutAvailable: plansReply.data.checkout_available, markupPercent: plansReply.data.markup_percent });
    }
    if (!next.signedIn) {
      setAccount(null);
      return next;
    }
    const reply = await window.braveli?.creditsAccount?.();
    if (reply?.ok) {
      setAccount(reply.data);
      setError("");
      const listed = reply.data.active ? await window.braveli?.creditsModels?.() : null;
      setModels(listed?.ok ? listed.data.data.filter((model) => model.endpoints.includes("/v1/responses")).map((model) => model.id) : []);
    } else if (reply) {
      setError(reply.message);
      // A key the gateway no longer accepts is a signed-out account.
      if (reply.status === 401) {
        const after = await window.braveli?.creditsSignOut?.();
        if (after) setState(after.state);
        setAccount(null);
      }
    }
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, setState, account, plans, models, error, refresh };
}

/** One line for the foot of the sidebar. */
export function creditsStatusLine(state: PitwallCreditsState, account: PitwallAccount | null): string {
  if (!state.available || !state.signedIn) return "Free · your own logins";
  if (!account) return "Pitwall account";
  if (!account.active) return "No plan · your own logins";
  const left = account.remaining_usd ?? 0;
  return `Credits · $${left.toFixed(2)} left`;
}

/** Credits can run this agent: today only Codex, which speaks the gateway's Responses API. */
export function creditsCanRun(agent: string): boolean {
  return agent === "Codex";
}
