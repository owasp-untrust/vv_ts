import { describe, expect, it } from "vitest";
import {
  InternalValidationError, SchemaDefinitionError, ValidationError, classifications,
  boundedValue, defineUncheckedCustomArchetype, defineUncheckedCustomDisclosure,
  defineTypes, disclosures, issue, multiline, noAdditionalValidation, object,
  parseFailure, parsed, regexString, singleLine
} from "../src/index.js";

const types = defineTypes({
  Username: {
    archetype: regexString({
      normalize: value => value.trim().toLowerCase(),
      bounds: { minimum: 3, maximum: 40 },
      pattern: /^[a-z][a-z0-9-]*$/,
      validateAdditional: value => value === "admin" ? issue("username.reserved", "The username is reserved.") : null
    }),
    classification: classifications.public(),
    disclosure: disclosures.public<string>()
  },
  DisplayName: {
    archetype: singleLine({ normalize: value => value.trim(), bounds: { minimum: 1, maximum: 80 }, allowTab: false, allowOtherSymbols: false, requirePathSafeText: false, validateAdditional: noAdditionalValidation }),
    classification: classifications.pii(),
    disclosure: disclosures.redacted<string>()
  }
});

describe("named validated values", () => {
  it("constructs only through validation and normalization", () => {
    const username = types.Username("  Alice-1  ");
    expect(username.exposeUnchecked()).toBe("alice-1");
    expect(username.toPublicString()).toBe("alice-1");
    expect(Object.isFrozen(username)).toBe(true);
    expect(types.Username.is(username)).toBe(true);
    expect(() => types.Username("1!")).toThrow(ValidationError);
    expect(types.Username.safeParse("admin")).toMatchObject({ success: false, issues: [{ code: "username.reserved" }] });
  });

  it("separates classification from disclosure", () => {
    const value = types.DisplayName("Alice");
    expect(value.classification.kind).toBe("pii");
    expect(value.exposeUnchecked()).toBe("Alice");
    expect(value.toString()).toBe("[REDACTED]");
    expect(JSON.stringify(value)).toBe('"[REDACTED]"');
  });

  it("validates raw and normalized lengths and single-line content", () => {
    expect(types.Username.safeParse("  ab  ")).toMatchObject({ success: false, issues: [{ code: "string.length" }] });
    expect(types.DisplayName.safeParse("a\nb")).toMatchObject({ success: false, issues: [{ code: "string.line_break" }] });
  });

  it("enforces the line-text Unicode whitelist and NFC normalization", () => {
    expect(types.DisplayName("Cafe\u0301").exposeUnchecked()).toBe("Café");
    expect(types.DisplayName.safeParse("hello\u0000world")).toMatchObject({ success: false, issues: [{ code: "string.character" }] });
    expect(types.DisplayName.safeParse("hello\ue000world")).toMatchObject({ success: false, issues: [{ code: "string.character" }] });
    expect(types.DisplayName.safeParse("hello 😀")).toMatchObject({ success: false, issues: [{ code: "string.character" }] });
    expect(types.DisplayName.safeParse("\ud800")).toMatchObject({ success: false, issues: [{ code: "string.utf16" }] });
  });

  it("normalizes multiline input and enforces parsed-value bounds", () => {
    const Notes = multiline({ normalize: value => value, bounds: { minimum: 1, maximum: 20 }, allowTab: false, allowOtherSymbols: false, requirePathSafeText: false, validateAdditional: noAdditionalValidation });
    expect(Notes.validate("a\r\nb", { typeName: "Notes" })).toMatchObject({ success: true, value: "a\nb" });
    expect(Notes.validate("a\tb", { typeName: "Notes" })).toMatchObject({ success: false, issues: [{ code: "string.tab" }] });

    const Day = boundedValue({
      rawInputLengthBounds: { minimum: 10, maximum: 10 }, valueBounds: { minimum: 1, maximum: 31 },
      parse: raw => /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? parsed(Number(raw.slice(8))) : parseFailure(issue("date.syntax", "The date syntax is invalid.")),
      compare: (left, right) => left - right, normalize: value => value, validateAdditional: noAdditionalValidation
    });
    expect(Day.validate("2026-08-20", { typeName: "Day" })).toMatchObject({ success: true, value: 20 });
    expect(Day.validate("2026-08-00", { typeName: "Day" })).toMatchObject({ success: false, issues: [{ code: "value.bounds" }] });
    expect(Day.validate("x", { typeName: "Day" })).toMatchObject({ success: false, issues: [{ code: "value.raw_length" }] });
  });

  it("is Standard Schema-native and closes composite objects", async () => {
    const schema = object({ username: types.Username, displayName: types.DisplayName });
    expect(schema["~standard"].vendor).toBe("@untrust/vv");
    await expect(schema["~standard"].validate({ username: " Alice ", displayName: "Alice" }))
      .resolves.toMatchObject({ value: { username: expect.anything(), displayName: expect.anything() } });
    await expect(schema["~standard"].validate({ username: "alice", displayName: "Alice", admin: true }))
      .resolves.toMatchObject({ issues: [{ path: ["admin"] }] });
  });

  it("keeps cross-validation candidates distinct until a receiver accepts them", async () => {
    const prepared = types.Username.prepare("alice");
    expect(prepared.success).toBe(true);
    if (!prepared.success) return;
    expect(prepared.value.crossValidate(value => value === "alice" ? issue("username.taken", "The username is already in use.") : null))
      .toMatchObject({ success: false, issues: [{ code: "username.taken" }] });
    const accepted = await prepared.value.crossValidateAsync(async value => value === "alice" ? null : issue("username.missing", "The username does not exist."));
    expect(accepted).toMatchObject({ success: true });
    if (accepted.success) expect(accepted.value.exposeUnchecked()).toBe("alice");
  });

  it("supports developer-defined archetypes and disclosures", () => {
    const evenInteger = defineUncheckedCustomArchetype({
      kind: "example.even-integer", details: { primitive: "number" },
      validate: input => typeof input === "number" && Number.isInteger(input) && input % 2 === 0
        ? { success: true, value: input }
        : { success: false, issues: [issue("number.not_even", "The value must be an even integer.")] }
    });
    const hexadecimal = defineUncheckedCustomDisclosure<number, string>({ kind: "example.hex", toPublicValue: value => value.toString(16), toPublicString: value => `0x${value.toString(16)}` });
    const custom = defineTypes({ EvenPort: { archetype: evenInteger, classification: classifications.internal(), disclosure: hexadecimal } });
    expect(custom.EvenPort(42).toPublicString()).toBe("0x2a");
    expect(() => custom.EvenPort(41)).toThrow(ValidationError);
  });

  it("rejects invalid definitions and normalizes unexpected extension exceptions", () => {
    expect(() => regexString({ normalize: value => value, bounds: { minimum: 5, maximum: 2 }, pattern: /x/, validateAdditional: noAdditionalValidation })).toThrow(SchemaDefinitionError);
    expect(() => regexString({ normalize: value => value, bounds: { minimum: 1, maximum: 2 }, pattern: /x/g, validateAdditional: noAdditionalValidation })).toThrow(SchemaDefinitionError);
    const broken = defineUncheckedCustomArchetype<string>({ kind: "example.broken", details: { primitive: "string" }, validate() { throw new Error("implementation detail"); } });
    const brokenTypes = defineTypes({ Broken: { archetype: broken, classification: classifications.internal(), disclosure: disclosures.redacted<string>() } });
    expect(() => brokenTypes.Broken("secret input")).toThrow(InternalValidationError);
  });
});
