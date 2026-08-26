import { describe, expect, it, vi } from "vitest";
import { authErrorMessage } from "@/lib/auth/errors";
import { ApiError } from "@/lib/api";

/**
 * What somebody is told when something fails.
 *
 * Nearly every caller of this hands it a failure from our own API — the kitchen
 * board, the order screens, the admin settings, sending a week — and those
 * carry a sentence the server wrote on purpose. They were all being replaced
 * with "Something went wrong. Please try again.", so a week refused because the
 * cutoff had passed said nothing about a cutoff, and one screen had already
 * grown a local workaround to get its own message back.
 */
describe("turning a failure into something to act on", () => {
  it("keeps the message our own API sent", () => {
    expect(authErrorMessage(new ApiError(409, "Negrita is not taking orders at the moment.")))
      .toBe("Negrita is not taking orders at the moment.");
    expect(authErrorMessage(new ApiError(404, "That plan does not exist.")))
      .toBe("That plan does not exist.");
  });

  it("still prefers a known Firebase code over the raw message", () => {
    // Firebase's own wording leaks internals, which is why the map exists.
    const firebase = Object.assign(new Error("Firebase: Error (auth/wrong-password)."),
      { code: "auth/wrong-password" });
    expect(authErrorMessage(firebase)).toBe("That password is not right.");
  });

  it("falls back to something neutral for anything else", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(authErrorMessage(new TypeError("undefined is not a function")))
        .toBe("Something went wrong. Please try again.");
      // An API error with nothing in it has nothing to say either.
      expect(authErrorMessage(new ApiError(500, "")))
        .toBe("Something went wrong. Please try again.");
    } finally {
      logged.mockRestore();
    }
  });
});
