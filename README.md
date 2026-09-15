# `@untrust/vv`

`@untrust/vv` defines named domain values that cross an explicit runtime validation and normalization boundary. It implements Standard Schema and can be consumed by any compatible Node.js framework adapter.

```ts
import {
  classifications, defineTypes, disclosures, noAdditionalValidation,
  object, regexString
} from "@untrust/vv";

export const mytypes = defineTypes({
  Username: {
    archetype: regexString({
      normalize: value => value.trim().toLowerCase(),
      bounds: { minimum: 3, maximum: 40 },
      pattern: /^[a-z][a-z0-9-]*$/,
      validateAdditional: noAdditionalValidation
    }),
    classification: classifications.public(),
    disclosure: disclosures.public<string>()
  }
});

const username = mytypes.Username(" Alice ");
username.exposeUnchecked(); // "alice"
```

Definitions must choose both a classification and a disclosure policy. Built-in
archetypes own their security-critical sequence: raw bounds, parsing, trait
normalization, archetype validation, domain bounds, then additional validation.
Additional validation can reject a value but cannot bypass earlier checks.

`singleLine` and `multiline` require bounds and explicit tab, Unicode
`OtherSymbol`, and path-safety decisions. They reject malformed UTF-16 and
Unicode categories outside the library allowlist, normalize to NFC, and check
bounds again. `boundedValue` requires both serialized-input length bounds and
parsed-value bounds for numbers, dates, and other ordered domains.
`regexString` is full-match and bounded, but native JavaScript has no reliable
regex timeout; patterns must be structurally safe or use a timeout-capable engine.

For resource-dependent rules, `ValueType.prepare()` returns a distinct
`CrossValidationCandidate`, not the final named value. Its `crossValidate` and
`crossValidateAsync` receivers are the only typed path to the finalized value,
so a locally valid username cannot accidentally be used before uniqueness,
authorization, or existence checks complete.

Use it at the request boundary:

```ts
const CreateUser = object({ username: mytypes.Username });
app.post("/users", { body: CreateUser }, (req, res) => {
  req.body.username; // nominal Username value
});
```

Custom archetypes and disclosures are explicit unchecked escape hatches:

```ts
const even = defineUncheckedCustomArchetype({
  kind: "company.even",
  details: { primitive: "number" },
  validate(input) { /* return a ValidationResult<number> */ }
});

const lastFour = defineUncheckedCustomDisclosure({
  kind: "company.last-four",
  toPublicValue: value => `****${value.slice(-4)}`,
  toPublicString: value => `****${value.slice(-4)}`
});
```

The library prevents ordinary checked TypeScript from constructing or interchanging named values, but TypeScript assertions and `any` can bypass static types. Unchecked custom factories must be security-reviewed because the core cannot enforce their validation or disclosure behavior.
"# vv_ts" 
