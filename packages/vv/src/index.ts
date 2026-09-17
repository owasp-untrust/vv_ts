/**
 * Standard Schema is structural. VV intentionally owns this declaration so it
 * remains independently installable from consumers such as Mandate.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}
export namespace StandardSchemaV1 {
  export type Issue = { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined };
  export type Result<T> = { readonly value: T; readonly issues?: undefined } | { readonly issues: ReadonlyArray<Issue> };
}

const VALUE_BRAND: unique symbol = Symbol("@untrust/vv/value");
const VALUE_PRIMITIVE: unique symbol = Symbol("@untrust/vv/primitive");
const TRUSTED_ARCHETYPE: unique symbol = Symbol("@untrust/vv/trusted-archetype");
const TRUSTED_DISCLOSURE: unique symbol = Symbol("@untrust/vv/trusted-disclosure");
const VV_SCHEMAS = new WeakSet<object>();

/** Returns true only for schemas constructed by this installed @untrust/vv copy. */
export function isVvSchema(schema: unknown): schema is StandardSchemaV1 {
  return (typeof schema === "object" || typeof schema === "function") && schema !== null && VV_SCHEMAS.has(schema as object);
}

export interface ValidationIssue { readonly code: string; readonly message: string; readonly path?: readonly PropertyKey[] | undefined }
export class ValidationError extends Error {
  readonly name = "ValidationError";
  constructor(public readonly issues: readonly ValidationIssue[]) { super(issues[0]?.message ?? "Value validation failed"); }
}
export class SchemaDefinitionError extends Error { readonly name = "SchemaDefinitionError"; }
export class InternalValidationError extends Error { readonly name = "InternalValidationError"; }
export type ValidationResult<T> = { readonly success: true; readonly value: T } | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export function issue(code: string, message: string): ValidationIssue {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i.test(code)) throw new SchemaDefinitionError("Issue codes must be stable dotted identifiers");
  if (!message.trim()) throw new SchemaDefinitionError("Issue messages cannot be empty");
  return Object.freeze({ code, message });
}

export type ValueDescription =
  | { readonly kind: "bounded-string" | "single-line" | "multiline"; readonly bounds: StringBounds }
  | { readonly kind: "regex-string"; readonly bounds: StringBounds; readonly pattern: string }
  | { readonly kind: "bounded-value"; readonly rawInputLengthBounds: StringBounds }
  | { readonly kind: "unchecked-custom"; readonly details?: Readonly<Record<string, unknown>> };
export interface ArchetypeContext { readonly typeName: string }
export interface Archetype<T> {
  readonly kind: string; readonly description: Readonly<ValueDescription>; readonly [TRUSTED_ARCHETYPE]: true;
  validate(input: unknown, context: ArchetypeContext): ValidationResult<T>;
}
function sealArchetype<T>(definition: { readonly kind: string; readonly description: ValueDescription; validate(input: unknown, context: ArchetypeContext): ValidationResult<T> }): Archetype<T> {
  if (!definition.kind.trim()) throw new SchemaDefinitionError("Archetype kind cannot be empty");
  if (typeof definition.validate !== "function") throw new SchemaDefinitionError("An archetype requires validate()");
  return Object.freeze({ ...definition, description: Object.freeze({ ...definition.description }), [TRUSTED_ARCHETYPE]: true as const });
}
export function defineUncheckedCustomArchetype<T>(definition: { readonly kind: string; readonly details?: Readonly<Record<string, unknown>>; validate(input: unknown, context: ArchetypeContext): ValidationResult<T> }): Archetype<T> {
  return sealArchetype({ kind: definition.kind, description: { kind: "unchecked-custom", ...(definition.details ? { details: definition.details } : {}) }, validate: definition.validate });
}

export interface Classification { readonly kind: string; readonly metadata?: Readonly<Record<string, unknown>> | undefined }
export function defineClassification(kind: string, metadata?: Readonly<Record<string, unknown>>): Classification {
  if (!kind.trim()) throw new SchemaDefinitionError("Classification kind cannot be empty");
  return Object.freeze({ kind, ...(metadata ? { metadata: Object.freeze({ ...metadata }) } : {}) });
}
export const classifications = Object.freeze({
  public: () => defineClassification("public"), internal: () => defineClassification("internal"),
  pii: () => defineClassification("pii"), secret: () => defineClassification("secret")
});

