import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type QrGrantMessage,
} from "@smartphonecracy/protocol";
import { shouldShowGrant } from "./shouldShowGrant.js";
import { placementClassName, qrSizePx } from "./placement.js";
import {
  TRACKED_QR_ERROR_CORRECTION_LEVEL,
  TRACKED_QR_MARGIN_MODULES,
} from "../idle/qrPresentation.js";

const grant = (overrides: Partial<QrGrantMessage> = {}): QrGrantMessage => ({
  t: "qr_grant",
  v: PROTOCOL_VERSION,
  url: "https://x.example/j?g=abc",
  expiresAt: 10_000,
  placement: "large",
  ...overrides,
});

describe("shouldShowGrant", () => {
  it("shows a grant before its expiry on corrected server time", () => {
    expect(shouldShowGrant(grant({ expiresAt: 10_000 }), 9_999, false)).toBe(true);
  });

  it("hides a grant once corrected server time reaches expiresAt", () => {
    expect(shouldShowGrant(grant({ expiresAt: 10_000 }), 10_000, false)).toBe(false);
    expect(shouldShowGrant(grant({ expiresAt: 10_000 }), 10_001, false)).toBe(false);
  });

  it("keeps showing a fresh replacement grant that arrived before the old one expired", () => {
    // Simulates: old grant expiresAt=10_000, a new one lands with
    // expiresAt=70_000 before corrected time reaches 10_000.
    const replacement = grant({ expiresAt: 70_000 });
    expect(shouldShowGrant(replacement, 10_500, false)).toBe(true);
  });

  it("hides immediately when qrHidden is set, regardless of expiry", () => {
    expect(shouldShowGrant(grant({ expiresAt: 999_999 }), 0, true)).toBe(false);
  });

  it("hides when there is no grant at all", () => {
    expect(shouldShowGrant(null, 0, false)).toBe(false);
  });
});

describe("placementClassName", () => {
  it("centers the large placement regardless of the configured corner", () => {
    expect(placementClassName("large", "top-left")).toBe("qr-badge-large");
    expect(placementClassName("large", "bottom-right")).toBe("qr-badge-large");
  });

  it("uses the configured corner for the corner placement", () => {
    expect(placementClassName("corner", "top-left")).toBe(
      "qr-badge-corner qr-badge-top-left",
    );
    expect(placementClassName("corner", "bottom-right")).toBe(
      "qr-badge-corner qr-badge-bottom-right",
    );
  });
});

describe("qrSizePx", () => {
  it("renders larger during idle/lobby than during corner placement", () => {
    expect(qrSizePx("large")).toBeGreaterThan(qrSizePx("corner"));
  });
});

describe("tracked QR presentation", () => {
  it("uses stronger correction and a standard quiet zone for projection", () => {
    expect(TRACKED_QR_ERROR_CORRECTION_LEVEL).toBe("Q");
    expect(TRACKED_QR_MARGIN_MODULES).toBe(4);
  });
});
