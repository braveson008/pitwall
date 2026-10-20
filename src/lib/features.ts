/**
 * What this build shows.
 *
 * Pitwall ships more than it is ready to be judged on. Voice works, but it
 * owns a microphone, a permission prompt and a daemon that can die for reasons
 * the app cannot control — an entire class of first-run failure, in front of
 * people meeting the product for the first time. It stays in the build and out
 * of the interface until the rest has earned the benefit of the doubt.
 *
 * Flags here are build-time and deliberately boring: one constant, read at the
 * render site, no settings UI. A flag a user can toggle is a feature with a
 * support burden, which is the thing being avoided.
 */

/** The wake-word assistant and its HUD. Hidden for the alpha. */
export const VOICE_ENABLED = false;

/**
 * Features shown with an alpha marker rather than hidden.
 *
 * Council runs several agents at one task and synthesises the result. It works,
 * and it is the least proven thing here — expensive, slow, and hardest to
 * verify. Saying so is cheaper than a refund.
 */
export const ALPHA_FEATURES = { council: true } as const;
