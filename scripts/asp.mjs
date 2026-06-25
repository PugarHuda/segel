// Canonical Segel ASP allow-list — shared by the contract (its asp_root) and the
// browser prover (membership witness). 16 approved KYC identities; the demo
// bidder uses index 0. In production these are real KYC-derived identity secrets;
// here they're deterministic test secrets (documented as such in the README).
import { makePoseidon, buildTree } from "./merkle.mjs";

export const LEVELS = 10;
export const ASP_SECRETS = Array.from({ length: 16 }, (_, i) => 900_000_000n + BigInt(i) * 7n + 13n);

export async function buildAsp() {
  const { h1, h2 } = await makePoseidon();
  const leaves = ASP_SECRETS.map((s) => h1(s));
  const tree = buildTree(h2, leaves, LEVELS);
  return {
    root: tree.root,
    // membership witness for the identity at allow-list slot `i`
    witness(i) {
      const { pathElements, leafIndex } = tree.proof(i);
      return { idSecret: ASP_SECRETS[i], pathElements, leafIndex };
    },
  };
}

// CLI: print the root (and a 32-byte hex for the contract constructor).
if (import.meta.url === `file://${process.argv[1]}`) {
  const asp = await buildAsp();
  const hex = asp.root.toString(16).padStart(64, "0");
  console.log(JSON.stringify({ root: asp.root.toString(), rootHex: hex }, null, 2));
}
