import { Type, type TSchema, type TUnsafe } from "typebox";

/**
 * Creates a nullable type by wrapping the given type in a union with null.
 * This allows a field to accept either the specified type or null.
 *
 * @param schema - The TypeBox schema to make nullable
 * @returns A union type that includes the original type and null
 */
export function TypeNullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export const TypeOptionalArray = <T extends TSchema>(
  type: T,
  annotations: Record<string, unknown> = {}
) =>
  Type.Union([type, Type.Array(type)], {
    title: (type as any).title as string | undefined,
    description: (type as any).description as string | undefined,
    ...annotations,
  });

export const TypeDateTime = (annotations: Record<string, unknown> = {}) =>
  Type.String({ format: "date-time", ...annotations });

export const TypeDate = (annotations: Record<string, unknown> = {}) =>
  Type.String({ format: "date", ...annotations });

export const TypeBlob = (annotations: Record<string, unknown> = {}) =>
  Type.Codec(Type.Any({ contentEncoding: "blob", ...annotations }))
    .Decode((value: unknown) => value as Uint8Array)
    .Encode((value: Uint8Array) => Buffer.from(value));

/**
 * Creates a `{ type: "string", enum: [...] }` schema whose values are validated
 * against the provided list.
 *
 * Replaces the former `Type.Base` subclass (removed in TypeBox 1.3) with the
 * migration path TypeBox recommends — {@link Type.Unsafe} to carry the JSON
 * Schema shape plus {@link Type.Refine} to enforce enum membership at runtime.
 *
 * The result is typed as an intersection with `{ type: "string" }` because
 * `TUnsafe` does not surface the literal `type` keyword in its static type,
 * which the DataPortSchema discriminated union relies on to accept the schema.
 */
export const TypeStringEnum = <T extends string[] | readonly string[]>(
  values: T,
  annotations: Record<string, unknown> = {}
): TUnsafe<string> & { readonly type: "string" } =>
  Type.Refine(
    Type.Unsafe<string>({ type: "string", enum: values, ...annotations }),
    (value) => typeof value === "string" && (values as readonly string[]).includes(value)
  ) as unknown as TUnsafe<string> & { readonly type: "string" };
