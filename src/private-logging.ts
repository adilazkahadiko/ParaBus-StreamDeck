/** SDK trace / parse-error logging can contain raw global settings and PI messages.
 * Sanitize at the public Logger.write boundary, including already-created scopes.
 * This is deliberately version-pinned and covered by a real SDK transport test.
 */
export function privateLogging(logger: { write: (...args: never[]) => unknown }): void {
  const prototype = Object.getPrototypeOf(logger);
  const original = prototype.write;
  prototype.write = function (entry: { level: string }) {
    if (entry.level === 'error') return original.call(this, { level: 'error', data: ['Stream Deck SDK error'], scope: 'SDK' });
    return this;
  };
}
