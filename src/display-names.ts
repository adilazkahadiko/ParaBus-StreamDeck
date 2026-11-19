import type { State } from './protocol.ts';

/** Display-only choices shared with the inspector; never store labels in settings. */
export function busChoices(state: State) {
  const choices = state.buses.map((bus, index) => ({ id: bus.busId, kind: bus.kind,
    label: state.permissions.readDisplayNames && bus.label ? bus.label : `${bus.kind === 'vc' ? 'VC Bus' : 'Bus'} ${index + 1}` }));
  const reserved = new Set(choices.map(bus => bus.label)), used = new Set<string>(), counts = new Map<string, number>();
  return choices.map(bus => {
    let label = bus.label, count = counts.get(label) ?? 1;
    if (used.has(label)) do { label = `${bus.label} (${++count})`; } while (reserved.has(label) || used.has(label));
    counts.set(bus.label, count); used.add(label);
    return { ...bus, label };
  });
}

const clean = (name: string): string => name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();

export function participantName(state: State, userId: string): string {
  if (state.permissions.readDisplayNames) {
    for (const users of [state.registeredUsers, state.participants]) {
      const name = clean(users.find(user => user.discordUserId === userId)?.displayName ?? '');
      if (name) return name;
    }
  }
  return `…${userId.slice(-4)}`;
}

// Eight half-width cells fit a 72px key at the manifest's default font size 9.
// Treat ambiguous/non-half-width characters (including …) conservatively as two.
export const BUTTON_NAME_WIDTH = 8;
const width = (char: string): number => /^[\x20-\x7e\uff61-\uffdc]$/u.test(char) ? 1 : 2;
export function buttonName(name: string): string {
  const chars = [...clean(name)];
  if (chars.reduce((sum, char) => sum + width(char), 0) <= BUTTON_NAME_WIDTH) return chars.join('');
  let result = '', used = 0;
  for (const char of chars) {
    if (used + width(char) > BUTTON_NAME_WIDTH - width('…')) break;
    result += char; used += width(char);
  }
  return `${result}…`;
}
