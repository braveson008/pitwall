import { type ReactNode, useEffect, useState } from "react";

const money = (usd: number | undefined) => `$${(usd ?? 0).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Plans & usage. Signed out, it is a two-step email sign-in. Signed in, it
 * says where this month stands, sets the pay-as-you-go cap, and lists plans.
 */
export function PlansPanel({
  state,
  account,
  plans,
  error,
  onChanged,
  cloud,
}: {
  /** The sync section, under the same sign-in. */
  cloud?: ReactNode;
  state: PitwallCreditsState;
  account: PitwallAccount | null;
  plans: { plans: PitwallPlan[]; checkoutAvailable: boolean; markupPercent: number } | null;
  error: string;
  onChanged: () => Promise<unknown>;
}) {
  const [email, setEmail] = useState(state.email);
  const [code, setCode] = useState("");
  const [codeSentTo, setCodeSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cap, setCap] = useState(String(account?.overage_cap_usd ?? 0));
  useEffect(() => setCap(String(account?.overage_cap_usd ?? 0)), [account?.overage_cap_usd]);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage("");
    try {
      const said = await work();
      if (said) setMessage(said);
    } finally {
      setBusy(false);
    }
  };

  if (!state.available) {
    return (
      <div className="dk-plans">
        <section className="dk-plans-intro">
          <h3>Credits are not available yet</h3>
          <p>Agents run on your own logins. Credits for DeepSeek, GLM and other models will appear here once they open.</p>
        </section>
        {cloud}
      </div>
    );
  }

  if (!state.signedIn) {
    return (
      <div className="dk-plans">
        <section className="dk-plans-intro">
          <h3>Your Pitwall account</h3>
          <p>Sign in to sync your projects across computers, and to use DeepSeek, GLM and other models in Codex on one monthly plan. Claude keeps running on your own login.</p>
        </section>
        {codeSentTo ? (
          <form
            className="dk-plans-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const reply = await window.braveli?.creditsSignInVerify?.({ email: codeSentTo, code });
                if (!reply?.ok) return reply?.message ?? "Sign-in failed.";
                await onChanged();
                return reply.persisted === false ? "Signed in for this session. Your Mac's keychain is unavailable, so you will be asked again next time." : "";
              });
            }}
          >
            <label htmlFor="plans-code">Code sent to {codeSentTo}</label>
            <div className="dk-plans-row">
              <input id="plans-code" className="dk-input dk-plans-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(event) => setCode(event.target.value)} autoFocus />
              <button type="submit" className="dk-btn dk-btn--primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Sign in</button>
            </div>
            <button type="button" className="dk-link" onClick={() => { setCodeSentTo(""); setCode(""); setMessage(""); }}>Use a different email</button>
          </form>
        ) : (
          <form
            className="dk-plans-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const reply = await window.braveli?.creditsSignInStart?.({ email });
                if (!reply?.ok) return reply?.message ?? "The code could not be sent.";
                setCodeSentTo(reply.data.email);
                return "";
              });
            }}
          >
            <label htmlFor="plans-email">Email</label>
            <div className="dk-plans-row">
              <input id="plans-email" className="dk-input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
              <button type="submit" className="dk-btn dk-btn--primary" disabled={busy || !email.includes("@")}>Email me a code</button>
            </div>
            <p className="dk-hint">No password. We send a six-digit code that works for 10 minutes.</p>
          </form>
        )}
        {message ? <p className="dk-plans-message" role="alert">{message}</p> : null}
        {cloud}
      </div>
    );
  }

  const usedShare = account?.active && account.allowance_usd ? Math.min(1, (account.used_usd ?? 0) / account.allowance_usd) : 0;
  const planName = plans?.plans.find((plan) => plan.id === account?.plan)?.name ?? account?.plan ?? "";

  return (
    <div className="dk-plans">
      <section className="dk-plans-account">
        <div>
          <span className="dk-plans-label">Signed in as</span>
          <strong>{state.email}</strong>
        </div>
        <button
          type="button"
          className="dk-btn dk-btn--ghost dk-btn--sm"
          onClick={() => void run(async () => { await window.braveli?.creditsSignOut?.(); await onChanged(); })}
        >
          Sign out
        </button>
      </section>
      {error ? <p className="dk-plans-message" role="alert">{error}</p> : null}
      {cloud}

      {account?.active ? (
        <section className="dk-plans-month" aria-label="This month">
          <div className="dk-plans-month-head">
            <strong>{planName}</strong>
            {account.period ? <span>Renews {day(account.period.end)}</span> : null}
          </div>
          <div className="dk-plans-meter" role="meter" aria-valuemin={0} aria-valuemax={account.allowance_usd} aria-valuenow={account.used_usd} aria-label="Usage this month">
            <span style={{ width: `${usedShare * 100}%` }} />
          </div>
          <p className="dk-plans-figures">
            {money(account.used_usd)} of {money(account.allowance_usd)} used · <strong>{money(account.remaining_usd)} left</strong>
            {account.overage_usd ? ` · ${money(account.overage_usd)} pay-as-you-go so far` : ""}
          </p>

          <form
            className="dk-plans-cap"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const reply = await window.braveli?.creditsSetCap?.({ usd: Number(cap) });
                if (!reply?.ok) return reply?.message ?? "The cap could not be saved.";
                await onChanged();
                return "Saved.";
              });
            }}
          >
            <label htmlFor="plans-cap">Pay-as-you-go after the plan runs out, up to</label>
            <div className="dk-plans-row">
              <span className="dk-plans-currency">$</span>
              <input id="plans-cap" className="dk-input dk-plans-cap-input" inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} />
              <button type="submit" className="dk-btn" disabled={busy || Number(cap) === account.overage_cap_usd}>Save</button>
            </div>
            <p className="dk-hint">Billed at the end of the month, and only for what you used. $0 means agents stop when the plan runs out.</p>
          </form>

          {account.by_model.length ? (
            <table className="dk-plans-models">
              <thead><tr><th>Model</th><th>Calls</th><th>Spent</th></tr></thead>
              <tbody>
                {account.by_model.map((row) => (
                  <tr key={row.model}><td className="dk-mono">{row.model}</td><td>{row.calls}</td><td>{money(row.cost_usd)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dk-hint">No usage yet this month. Start Codex with “Pay with: Credits” in New work.</p>
          )}
        </section>
      ) : null}

      <section className="dk-plans-list" aria-label="Plans">
        {(plans?.plans ?? []).map((plan) => {
          const current = account?.active && account.plan === plan.id;
          return (
            <div key={plan.id} className={`dk-plans-plan${current ? " is-current" : ""}`}>
              <div>
                <strong>{plan.name}</strong>
                <span>{money(plan.price_usd)} a month · {money(plan.allowance_usd)} of usage included</span>
              </div>
              {current ? (
                <span className="dk-plans-current">Your plan</span>
              ) : state.dev ? (
                <button
                  type="button"
                  className="dk-btn dk-btn--sm"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    const reply = await window.braveli?.creditsDevActivate?.({ plan: plan.id });
                    if (!reply?.ok) return reply?.message ?? "Could not activate.";
                    await onChanged();
                    return "";
                  })}
                >
                  Activate (local)
                </button>
              ) : (
                <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" disabled={!plans?.checkoutAvailable}>Choose</button>
              )}
            </div>
          );
        })}
        <p className="dk-hint">
          Usage is charged at each provider's price plus {plans?.markupPercent ?? 15}%.
          {plans && !plans.checkoutAvailable && !state.dev ? " Checkout opens once payments are connected." : ""}
        </p>
      </section>
      {message ? <p className="dk-plans-message" role="status">{message}</p> : null}
    </div>
  );
}
