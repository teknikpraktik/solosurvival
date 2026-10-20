import { describe, expect, it } from "vitest";
import { isCleanLoop, streetOf } from "@/routes/generate";


const step = (edgeId: string, dir: 1 | -1 = 1) => ({ edgeId, dir });
const ctx = (startEdge: string) => ({ g: undefined as never, an: undefined as never, start: { edgeId: startEdge, distM: 10 } });

describe("isCleanLoop", () => {
  const none = new Set<string>();
  it("accepts a simple loop; the start edge may be used twice in the same direction (both halves)", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("4:0"), step("1:0")], none)).toBe(true);
  });
  it("rejects turning back (dead end): the same edge both ways", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("3:0", -1), step("2:0", -1), step("4:0")], none)).toBe(false);
  });
  it("rejects the start edge walked back over itself (opposite directions)", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("2:0"), step("3:0"), step("1:0", -1)], none)).toBe(false);
  });
  it("rejects using the same street twice, even on different edges and with other streets in between", () => {
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("7:0"), step("2:0"), step("7:1"), step("3:0"), step("1:0")], none)).toBe(false);
    expect(isCleanLoop(ctx("1:0"), [step("1:0"), step("7:0"), step("7:1"), step("2:0"), step("1:0")], none)).toBe(true); // one continuous stretch is fine
  });
  it("allows reuse inside the dead-end spur the start lies in (unavoidable)", () => {
    expect(isCleanLoop(ctx("9:0"), [step("9:0"), step("9:1"), step("2:0"), step("3:0"), step("9:1", -1), step("9:0", -1)], new Set(["9:0", "9:1"]))).toBe(true);
  });
  it("street key strips edge index and split part", () => {
    expect(streetOf("123:4")).toBe("123");
    expect(streetOf("123.2:0")).toBe("123");
  });
});
