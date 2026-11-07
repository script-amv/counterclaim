/** Hosted builds use recorded fixtures and reject all sandbox mutations. */
export function isReplayOnly() {
  return process.env.VERCEL === '1' || process.env.COUNTERCLAIM_REPLAY_ONLY === '1';
}
