**To:** Atlas Recovery
**Subject:** Payment plan eligibility issue — cause, fix, and next steps

Hi Atlas Recovery team,

Thanks for raising this, and I'm sorry it happened. You were right to be concerned: some consumers were told they didn't qualify for a payment plan when they actually did. The cause is understood, the fix is live, and below is what we found and what we're changing.

**What happened**

A configuration change in our most recent release updated how account statuses map to payment plan eligibility. That change incorrectly mapped accounts with a **Settlement Eligible** status as ineligible for a plan. From that release until we corrected it, any consumer on a Settlement Eligible account who asked about a payment plan would have been told they didn't qualify. Other statuses were unaffected, which is why this showed up on some calls and not others.

**What we changed**

We corrected the mapping so Settlement Eligible resolves to plan-eligible, as it did before the release. This was a configuration fix on our side — no changes to your scripts, your agent's behaviour, or your data.

**How we confirmed it's resolved**

We re-ran the affected scenarios end to end: a Settlement Eligible account requesting a payment plan now receives the correct offer. We also reviewed every other status against the eligibility rules to confirm nothing else was caught by the same change. The corrected mapping is live in production and verified.

**What we're doing so it doesn't recur**

- Eligibility mappings are now validated against the full list of account statuses before release, so a status can't be silently dropped or miscategorised by a change that doesn't mention it.
- We've added monitoring on payment plan decline rates. A jump like this one will now surface from our own alerts rather than from a call.
- Configuration changes affecting eligibility logic require a second reviewer before they go out.

**The consumers affected**

We can pull the list of calls where someone on an eligible account was declined a plan, so your team can decide whether to follow up with them. I'd recommend it, and I'm happy to have that to you today if you want it.

I'm glad you caught this and passed it on. Happy to walk through any part of it, or to review the eligibility mappings with your team if that would help.

Best,
Hannan Bati
Technical Support Engineer, CollectWise