export interface DisclosurePolicy<T, TPublic> {
  readonly kind: string; readonly [TRUSTED_DISCLOSURE]: true;
  toPublicValue(value: T): TPublic; toPublicString(value: T): string;
}
export function defineUncheckedCustomDisclosure<T, TPublic>(definition: { readonly kind: string; toPublicValue(value: T): TPublic; toPublicString(value: T): string }): DisclosurePolicy<T, TPublic> {
  if (!definition.kind.trim()) throw new SchemaDefinitionError("Disclosure kind cannot be empty");
  return Object.freeze({ ...definition, [TRUSTED_DISCLOSURE]: true as const });
}
export const disclosures = Object.freeze({
  public: <T>(): DisclosurePolicy<T, T> => defineUncheckedCustomDisclosure({ kind: "public", toPublicValue: value => value, toPublicString: value => String(value) }),
  redacted: <T>(text = "[REDACTED]"): DisclosurePolicy<T, string> => defineUncheckedCustomDisclosure({ kind: "redacted", toPublicValue: () => text, toPublicString: () => text }),
  masked: <T, TPublic>(maskValue: (value: T) => TPublic, maskString: (value: T) => string): DisclosurePolicy<T, TPublic> => defineUncheckedCustomDisclosure({ kind: "masked", toPublicValue: maskValue, toPublicString: maskString })
});

export interface ValidatedValue<T, TName extends string, TPublic> {
  readonly [VALUE_BRAND]: TName; readonly [VALUE_PRIMITIVE]: T; readonly typeName: TName; readonly classification: Classification;
  exposeUnchecked(): T; toPublicValue(): TPublic; toPublicString(): string; toString(): string; toJSON(): TPublic;
}
export interface CrossValidationCandidate<TValue, TPrimitive> {
  crossValidate(check: (locallyValidated: TPrimitive) => ValidationIssue | null): ValidationResult<TValue>;
  crossValidateAsync(check: (locallyValidated: TPrimitive) => Promise<ValidationIssue | null>): Promise<ValidationResult<TValue>>;
}
export interface ValueType<TValue, TPrimitive = unknown> extends StandardSchemaV1<unknown, TValue> {
  (input: unknown): TValue;
  readonly typeName: string; readonly description: Readonly<ValueDescription>;
  parse(input: unknown): TValue; safeParse(input: unknown): ValidationResult<TValue>;
  prepare(input: unknown): ValidationResult<CrossValidationCandidate<TValue, TPrimitive>>;
  is(input: unknown): input is TValue;
}
export type InferValue<S> = S extends ValueType<infer V, any> ? V : never;
type AnyArchetype = Archetype<any>; type AnyDisclosure = DisclosurePolicy<any, any>;
export interface TypeDefinition<A extends AnyArchetype, D extends AnyDisclosure> { readonly archetype: A; readonly classification: Classification; readonly disclosure: D }
type ArchetypeOutput<A> = A extends Archetype<infer T> ? T : never;
type DisclosureOutput<D> = D extends DisclosurePolicy<any, infer P> ? P : never;
type DefinedValue<N extends string, D> = D extends TypeDefinition<infer A, infer P> ? ValidatedValue<ArchetypeOutput<A>, N, DisclosureOutput<P>> : never;
export type DefinedTypes<D extends Record<string, TypeDefinition<AnyArchetype, AnyDisclosure>>> = { readonly [N in keyof D & string]: ValueType<DefinedValue<N, D[N]>, ArchetypeOutput<D[N]["archetype"]>> };

