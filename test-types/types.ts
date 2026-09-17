import { classifications, defineTypes, disclosures, noAdditionalValidation, object, regexString, type InferValue, type StandardSchemaV1 } from "@untrust/vv";

type InferOutput<S> = S extends StandardSchemaV1<any, infer Output> ? Output : never;

const values = defineTypes({
  Username: { archetype: regexString({ normalize: value => value, bounds: { minimum: 3, maximum: 20 }, pattern: /^[a-z]+$/, validateAdditional: noAdditionalValidation }), classification: classifications.public(), disclosure: disclosures.public<string>() },
  ProjectSlug: { archetype: regexString({ normalize: value => value, bounds: { minimum: 3, maximum: 20 }, pattern: /^[a-z]+$/, validateAdditional: noAdditionalValidation }), classification: classifications.public(), disclosure: disclosures.public<string>() }
});

type Username = InferValue<typeof values.Username>;
const username: Username = values.Username("alice");
const candidateResult = values.Username.prepare("alice");
if (candidateResult.success) {
  // @ts-expect-error a locally validated candidate is not a finalized Username
  const premature: Username = candidateResult.value;
  void premature;
}
const primitive: string = username.exposeUnchecked();
// @ts-expect-error primitives have not crossed the validation boundary
const invalid: Username = "alice";
// @ts-expect-error distinct named values are nominally incompatible
const wrong: Username = values.ProjectSlug("alice");

const Body = object({ username: values.Username });
type BodyOutput = InferOutput<typeof Body>;
const body: BodyOutput = { username };
body.username.toPublicString();

// @ts-expect-error regex archetypes require every definition field
regexString({ normalize: value => value, bounds: { minimum: 1, maximum: 2 }, pattern: /x/ });
void primitive; void invalid; void wrong; void body;
