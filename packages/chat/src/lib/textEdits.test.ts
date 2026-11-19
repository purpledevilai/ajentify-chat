import { describe, expect, it } from "vitest";
import {
  applyEdits,
  EDIT_OPERATIONS,
  EDITS_FIELD_DESCRIPTION,
  EDITS_SCHEMA,
  TextEditError,
  type EditOperation,
} from "../index";

const TEXT = "Hello world.\nThe quick brown fox.\nGoodbye world.";

function fail(text: string, edits: unknown): TextEditError {
  try {
    applyEdits(text, edits as EditOperation[]);
  } catch (err) {
    if (err instanceof TextEditError) return err;
    throw err;
  }
  throw new Error("expected applyEdits to throw");
}

describe("applyEdits", () => {
  it("replaces an exact target", () => {
    const { text, summary } = applyEdits(TEXT, [{ operation: "replace", target: "quick", content: "slow" }]);
    expect(text).toBe("Hello world.\nThe slow brown fox.\nGoodbye world.");
    expect(summary).toEqual({ replaced: 1, inserted_before: 0, inserted_after: 0, deleted: 0 });
  });

  it("inserts before an anchor", () => {
    const { text, summary } = applyEdits(TEXT, [{ operation: "insert_before", anchor: "The quick", content: "Note: " }]);
    expect(text).toBe("Hello world.\nNote: The quick brown fox.\nGoodbye world.");
    expect(summary.inserted_before).toBe(1);
  });

  it("inserts after an anchor", () => {
    const { text, summary } = applyEdits(TEXT, [{ operation: "insert_after", anchor: "fox.", content: " Jumped." }]);
    expect(text).toBe("Hello world.\nThe quick brown fox. Jumped.\nGoodbye world.");
    expect(summary.inserted_after).toBe(1);
  });

  it("deletes a target and ignores content", () => {
    const { text, summary } = applyEdits(TEXT, [{ operation: "delete", target: "quick ", content: "ignored" }]);
    expect(text).toBe("Hello world.\nThe brown fox.\nGoodbye world.");
    expect(summary.deleted).toBe(1);
  });

  it("applies edits in order, later edits may reference earlier output", () => {
    const { text, summary } = applyEdits("a b c", [
      { operation: "replace", target: "b", content: "B!" },
      { operation: "insert_after", anchor: "B!", content: "?" },
      { operation: "delete", target: "a " },
    ]);
    expect(text).toBe("B!? c");
    expect(summary).toEqual({ replaced: 1, inserted_before: 0, inserted_after: 1, deleted: 1 });
  });

  it("is forgiving about target/anchor mix-ups", () => {
    expect(applyEdits("x y", [{ operation: "replace", anchor: "x", content: "z" }]).text).toBe("z y");
    expect(applyEdits("x y", [{ operation: "insert_after", target: "x", content: "!" }]).text).toBe("x! y");
  });

  it("throws target_not_found with match_count 0", () => {
    const err = fail(TEXT, [{ operation: "replace", target: "QUICK", content: "x" }]);
    expect(err.code).toBe("target_not_found");
    expect(err.details).toEqual({ edit_index: 0, match_count: 0 });
    expect(err.message).toContain("edit 0 was not found");
  });

  it("throws ambiguous_target with contexts (ellipses, max 3)", () => {
    const err = fail(TEXT, [{ operation: "delete", target: "world" }]);
    expect(err.code).toBe("ambiguous_target");
    expect(err.details.match_count).toBe(2);
    const contexts = err.details.contexts as string[];
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toBe("Hello world.\nThe quick brown fox.\nGoodbye world.");
    expect(contexts[1]).toBe("...llo world.\nThe quick brown fox.\nGoodbye world.");
    expect(err.message).toContain("occurred 2 times");

    const long = `${"x".repeat(100)}aa${"y".repeat(100)}aa${"z".repeat(100)}aa${"w".repeat(100)}aa`;
    const err2 = fail(long, [{ operation: "delete", target: "aa" }]);
    expect(err2.details.match_count).toBe(4);
    const ctx2 = err2.details.contexts as string[];
    expect(ctx2).toHaveLength(3);
    expect(ctx2[0]).toBe(`...${"x".repeat(40)}aa${"y".repeat(40)}...`);
  });

  it("counts overlapping occurrences", () => {
    const err = fail("aaa", [{ operation: "delete", target: "aa" }]);
    expect(err.code).toBe("ambiguous_target");
    expect(err.details.match_count).toBe(2);
  });

  it("reports the first failing edit and leaves nothing applied", () => {
    const err = fail(TEXT, [
      { operation: "replace", target: "quick", content: "slow" },
      { operation: "delete", target: "nope" },
    ]);
    expect(err.code).toBe("target_not_found");
    expect(err.details.edit_index).toBe(1);
  });

  it("throws invalid_edit for bad shapes", () => {
    expect(fail(TEXT, ["nope"]).message).toBe("Edit 0 must be an object.");
    const op = fail(TEXT, [{ operation: "upsert", target: "x" }]);
    expect(op.code).toBe("invalid_edit");
    expect(op.message).toBe("Edit 0: operation must be one of replace, insert_before, insert_after, delete.");
    expect(op.details).toEqual({ edit_index: 0, operation: "upsert" });
    expect(fail(TEXT, [{ operation: "replace", content: "x" }]).message).toBe("Edit 0: 'target' must be a non-empty string.");
    expect(fail(TEXT, [{ operation: "insert_after", anchor: "", content: "x" }]).message).toBe(
      "Edit 0: 'anchor' must be a non-empty string.",
    );
    expect(fail(TEXT, [{ operation: "replace", target: "quick" }]).message).toBe("Edit 0: 'content' must be a string.");
    expect(fail(TEXT, [{ operation: "insert_before", anchor: "quick", content: "" }]).message).toBe(
      "Edit 0: 'content' must be non-empty for insert_before.",
    );
    expect(fail(TEXT, [{ operation: "replace", target: "quick", content: 5 }]).code).toBe("invalid_edit");
    const notString = fail(5 as unknown as string, [{ operation: "delete", target: "x" }]);
    expect(notString.code).toBe("invalid_edit");
    expect(notString.message).toBe("text must be a string.");
  });

  it("throws empty_edits for an empty or non-array list", () => {
    expect(fail(TEXT, []).code).toBe("empty_edits");
    expect(fail(TEXT, null).code).toBe("empty_edits");
    expect(fail(TEXT, []).message).toBe("edits must be a non-empty list.");
  });

  it("does not mutate the input edits or text", () => {
    const edits: EditOperation[] = [{ operation: "replace", target: "quick", content: "slow" }];
    const snapshot = JSON.stringify(edits);
    const input = TEXT;
    applyEdits(input, edits);
    expect(input).toBe(TEXT);
    expect(JSON.stringify(edits)).toBe(snapshot);
  });

  it("TextEditError serialises via toJSON", () => {
    const err = fail(TEXT, []);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TextEditError");
    expect(JSON.parse(JSON.stringify(err))).toEqual({ code: "empty_edits", message: "edits must be a non-empty list.", details: {} });
  });
});

describe("EDITS_SCHEMA", () => {
  it("matches the canonical contract", () => {
    expect(EDIT_OPERATIONS).toEqual(["replace", "insert_before", "insert_after", "delete"]);
    expect(EDITS_SCHEMA.type).toBe("array");
    expect(EDITS_SCHEMA.minItems).toBe(1);
    expect(EDITS_SCHEMA["x-ajentify-type"]).toBe("edits");
    expect(EDITS_SCHEMA.items.required).toEqual(["operation"]);
    expect(EDITS_SCHEMA.items.additionalProperties).toBe(false);
    expect(EDITS_SCHEMA.items.properties.operation.enum).toEqual([...EDIT_OPERATIONS]);
    expect(Object.keys(EDITS_SCHEMA.items.properties)).toEqual(["operation", "target", "anchor", "content"]);
    expect(EDITS_FIELD_DESCRIPTION).toContain("occur exactly once");
  });
});