function checkedResult<T>(result: ValidationResult<T>): ValidationResult<T> {
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") throw new InternalValidationError("Archetype returned an invalid result");
  if (!result.success && (!Array.isArray(result.issues) || result.issues.length === 0)) throw new InternalValidationError("Failed validation requires at least one issue");
  return result;
}
function createValueType<N extends string, A extends AnyArchetype, D extends AnyDisclosure>(name: N, definition: TypeDefinition<A, D>): ValueType<DefinedValue<N, TypeDefinition<A, D>>, ArchetypeOutput<A>> {
  if (!definition.archetype?.[TRUSTED_ARCHETYPE]) throw new SchemaDefinitionError(`${name} requires a trusted archetype`);
  if (!definition.disclosure?.[TRUSTED_DISCLOSURE]) throw new SchemaDefinitionError(`${name} requires a trusted disclosure`);
  if (!definition.classification?.kind) throw new SchemaDefinitionError(`${name} requires a classification`);
  type Output = DefinedValue<N, TypeDefinition<A, D>>;
  const finish = (primitive: ArchetypeOutput<A>): Output => {
    const value = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(value, {
      [VALUE_BRAND]: { value: name }, [VALUE_PRIMITIVE]: { value: primitive }, typeName: { value: name, enumerable: true },
      classification: { value: definition.classification, enumerable: true }, exposeUnchecked: { value: () => primitive },
      toPublicValue: { value: () => definition.disclosure.toPublicValue(primitive) }, toPublicString: { value: () => definition.disclosure.toPublicString(primitive) },
      toString: { value: () => definition.disclosure.toPublicString(primitive) }, toJSON: { value: () => definition.disclosure.toPublicValue(primitive) }
    });
    return Object.freeze(value) as unknown as Output;
  };
  const prepare = (input: unknown): ValidationResult<CrossValidationCandidate<Output, ArchetypeOutput<A>>> => {
    let result: ValidationResult<ArchetypeOutput<A>>;
    try { result = checkedResult(definition.archetype.validate(input, { typeName: name })); }
    catch (error) {
      if (error instanceof ValidationError) return { success: false, issues: error.issues };
      throw new InternalValidationError(`Archetype ${definition.archetype.kind} threw unexpectedly`, { cause: error });
    }
    if (!result.success) return result;
    const primitive = result.value;
    const candidate: CrossValidationCandidate<Output, ArchetypeOutput<A>> = Object.freeze({
      crossValidate(check: (value: ArchetypeOutput<A>) => ValidationIssue | null): ValidationResult<Output> {
        const problem = check(primitive);
        return problem ? { success: false, issues: [problem] } : { success: true, value: finish(primitive) };
      },
      async crossValidateAsync(check: (value: ArchetypeOutput<A>) => Promise<ValidationIssue | null>): Promise<ValidationResult<Output>> {
        const problem = await check(primitive);
        return problem ? { success: false, issues: [problem] } : { success: true, value: finish(primitive) };
      }
    });
    return { success: true, value: candidate };
  };
  const safeParse = (input: unknown): ValidationResult<Output> => {
    const candidate = prepare(input);
    return candidate.success ? candidate.value.crossValidate(() => null) : candidate;
  };
  const parse = (input: unknown): Output => { const result = safeParse(input); if (!result.success) throw new ValidationError(result.issues); return result.value; };
  const callable = ((input: unknown) => parse(input)) as ValueType<Output, ArchetypeOutput<A>>;
  Object.defineProperties(callable, {
    typeName: { value: name, enumerable: true }, description: { value: definition.archetype.description, enumerable: true }, parse: { value: parse }, safeParse: { value: safeParse }, prepare: { value: prepare },
    is: { value: (input: unknown) => Boolean(input && typeof input === "object" && (input as Record<PropertyKey, unknown>)[VALUE_BRAND] === name) },
    "~standard": { value: Object.freeze({ version: 1 as const, vendor: "@untrust/vv", validate: (input: unknown) => { const result = safeParse(input); return result.success ? { value: result.value } : { issues: result.issues.map(item => ({ message: item.message, path: item.path })) }; } }) }
  });
  const schema = Object.freeze(callable);
  VV_SCHEMAS.add(schema);
  return schema;
}
export function defineTypes<const D extends Record<string, TypeDefinition<AnyArchetype, AnyDisclosure>>>(definitions: D): DefinedTypes<D> {
  const output: Record<string, ValueType<any>> = Object.create(null);
  for (const [name, definition] of Object.entries(definitions)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new SchemaDefinitionError(`Type name ${name} must be PascalCase`);
    output[name] = createValueType(name, definition);
  }
  return Object.freeze(output) as DefinedTypes<D>;
}

