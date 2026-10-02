import {
  buildSchema,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLNamedType,
  type GraphQLSchema,
} from "graphql";

export interface FieldInfo {
  type: string;
  args?: Record<string, string>;
  description?: string;
  deprecated?: string;
}

export interface TypeInfo {
  kind: "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT" | "SCALAR";
  description?: string;
  fields?: Record<string, FieldInfo>;
  values?: string[];
  possibleTypes?: string[];
  interfaces?: string[];
}

export interface SchemaIndex {
  queries: Record<string, FieldInfo>;
  mutations?: Record<string, FieldInfo>;
  types: Record<string, TypeInfo>;
}

/**
 * Projects the SDL onto a plain object the sandbox can query. Type references
 * are SDL strings ("[Comment!]!"), not nested ofType trees, and only types
 * reachable from the chosen roots are kept, which drops most *Input/*Payload
 * types in read-only mode.
 */
export function buildSchemaIndex(sdl: string, { includeMutations = false } = {}): SchemaIndex {
  const schema = buildSchema(sdl);
  const roots = [schema.getQueryType()];
  if (includeMutations) roots.push(schema.getMutationType());

  const reachable = new Set<string>();
  const queue: GraphQLNamedType[] = [];
  const visit = (type: GraphQLNamedType) => {
    if (type.name.startsWith("__") || reachable.has(type.name)) return;
    reachable.add(type.name);
    queue.push(type);
  };

  for (const root of roots) if (root) visit(root);
  while (queue.length > 0) {
    const type = queue.pop()!;
    if (isObjectType(type) || isInterfaceType(type)) {
      for (const field of Object.values(type.getFields())) {
        visit(getNamedType(field.type));
        for (const arg of field.args) visit(getNamedType(arg.type));
      }
      for (const iface of type.getInterfaces()) visit(iface);
    }
    if (isInterfaceType(type) || isUnionType(type)) {
      for (const impl of schema.getPossibleTypes(type)) visit(impl);
    }
    if (isInputObjectType(type)) {
      for (const field of Object.values(type.getFields())) visit(getNamedType(field.type));
    }
  }

  const types: Record<string, TypeInfo> = {};
  for (const name of [...reachable].sort()) {
    const type = schema.getType(name);
    if (type) types[name] = describeType(schema, type);
  }
  for (const root of roots) if (root) delete types[root.name];

  const index: SchemaIndex = {
    queries: rootFields(schema.getQueryType()),
    types,
  };
  if (includeMutations) index.mutations = rootFields(schema.getMutationType());
  return index;
}

function rootFields(root: ReturnType<GraphQLSchema["getQueryType"]>): Record<string, FieldInfo> {
  if (!root) return {};
  return Object.fromEntries(Object.values(root.getFields()).map((f) => [f.name, describeField(f)]));
}

function describeType(schema: GraphQLSchema, type: GraphQLNamedType): TypeInfo {
  const description = type.description ?? undefined;
  if (isObjectType(type)) {
    return compact({
      kind: "OBJECT",
      description,
      fields: fieldMap(Object.values(type.getFields())),
      interfaces: names(type.getInterfaces()),
    });
  }
  if (isInterfaceType(type)) {
    return compact({
      kind: "INTERFACE",
      description,
      fields: fieldMap(Object.values(type.getFields())),
      possibleTypes: names(schema.getPossibleTypes(type)),
    });
  }
  if (isUnionType(type)) {
    return compact({ kind: "UNION", description, possibleTypes: names(type.getTypes()) });
  }
  if (isEnumType(type)) {
    return compact({ kind: "ENUM", description, values: type.getValues().map((v) => v.name) });
  }
  if (isInputObjectType(type)) {
    return compact({
      kind: "INPUT_OBJECT",
      description,
      fields: Object.fromEntries(Object.values(type.getFields()).map((f) => [f.name, describeInputField(f)])),
    });
  }
  if (isScalarType(type)) return compact({ kind: "SCALAR", description });
  throw new Error(`Unhandled GraphQL type kind for ${String(type)}`);
}

function fieldMap(fields: GraphQLField<unknown, unknown>[]): Record<string, FieldInfo> {
  return Object.fromEntries(fields.map((f) => [f.name, describeField(f)]));
}

function describeField(field: GraphQLField<unknown, unknown>): FieldInfo {
  const args = field.args.length ? Object.fromEntries(field.args.map((a: GraphQLArgument) => [a.name, a.type.toString()])) : undefined;
  return compact({
    type: field.type.toString(),
    args,
    description: field.description ?? undefined,
    deprecated: field.deprecationReason ?? undefined,
  });
}

function describeInputField(field: GraphQLInputField): FieldInfo {
  return compact({
    type: field.type.toString(),
    description: field.description ?? undefined,
    deprecated: field.deprecationReason ?? undefined,
  });
}

function names(types: ReadonlyArray<GraphQLNamedType>): string[] | undefined {
  return types.length ? types.map((t) => t.name) : undefined;
}

function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}
