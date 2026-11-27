// TLS test-only certificate builder from ParaBus (GPL-3.0-only), commit 248623b.
import { generateKeyPair, randomBytes, sign, X509Certificate, createPrivateKey } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
const der = (tag, bytes) => {
  const length = bytes.length < 128 ? Buffer.from([bytes.length]) : (() => {
    let hex = bytes.length.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const size = Buffer.from(hex, "hex");
    return Buffer.concat([Buffer.from([128 | size.length]), size]);
  })();
  return Buffer.concat([Buffer.from([tag]), length, bytes]);
};
const sequence = (...parts) => der(48, Buffer.concat(parts));
const oid = (hex) => der(6, Buffer.from(hex, "hex"));
const octets = (bytes) => der(4, bytes);
const bits = (bytes, unused = 0) => der(3, Buffer.concat([Buffer.from([unused]), bytes]));
const algorithm = () => sequence(oid("2a8648ce3d040302"));
const name = () => sequence(der(49, sequence(oid("550403"), der(12, Buffer.from("ParaBus LAN Control")))));
const time = (value) => {
  const full = value.toISOString().replace(/[-:T]/g, "").replace(/\.\d{3}Z$/, "Z");
  const utcTime = value.getUTCFullYear() >= 1950 && value.getUTCFullYear() < 2050;
  return der(utcTime ? 23 : 24, Buffer.from(utcTime ? full.slice(2) : full));
};
const pem = (bytes) => `-----BEGIN CERTIFICATE-----
${bytes.toString("base64").match(/.{1,64}/g).join("\n")}
-----END CERTIFICATE-----
`;
async function generateLanCertificate(address, now = /* @__PURE__ */ new Date()) {
  if (isIP(address) !== 4 || address === "0.0.0.0") throw new Error("IPv4 address required");
  const pair = await promisify(generateKeyPair)("ec", { namedCurve: "prime256v1" });
  const serial = randomBytes(20);
  serial[0] &= 127;
  serial[0] |= 1;
  const extension = (id, value, critical = false) => sequence(oid(id), ...critical ? [der(1, Buffer.from([255]))] : [], octets(value));
  const extensions = der(163, sequence(
    extension("551d13", sequence(), true),
    // basicConstraints: CA=false
    extension("551d0f", bits(Buffer.from([128]), 7), true),
    // digitalSignature
    extension("551d25", sequence(oid("2b06010505070301"))),
    // serverAuth
    extension("551d11", sequence(der(135, Buffer.from(address.split(".").map(Number)))))
  ));
  const tbs = sequence(
    der(160, der(2, Buffer.from([2]))),
    der(2, serial),
    algorithm(),
    name(),
    sequence(time(new Date(now.getTime() - 3e5)), time(new Date(now.getTime() + 3650 * 864e5))),
    name(),
    pair.publicKey.export({ format: "der", type: "spki" }),
    extensions
  );
  const certificate = pem(sequence(tbs, algorithm(), bits(sign("sha256", tbs, pair.privateKey))));
  const key = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const parsed = new X509Certificate(certificate);
  if (!parsed.verify(parsed.publicKey) || !parsed.checkPrivateKey(createPrivateKey(key)) || parsed.checkIP(address) !== address || !Number.isFinite(Date.parse(parsed.validFrom)) || !Number.isFinite(Date.parse(parsed.validTo))) throw new Error("Certificate validation failed");
  return { certificate, key, fingerprint: parsed.fingerprint256.replaceAll(":", "").toLowerCase() };
}
export {
  generateLanCertificate
};