export interface StringBounds { readonly minimum: number; readonly maximum: number }
function checkBounds(bounds: StringBounds): void {
  if (!Number.isSafeInteger(bounds.minimum) || !Number.isSafeInteger(bounds.maximum) || bounds.minimum < 0 || bounds.minimum > bounds.maximum) throw new SchemaDefinitionError("String bounds require non-negative integers with minimum <= maximum");
}
export interface ComparableBounds<T> { readonly minimum: T; readonly maximum: T }
export type ParseResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issue: ValidationIssue };
export const parsed = <T>(value: T): ParseResult<T> => ({ success: true, value });
export const parseFailure = (problem: ValidationIssue): ParseResult<never> => ({ success: false, issue: problem });
export interface ValidationTraits<T> {
  readonly normalize: (value: T) => T;
  readonly validateAdditional: (value: T) => ValidationIssue | null;
}
export interface LineTextTraits extends ValidationTraits<string> {
  readonly bounds: StringBounds;
  readonly allowTab: boolean;
  readonly allowOtherSymbols: boolean;
  readonly requirePathSafeText: boolean;
}
export const identity = <T>(value: T): T => value;
export const noAdditionalValidation = (): null => null;
export function regexString(options: ValidationTraits<string> & { readonly bounds: StringBounds; readonly pattern: RegExp }): Archetype<string> {
  checkBounds(options.bounds);
  if (options.pattern.global || options.pattern.sticky) throw new SchemaDefinitionError("Stateful global/sticky regular expressions are not supported");
  const pattern = new RegExp(`^(?:${options.pattern.source})$`, options.pattern.flags);
  return sealArchetype({ kind: "regex-string", description: { kind: "regex-string", bounds: options.bounds, pattern: pattern.source }, validate(input) {
    if (typeof input !== "string") return { success: false, issues: [issue("value.invalid_type", "The value must be a string.")] };
    if (input.length < options.bounds.minimum || input.length > options.bounds.maximum) return { success: false, issues: [issue("string.raw_length", "The raw string length is outside the allowed range.")] };
    const value = options.normalize(input); if (typeof value !== "string") throw new InternalValidationError("Normalization did not return a string");
    if (value.length < options.bounds.minimum || value.length > options.bounds.maximum) return { success: false, issues: [issue("string.length", "The normalized string length is outside the allowed range.")] };
    if (!pattern.test(value)) return { success: false, issues: [issue("string.pattern", "The value has an invalid format.")] };
    const additional = options.validateAdditional(value); return additional ? { success: false, issues: [additional] } : { success: true, value };
  }});
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= value.length) return false;
      const low = value.charCodeAt(index);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;
