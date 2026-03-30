import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, ChevronDown as ExpandIcon, GripVertical } from 'lucide-react';
import type { ActionInputDef, ActionInputType } from '../lib/types';
import { ENTITY_KINDS } from '../lib/types';

interface Props {
  inputs: ActionInputDef[];
  onChange: (inputs: ActionInputDef[]) => void;
}

const TYPE_OPTIONS: { value: ActionInputType; label: string; description: string }[] = [
  { value: 'string', label: 'Text', description: 'Single-line text input' },
  { value: 'textarea', label: 'Textarea', description: 'Multi-line text area' },
  { value: 'number', label: 'Number', description: 'Numeric input' },
  { value: 'boolean', label: 'Toggle', description: 'True / false toggle' },
  { value: 'select', label: 'Dropdown', description: 'Select from a list of options' },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}

export default function ActionFormBuilder({ inputs, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const update = (i: number, patch: Partial<ActionInputDef>) => {
    const next = inputs.map((inp, idx) => (idx === i ? { ...inp, ...patch } : inp));
    onChange(next);
  };

  const addField = () => {
    const newIdx = inputs.length;
    onChange([...inputs, { name: '', type: 'string', title: '', required: false }]);
    setExpanded((prev) => new Set([...prev, newIdx]));
  };

  const remove = (i: number) => {
    onChange(inputs.filter((_, idx) => idx !== i));
    setExpanded((prev) => {
      const next = new Set<number>();
      prev.forEach((v) => { if (v < i) next.add(v); else if (v > i) next.add(v - 1); });
      return next;
    });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= inputs.length) return;
    const next = [...inputs];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setExpanded((prev) => {
      const next2 = new Set<number>();
      prev.forEach((v) => {
        if (v === i) next2.add(j);
        else if (v === j) next2.add(i);
        else next2.add(v);
      });
      return next2;
    });
  };

  return (
    <div className="space-y-2">
      {inputs.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--gantry-text-secondary)]">
          No input fields yet. Add fields below to collect user input before execution.
        </p>
      )}

      {inputs.map((inp, i) => {
        const isOpen = expanded.has(i);
        const label = inp.title || inp.name || `Field ${i + 1}`;

        return (
          <div
            key={i}
            className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)]"
          >
            {/* Header row */}
            <div className="flex items-center gap-2 px-3 py-2">
              <GripVertical className="h-4 w-4 shrink-0 text-[var(--gantry-text-secondary)]" />
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                {isOpen ? (
                  <ExpandIcon className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--gantry-text-secondary)]" />
                )}
                <span className="text-sm font-medium text-[var(--gantry-text-primary)]">{label}</span>
                <span className="rounded bg-[var(--gantry-bg-tertiary)] px-1.5 py-0.5 text-xs text-[var(--gantry-text-secondary)]">
                  {TYPE_OPTIONS.find((t) => t.value === inp.type)?.label ?? inp.type}
                </span>
                {inp.required && (
                  <span className="rounded bg-[var(--gantry-accent)]/10 px-1.5 py-0.5 text-xs text-[var(--gantry-accent)]">
                    required
                  </span>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:opacity-30"
                  title="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === inputs.length - 1}
                  className="rounded p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] disabled:opacity-30"
                  title="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="rounded p-1 text-[var(--gantry-danger)] hover:bg-[var(--gantry-bg-tertiary)]"
                  title="Remove field"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded editor */}
            {isOpen && (
              <div className="border-t border-[var(--gantry-border)] px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Variable Name <span className="text-[var(--gantry-danger)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={inp.name}
                      onChange={(e) => update(i, { name: slugify(e.target.value) })}
                      placeholder="e.g. environment"
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                    <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Used as the key in inputs (snake_case)</p>
                  </div>

                  {/* Title / Label */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Label
                    </label>
                    <input
                      type="text"
                      value={inp.title ?? ''}
                      onChange={(e) => update(i, { title: e.target.value })}
                      placeholder="e.g. Target Environment"
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                    <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">Human-readable label shown in the form</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Type */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Field Type
                    </label>
                    <select
                      value={inp.type}
                      onChange={(e) => update(i, { type: e.target.value as ActionInputType, options: e.target.value === 'select' ? (inp.options ?? []) : undefined })}
                      className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    >
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
                      ))}
                    </select>
                  </div>

                  {/* Default */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                      Default Value
                    </label>
                    {inp.type === 'boolean' ? (
                      <select
                        value={String(inp.default ?? 'false')}
                        onChange={(e) => update(i, { default: e.target.value === 'true' })}
                        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : (
                      <input
                        type={inp.type === 'number' ? 'number' : 'text'}
                        value={String(inp.default ?? '')}
                        onChange={(e) => update(i, { default: inp.type === 'number' ? Number(e.target.value) : e.target.value })}
                        placeholder="Leave blank for no default"
                        className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                    Help Text
                  </label>
                  <input
                    type="text"
                    value={inp.description ?? ''}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="Brief description shown below the field"
                    className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                </div>

                {/* Required toggle */}
                <label className="flex cursor-pointer items-center gap-3">
                  <div
                    onClick={() => update(i, { required: !inp.required })}
                    className={`relative h-5 w-9 rounded-full transition-colors ${inp.required ? 'bg-[var(--gantry-accent)]' : 'bg-[var(--gantry-border)]'}`}
                  >
                    <div
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${inp.required ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </div>
                  <span className="text-sm text-[var(--gantry-text-primary)]">Required field</span>
                </label>

                {/* Options editor for select type */}
                {inp.type === 'select' && (
                  <div className="space-y-3">
                    {/* Options source toggle */}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                        Options Source
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => update(i, { entityKind: undefined })}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            !inp.entityKind
                              ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                              : 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
                          }`}
                        >
                          Manual List
                        </button>
                        <button
                          type="button"
                          onClick={() => update(i, { entityKind: ENTITY_KINDS[0].name, options: undefined })}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            inp.entityKind
                              ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                              : 'bg-[var(--gantry-bg-tertiary)] text-[var(--gantry-text-secondary)] hover:text-[var(--gantry-text-primary)]'
                          }`}
                        >
                          Entity List
                        </button>
                      </div>
                    </div>

                    {inp.entityKind ? (
                      /* Entity kind picker */
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                          Entity Kind
                        </label>
                        <select
                          value={inp.entityKind}
                          onChange={(e) => update(i, { entityKind: e.target.value })}
                          className="w-full rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1.5 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                        >
                          {ENTITY_KINDS.map((k) => (
                            <option key={k.name} value={k.name}>{k.name}</option>
                          ))}
                        </select>
                        <p className="mt-0.5 text-xs text-[var(--gantry-text-secondary)]">
                          Dropdown will be populated with all {inp.entityKind} entities
                        </p>
                      </div>
                    ) : (
                      /* Manual options editor */
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--gantry-text-secondary)]">
                          Options
                        </label>
                        <div className="space-y-1.5">
                          {(inp.options ?? []).map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const opts = [...(inp.options ?? [])];
                                  opts[oi] = e.target.value;
                                  update(i, { options: opts });
                                }}
                                placeholder={`Option ${oi + 1}`}
                                className="flex-1 rounded-md border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1 text-sm text-[var(--gantry-text-primary)] placeholder-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const opts = (inp.options ?? []).filter((_, idx) => idx !== oi);
                                  update(i, { options: opts });
                                }}
                                className="rounded p-1 text-[var(--gantry-danger)] hover:bg-[var(--gantry-bg-tertiary)]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => update(i, { options: [...(inp.options ?? []), ''] })}
                            className="flex items-center gap-1 text-xs text-[var(--gantry-accent)] hover:underline"
                          >
                            <Plus className="h-3 w-3" /> Add option
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addField}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--gantry-border)] py-2.5 text-sm text-[var(--gantry-text-secondary)] hover:border-[var(--gantry-accent)] hover:text-[var(--gantry-accent)]"
      >
        <Plus className="h-4 w-4" /> Add Field
      </button>
    </div>
  );
}
