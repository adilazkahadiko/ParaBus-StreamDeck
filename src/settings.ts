export type ButtonSettings = {
  target?: 'bus' | 'send' | 'tx';
  participant?: 'user' | 'slot';
  discordUserId?: string;
  index?: number;
  scopeBusId?: string;
  busId?: string;
  profileId?: string;
  stepDb?: number;
};
export type GlobalSettings = { port: number; token: string };
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);

/** An allowlist, never a spread of incoming settings. No names, tokens or revisions. */
export function buttonSettings(value: unknown): ButtonSettings {
  const v = record(value), s: ButtonSettings = {};
  if (['bus', 'send', 'tx'].includes(String(v.target))) s.target = v.target as ButtonSettings['target'];
  if (s.target === 'send') {
    if (v.participant === 'slot') {
      s.participant = 'slot';
      if (Number.isSafeInteger(v.index) && Number(v.index) >= 1 && Number(v.index) <= 112) s.index = Number(v.index);
      if (id(v.scopeBusId)) s.scopeBusId = v.scopeBusId;
    } else {
      s.participant = 'user';
      if (typeof v.discordUserId === 'string' && /^\d{17,20}$/.test(v.discordUserId)) s.discordUserId = v.discordUserId;
    }
  }
  if ((s.target === 'bus' || s.target === 'send') && id(v.busId)) s.busId = v.busId;
  if (s.target === 'tx' && typeof v.profileId === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v.profileId)) s.profileId = v.profileId;
  if (typeof v.stepDb === 'number' && Number.isFinite(v.stepDb) && v.stepDb > 0 && v.stepDb <= 6) s.stepDb = v.stepDb;
  return s;
}
export function globalSettings(value: unknown): GlobalSettings {
  const v = record(value);
  return {
    port: Number.isInteger(v.port) && Number(v.port) >= 1 && Number(v.port) <= 65535 ? Number(v.port) : 4175,
    token: typeof v.token === 'string' && /^[\x21-\x7e]{1,512}$/.test(v.token) ? v.token : ''
  };
}