const PUNCTUATION_OR_SAFE_SYMBOL = /[\p{P}\p{Sm}\p{Sc}]/u;
const OTHER_SYMBOL = /\p{So}/u;
function validateLineCharacters(value: string, options: LineTextTraits, multiline: boolean): ValidationIssue | null {
  let hasBase = false;
  for (const character of value) {
    if (character === "\n") { if (multiline) { hasBase = false; continue; } return issue("string.line_break", "Line breaks are not allowed."); }
    if (character === "\t") { if (options.allowTab) { hasBase = false; continue; } return issue("string.tab", "Tabs are not allowed."); }
    if (character === " ") { hasBase = false; continue; }
    if (LETTER_OR_NUMBER.test(character) || PUNCTUATION_OR_SAFE_SYMBOL.test(character)) { hasBase = true; continue; }
    if (MARK.test(character)) { if (hasBase) continue; return issue("string.combining_mark", "A combining mark must follow a base character."); }
    if (OTHER_SYMBOL.test(character) && options.allowOtherSymbols) { hasBase = true; continue; }
    return issue("string.character", "The value contains a character outside the allowed Unicode categories.");
  }
  if (options.requirePathSafeText) {
    if (/[<>:"|?*]/u.test(value)) return issue("string.path_character", "The value contains a path-unsafe character.");
    if (value.split(/[\\/]/u).some(segment => segment === "." || segment === "..")) return issue("string.path_segment", "Dot path segments are not allowed.");
  }
  return null;
}
function lineText(kind: "single-line" | "multiline", options: LineTextTraits): Archetype<string> {
  checkBounds(options.bounds);
  return sealArchetype({ kind, description: { kind, bounds: options.bounds }, validate(input) {
    if (typeof input !== "string") return { success: false, issues: [issue("value.invalid_type", "The value must be a string.")] };
    if (input.length < options.bounds.minimum || input.length > options.bounds.maximum) return { success: false, issues: [issue("string.raw_length", "The raw string length is outside the allowed range.")] };
    if (!isWellFormedUtf16(input)) return { success: false, issues: [issue("string.utf16", "The value is not well-formed UTF-16.")] };
    const lineNormalized = kind === "multiline" ? input.replace(/\r\n?/gu, "\n") : input;
    const normalized = options.normalize(lineNormalized); if (typeof normalized !== "string") throw new InternalValidationError("Normalization did not return a string");
    const value = normalized.normalize("NFC");
    if (value.length < options.bounds.minimum || value.length > options.bounds.maximum) return { success: false, issues: [issue("string.length", "The normalized string length is outside the allowed range.")] };
    const characterIssue = validateLineCharacters(value, options, kind === "multiline");
    if (characterIssue) return { success: false, issues: [characterIssue] };
    const additional = options.validateAdditional(value); return additional ? { success: false, issues: [additional] } : { success: true, value };
  }});
}
export function singleLine(options: LineTextTraits): Archetype<string> { return lineText("single-line", options); }
export function multiline(options: LineTextTraits): Archetype<string> { return lineText("multiline", options); }

export interface BoundedValueTraits<T> extends ValidationTraits<T> {
  readonly rawInputLengthBounds: StringBounds;
  readonly valueBounds: ComparableBounds<T>;
  readonly parse: (raw: string) => ParseResult<T>;
  readonly compare: (left: T, right: T) => number;
}
export function boundedValue<T>(options: BoundedValueTraits<T>): Archetype<T> {
  checkBounds(options.rawInputLengthBounds);
  if (options.compare(options.valueBounds.minimum, options.valueBounds.maximum) > 0) throw new SchemaDefinitionError("Value bounds require minimum <= maximum");
  return sealArchetype({ kind: "bounded-value", description: { kind: "bounded-value", rawInputLengthBounds: options.rawInputLengthBounds }, validate(input) {
    if (typeof input !== "string") return { success: false, issues: [issue("value.invalid_type", "The serialized value must be a string.")] };
    const raw = options.rawInputLengthBounds;
    if (input.length < raw.minimum || input.length > raw.maximum) return { success: false, issues: [issue("value.raw_length", "The serialized value length is outside the allowed range.")] };
    const parseResult = options.parse(input);
    if (!parseResult.success) return { success: false, issues: [parseResult.issue] };
    const value = options.normalize(parseResult.value);
    if (options.compare(value, options.valueBounds.minimum) < 0 || options.compare(value, options.valueBounds.maximum) > 0) return { success: false, issues: [issue("value.bounds", "The parsed value is outside the allowed range.")] };
    const additional = options.validateAdditional(value);
    return additional ? { success: false, issues: [additional] } : { success: true, value };
  }});
}

type SchemaOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : never;
export interface ObjectSchema<S extends Record<string, StandardSchemaV1>> extends StandardSchemaV1<unknown, { readonly [K in keyof S]: SchemaOutput<S[K]> }> {}
export function object<const S extends Record<string, StandardSchemaV1>>(shape: S, options: { unknownProperties: "reject" | "strip" } = { unknownProperties: "reject" }): ObjectSchema<S> {
  const entries = Object.entries(shape);
  const schema = Object.freeze({ "~standard": Object.freeze({ version: 1 as const, vendor: "@untrust/vv", async validate(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { issues: [{ message: "The value must be an object." }] };
    const source = input as Record<string, unknown>; const output: Record<string, unknown> = Object.create(null); const issues: Array<{ message: string; path?: readonly PropertyKey[] }> = [];
    if (options.unknownProperties === "reject") for (const key of Object.keys(source)) if (!Object.hasOwn(shape, key)) issues.push({ message: "Unknown properties are not allowed.", path: [key] });
    for (const [key, schema] of entries) { const result = await schema["~standard"].validate(source[key]); if (result.issues) for (const child of result.issues) issues.push({ message: child.message, path: [key, ...(child.path ?? [])].map(part => typeof part === "object" ? part.key : part) }); else output[key] = result.value; }
    return issues.length ? { issues } : { value: Object.freeze(output) as { readonly [K in keyof S]: SchemaOutput<S[K]> } };
  } }) });
  VV_SCHEMAS.add(schema);
  return schema;
}
