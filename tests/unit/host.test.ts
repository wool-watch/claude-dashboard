import { describe, expect, it } from "vitest";
import { isAllowedHost } from "@/lib/api/host";

describe("isAllowedHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.1:3947",
    "localhost",
    "localhost:3947",
    "LOCALHOST:3947",
    "[::1]",
    "[::1]:3947",
  ])("ループバック由来の Host を許可する: %s", (host) => {
    expect(isAllowedHost(host)).toBe(true);
  });

  it.each([
    "attacker.com",
    "attacker.com:3947",
    "192.168.1.10:3947",
    "127.0.0.1.evil.com",
    "localhost.evil.com",
    "localhost:evil",
    "127.0.0.1:3947:extra",
    "",
  ])("ループバック以外の Host を拒否する（DNSリバインディング対策）: %s", (host) => {
    expect(isAllowedHost(host)).toBe(false);
  });

  it("Host ヘッダ欠落（null）は拒否する", () => {
    expect(isAllowedHost(null)).toBe(false);
  });
});
