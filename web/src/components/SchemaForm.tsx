import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { JsonSchema } from '../lib/types';
import { sanitizeEntityNameInput } from '../lib/utils';
import EntityPicker from './EntityPicker';

const ENTITY_KINDS = [
  'Service', 'API', 'Infrastructure', 'Team', 'Environment', 'Documentation', 'Action',
];

function isDependsOnItem(schema: JsonSchema): boolean {
  if (schema.type !== 'object' || !schema.properties) return false;
  const keys = Object.keys(schema.properties);
  return keys.length === 2 && keys.includes('kind') && keys.includes('name');
}

function DependencyPicker({
  value,
  onChange,
}: {
  value: { kind: string; name: string };
  onChange: (v: { kind: string; name: string }) => void;
}) {
  const kind = value.kind || '';
  const name = value.name || '';
  return (
    <div className="flex flex-1 items-center gap-2">
      <select
        value={kind}
        onChange={(e) => onChange({ kind: e.target.value, name: '' })}
        className="w-36 shrink-0 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-2 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)]"
      >
        <option value="">Kind…</option>
        {ENTITY_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      {kind ? (
        <div className="flex-1">
          <EntityPicker
            entityKind={kind}
            value={name}
            onChange={(v) => onChange({ kind, name: v })}
            placeholder="Search entity…"
          />
        </div>
      ) : (
        <input
          type="text"
          disabled
          placeholder="Select a kind first"
          className="flex-1 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-tertiary)] px-3 py-2 text-sm text-[var(--gantry-text-secondary)] opacity-60"
        />
      )}
    </div>
  );
}

interface SchemaFormProps {
  schema: JsonSchema;
  initialValues?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  formId?: string;
  hideActions?: boolean;
}

function getDefaultValue(schema: JsonSchema): any {
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '';
  }
}

