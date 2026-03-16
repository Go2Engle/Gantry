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
