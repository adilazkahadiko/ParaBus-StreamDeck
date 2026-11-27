import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { globalSettings, record, type GlobalSettings } from './settings.ts';

// No credentials in argv, environment, errors or logs. CurrentUser DPAPI, with
// plugin-specific entropy; only the fixed helper program is an argument.
const helper = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName System.Security
 $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
 $entropy = [Text.Encoding]::UTF8.GetBytes('ParaBus.StreamDeck.Credential.v1')
 $data = $null; $result = $null
 try {
  if ($r.value -isnot [string] -or $r.value.Length -gt 16384) { throw 'Invalid input' }
  if ($r.operation -eq 'protect') {
   $data = [Text.Encoding]::UTF8.GetBytes($r.value)
   $result = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
   $value = [Convert]::ToBase64String($result)
  } elseif ($r.operation -eq 'unprotect') {
   $data = [Convert]::FromBase64String($r.value)
   $result = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
   $value = [Text.Encoding]::UTF8.GetString($result)
  } else { throw 'Invalid operation' }
  [Console]::Out.Write((ConvertTo-Json -InputObject @{value=$value} -Compress))
 } finally {
  if ($null -ne $data) { [Array]::Clear($data,0,$data.Length) }
  if ($null -ne $result) { [Array]::Clear($result,0,$result.Length) }
 }
} catch { [Console]::Out.Write('{}'); exit 1 }
`;
export type Protect = (operation: 'protect' | 'unprotect', value: string) => Promise<string>;
export const dpapi: Protect = (operation, value) => new Promise((resolve, reject) => {
  const failure = () => new Error('鍵の保護・復元に失敗しました。このWindowsアカウントで鍵を入力し直してください。');
  if (process.platform !== 'win32' || value.length > 16384) { reject(failure()); return; }
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const child = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(helper, 'utf16le').toString('base64')],
    { windowsHide: true, env: { SystemRoot: systemRoot, PATH: join(systemRoot, 'System32') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', settled = false;
  const finish = (result?: string) => {
    if (settled) return; settled = true; clearTimeout(timer); output = '';
    if (result) resolve(result); else { child.kill(); reject(failure()); }
  };
  const timer = setTimeout(() => finish(), 15000); timer.unref();
  child.on('error', () => finish()); child.stdin.on('error', () => finish()); child.stderr.resume();
  child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 32768) finish(); });
  child.on('close', code => {
    try {
      const response = record(JSON.parse(output.replace(/^\uFEFF/, '')));
      if (code !== 0 || typeof response.value !== 'string' || !response.value || response.value.length > 16384) return finish();
      if (operation === 'protect' && !/^[A-Za-z0-9+/]+={0,2}$/.test(response.value)) return finish();
      finish(response.value);
    } catch { finish(); }
  });
  child.stdin.end(JSON.stringify({ operation, value }), 'utf8');
});

export interface GlobalStore { get(): Promise<unknown>; set(value: Record<string, unknown>): Promise<void> }
/** All SDK writes go through here. No plaintext fallback for new saves. The
 * connection code is discarded after parsing; only its token needs protection. */
export class CredentialSettings {
  warning = '';
  constructor(private store: GlobalStore, private protect: Protect = dpapi) {}
  async get(): Promise<GlobalSettings> { return this.decode(await this.store.get()); }
  async decode(value: unknown): Promise<GlobalSettings> {
    const raw = record(value), settings = globalSettings(value);
    if (typeof raw.protectedToken === 'string') {
      try {
        if (!raw.protectedToken.startsWith('dpapi:v1:')) throw 0;
        settings.token = globalSettings({ token: await this.protect('unprotect', raw.protectedToken.slice(9)) }).token;
        if (!settings.token) throw 0;
      } catch { this.warning = '保存済みの鍵を復元できません。このWindowsアカウントで鍵を入力し直してください。'; throw new Error(this.warning); }
    } else if (settings.token) {
      try { await this.set(settings); }
      catch { this.warning = '旧形式の鍵を暗号化できませんでした。WindowsのDPAPIを確認し、接続を再保存してください。'; }
    }
    return settings;
  }
  async set(settings: GlobalSettings): Promise<void> {
    const clean = globalSettings(settings), { token, ...metadata } = clean;
    const protectedToken = token ? `dpapi:v1:${await this.protect('protect', token)}` : undefined;
    await this.store.set({ ...metadata, ...(protectedToken ? { protectedToken } : {}) });
    this.warning = '';
  }
}
