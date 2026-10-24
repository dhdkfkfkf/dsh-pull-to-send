/**
 * Host half of dsh-pull-to-send.
 *
 * The plugin is browser-only: it installs pointer listeners on the Web surface.
 * Every profile row needs a Node-side module, and a no-op is legitimate (the
 * shipped `dsh-client-ui-sidebar` does the same), so this file exists only to
 * satisfy the loader.
 */

/** @type {string[]} No Cordis services are required. */
export const inject = [];

/**
 * Host plugin body.
 * @param ctx - Cordis context (unused).
 */
export function apply(ctx) {}
