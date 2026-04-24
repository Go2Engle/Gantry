/**
 * Recursively remove empty values from an object so the backend doesn't
 * receive "" for optional enum fields, empty nested objects, etc.
 *
 * Removes: '', undefined, null, empty arrays, and recursively-empty objects.
 * Preserves: false, 0, and non-empty values.
 */
export function pruneEmpty(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const pruned = pruneValue(value);
    if (pruned !== undefined) {
      result[key] = pruned;
    }
  }
  return result;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function catalogEntityPath(kind: string, name: string, namespace?: string): string {
  const namespaceSuffix = namespace && namespace !== 'default'
    ? `?namespace=${encodeURIComponent(namespace)}`
    : '';
  return `/catalog/${encodePathSegment(kind)}/${encodePathSegment(name)}${namespaceSuffix}`;
}

export function sanitizeEntityName(value: string): string {
  return sanitizeEntityNameInput(value).replace(/[^a-z0-9]+$/g, '');
}

export function sanitizeEntityNameInput(value: string): string {
  const next = value.toLowerCase().trimStart();
  const allowTrailingSeparator = /[\s.-]$/.test(next);
  const sanitized = next
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/g, '');
  return allowTrailingSeparator ? sanitized : sanitized.replace(/[^a-z0-9]+$/g, '');
}

export function isValidEntityName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.length <= 253;
}

function pruneValue(value: any): any {
  if (value === undefined || value === null || value === '') return undefined;

  if (Array.isArray(value)) {
    const pruned = value
      .map(pruneValue)
      .filter((v) => v !== undefined);
    return pruned.length > 0 ? pruned : undefined;
  }

  if (typeof value === 'object') {
    const pruned = pruneEmpty(value);
    return Object.keys(pruned).length > 0 ? pruned : undefined;
  }

  return value;
}

export function applySchemaDefaults(
  schema: Record<string, any> | undefined,
  values?: Record<string, any> | null,
): Record<string, any> {
  const applied = applyFieldSchemaDefaults(
    { type: 'object', properties: schema?.properties ?? {} },
    values ?? {},
  );

  if (!applied || typeof applied !== 'object' || Array.isArray(applied)) {
    return {};
  }

  return applied;
}

function applyFieldSchemaDefaults(fieldSchema: Record<string, any> | undefined, value: any): any {
  if (!fieldSchema || typeof fieldSchema !== 'object') return value;

  let nextValue = value;
  if (nextValue === undefined && 'default' in fieldSchema) {
    nextValue = cloneSchemaDefault(fieldSchema.default);
  }

  const hasProperties = !!fieldSchema.properties && typeof fieldSchema.properties === 'object';
  if (hasProperties || fieldSchema.type === 'object') {
    const properties = fieldSchema.properties ?? {};
    const hasExplicitObjectValue = nextValue !== undefined;
    const nextObject = nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
      ? { ...nextValue }
      : {};
    let shouldReturnObject = hasExplicitObjectValue;
    for (const [key, childSchema] of Object.entries(properties)) {
      const currentChild = nextObject[key];
      const nextChild = applyFieldSchemaDefaults(childSchema as Record<string, any>, currentChild);
      if (nextChild !== undefined) {
        nextObject[key] = nextChild;
        shouldReturnObject = true;
      }
    }

    if (shouldReturnObject || Object.keys(nextObject).length > 0) {
      return nextObject;
    }
    return nextValue;
  }

  if (Array.isArray(nextValue)) {
    const itemSchema = fieldSchema.items && typeof fieldSchema.items === 'object'
      ? fieldSchema.items as Record<string, any>
      : undefined;
    if (!itemSchema) return nextValue;
    return nextValue.map((item) => applyFieldSchemaDefaults(itemSchema, item));
  }

  return nextValue;
}

function cloneSchemaDefault<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return cloneSchemaDefaultFallback(value);
}

function cloneSchemaDefaultFallback<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneSchemaDefaultFallback(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneSchemaDefaultFallback(entry)]),
    ) as T;
  }
  return value;
}