/** Check if a single value is "empty" for validation purposes. */
function isEmpty(value: any, schema: JsonSchema): boolean {
  if (value === undefined || value === null) return true;
  if (schema.type === 'string' && value === '') return true;
  if (schema.type === 'array' && Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** Collect names of required fields that are empty. */
function getMissingRequired(
  schema: JsonSchema,
  values: Record<string, any>,
): string[] {
  const required = schema.required || [];
  const properties = schema.properties || {};
  const missing: string[] = [];
  for (const key of required) {
    const propSchema = properties[key];
    if (!propSchema) continue;
    if (isEmpty(values[key], propSchema)) {
      missing.push(key);
    }
  }
  return missing;
}

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: any;
  onChange: (value: any) => void;
  required?: boolean;
  error?: boolean;
}

function FormField({ name, schema, value, onChange, required, error }: FieldProps) {
  const label = schema.title || name;
  const description = schema.description;
  const isSlug = schema['x-slug'] === true;
  const handleStringChange = (nextValue: string) => onChange(isSlug ? sanitizeEntityNameInput(nextValue) : nextValue);
  const borderClass = error
    ? 'border-[var(--gantry-danger)] focus:border-[var(--gantry-danger)] focus:ring-[var(--gantry-danger)]'
    : 'border-[var(--gantry-border)] focus:border-[var(--gantry-accent)] focus:ring-[var(--gantry-accent)]';

  if (schema.enum) {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </label>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-1 ${borderClass}`}
        >
          <option value="">Select...</option>
          {schema.enum.map((opt: any) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-[var(--gantry-danger)]">This field is required</p>}
      </div>
    );
  }

  if (schema.type === 'boolean') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(!value)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              value ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-bg-tertiary)]'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--gantry-bg-primary)] shadow transition-transform ${
                value ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <label className="text-sm font-medium text-[var(--gantry-text-primary)]">
            {label}
            {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
          </label>
        </div>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
      </div>
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </label>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <input
          type="number"
          value={value ?? ''}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : undefined}
          onChange={(e) =>
            onChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          className={`w-full rounded-lg border bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-1 ${borderClass}`}
        />
        {error && <p className="text-xs text-[var(--gantry-danger)]">This field is required</p>}
      </div>
    );
  }

  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemEntityRef = schema.items?.['x-entity-ref'];
    const isDepsOn = schema.items ? isDependsOnItem(schema.items) : false;
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </label>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <div className="space-y-2">
          {items.map((item: any, idx: number) => (
            <div key={idx} className="flex items-center gap-2">
              {isDepsOn ? (
                <DependencyPicker
                  value={item}
                  onChange={(newItem) => {
                    const next = [...items];
                    next[idx] = newItem;
                    onChange(next);
                  }}
                />
              ) : schema.items?.type === 'object' && schema.items.properties ? (
                <div className="flex-1 rounded-lg border border-[var(--gantry-border)] p-3">
                  <ObjectFields
                    schema={schema.items}
                    value={item}
                    onChange={(newItem) => {
                      const next = [...items];
                      next[idx] = newItem;
                      onChange(next);
                    }}
                  />
                </div>
              ) : itemEntityRef ? (
                <div className="flex-1">
                  <EntityPicker
                    entityKind={itemEntityRef}
                    value={String(item)}
                    onChange={(v) => {
                      const next = [...items];
                      next[idx] = v;
                      onChange(next);
                    }}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={String(item)}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = e.target.value;
                    onChange(next);
                  }}
                  className="flex-1 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--gantry-accent)]"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  const next = items.filter((_: any, i: number) => i !== idx);
                  onChange(next);
                }}
                className="rounded-lg p-2 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const defaultItem = isDepsOn
                ? { kind: '', name: '' }
                : schema.items
                ? getDefaultValue(schema.items)
                : '';
              onChange([...items, defaultItem]);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--gantry-border)] px-3 py-2 text-sm text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>
      </div>
    );
  }

  if (schema.type === 'object' && schema.properties) {
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </legend>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <div className="rounded-lg border border-[var(--gantry-border)] p-4">
          <ObjectFields
            schema={schema}
            value={value || {}}
            onChange={onChange}
          />
        </div>
      </fieldset>
    );
  }

  // Entity reference: searchable combobox
  if (schema['x-entity-ref']) {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </label>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <EntityPicker
          entityKind={schema['x-entity-ref']}
          value={value ?? ''}
          onChange={onChange}
        />
        {error && <p className="text-xs text-[var(--gantry-danger)]">This field is required</p>}
      </div>
    );
  }

  // Default: string input (or textarea for long text / format: textarea)
  const isMultiline =
    !isSlug && (schema.format === 'textarea' || (schema.maxLength && schema.maxLength > 200));

  if (isMultiline) {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
        </label>
        {description && (
          <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
        )}
        <textarea
          value={value ?? ''}
          onChange={(e) => handleStringChange(e.target.value)}
          rows={4}
          maxLength={schema.maxLength}
          className={`min-h-28 w-full resize-y rounded-lg border bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-1 ${borderClass}`}
        />
        {error && <p className="text-xs text-[var(--gantry-danger)]">This field is required</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-[var(--gantry-text-primary)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--gantry-danger)]">*</span>}
      </label>
      {description && (
        <p className="text-xs text-[var(--gantry-text-secondary)]">{description}</p>
      )}
      <input
        type={schema.format === 'password' ? 'password' : schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : 'text'}
        value={value ?? ''}
        onChange={(e) => handleStringChange(e.target.value)}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        pattern={schema.pattern}
        title={schema.pattern ? description : undefined}
        className={`w-full rounded-lg border bg-[var(--gantry-bg-primary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:outline-none focus:ring-1 ${borderClass}`}
      />
      {error && <p className="text-xs text-[var(--gantry-danger)]">This field is required</p>}
    </div>
  );
}

function ObjectFields({
  schema,
  value,
  onChange,
  errors,
}: {
  schema: JsonSchema;
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  errors?: string[];
}) {
  const properties = schema.properties || {};
  const required = schema.required || [];

  return (
    <div className="space-y-4">
      {Object.entries(properties)
        .filter(([, propSchema]) => !propSchema['x-hidden'])
        .map(([key, propSchema]) => (
          <FormField
            key={key}
            name={key}
            schema={propSchema}
            value={value[key] ?? getDefaultValue(propSchema)}
            onChange={(newVal) => onChange({ ...value, [key]: newVal })}
            required={required.includes(key)}
            error={errors ? errors.includes(key) : false}
          />
        ))}
    </div>
  );
}

export default function SchemaForm({
  schema,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  formId,
  hideActions = false,
}: SchemaFormProps) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    if (initialValues) return { ...initialValues };
    const defaults: Record<string, any> = {};
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        defaults[key] = getDefaultValue(propSchema);
      }
    }
    return defaults;
  });

  const [submitted, setSubmitted] = useState(false);

  const missingFields = useMemo(
    () => getMissingRequired(schema, values),
    [schema, values],
  );

  const isValid = missingFields.length === 0;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitted(true);
      if (missingFields.length > 0) return;
      onSubmit(values);
    },
    [values, onSubmit, missingFields],
  );

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      <ObjectFields
        schema={schema}
        value={values}
        onChange={setValues}
        errors={submitted ? missingFields : undefined}
      />
      {!hideActions && (
        <div className="flex items-center justify-end gap-3 border-t border-[var(--gantry-border)] pt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!isValid}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              !isValid
                ? 'cursor-not-allowed bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)]'
                : 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]'
            }`}
          >
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
