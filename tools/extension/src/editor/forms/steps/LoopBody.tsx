import React from 'react';
import type { LoopAction, LoopItems, LoopExitWhen } from '@portalflow/schema';
import { TextField } from '../fields/TextField';
import { SelectField } from '../fields/SelectField';
import { CheckboxField } from '../fields/CheckboxField';

interface LoopBodyProps {
  action: LoopAction;
  onChange: (next: Partial<LoopAction>) => void;
  errors: Record<string, string>;
}

const ORDER_OPTIONS = [
  { value: 'natural', label: 'Natural' },
  { value: 'first', label: 'First' },
  { value: 'last', label: 'Last' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

const EXIT_CHECK_OPTIONS = [
  { value: 'element_exists', label: 'Element exists' },
  { value: 'element_missing', label: 'Element missing' },
  { value: 'url_matches', label: 'URL matches' },
  { value: 'text_contains', label: 'Text contains' },
  { value: 'variable_equals', label: 'Variable equals' },
];

export function LoopBody({ action, onChange, errors }: LoopBodyProps) {
  const hasItems = action.items !== undefined;
  const hasExitWhen = action.exitWhen !== undefined;

  // maxIterations is number | string — display as string in the field
  const maxIterationsStr = String(action.maxIterations ?? '');

  function handleMaxIterationsChange(raw: string) {
    // Coerce to number if it's a bare integer string, otherwise keep as string
    if (/^\d+$/.test(raw.trim())) {
      onChange({ maxIterations: Number(raw.trim()) });
    } else {
      onChange({ maxIterations: raw });
    }
  }

  function handleItemsToggle(enabled: boolean) {
    if (enabled) {
      const defaultItems: LoopItems = {
        description: '',
        itemVar: 'item',
        order: 'natural',
      };
      onChange({ items: defaultItems });
    } else {
      onChange({ items: undefined });
    }
  }

  function handleExitWhenToggle(enabled: boolean) {
    if (enabled) {
      const defaultExit: LoopExitWhen = {
        check: 'element_exists',
        value: '',
      };
      onChange({ exitWhen: defaultExit });
    } else {
      onChange({ exitWhen: undefined });
    }
  }

  function handleItemsChange(partial: Partial<LoopItems>) {
    if (!action.items) return;
    onChange({ items: { ...action.items, ...partial } });
  }

  function handleExitWhenChange(partial: Partial<LoopExitWhen>) {
    if (!action.exitWhen) return;
    onChange({ exitWhen: { ...action.exitWhen, ...partial } });
  }

  return (
    <div>
      <TextField
        label="Max iterations"
        value={maxIterationsStr}
        onChange={handleMaxIterationsChange}
        placeholder="10"
        required
        hint="Number or template like {{count}}"
        error={errors['maxIterations']}
      />

      <TextField
        label="Index variable"
        value={action.indexVar ?? ''}
        onChange={(indexVar) => onChange({ indexVar: indexVar || 'loop_index' })}
        placeholder="loop_index"
        monospace
        hint="Tracks iteration number, available as {{indexVar}} inside the loop"
        error={errors['indexVar']}
      />

      {/* Items section */}
      <details className="form-details">
        <summary className="form-details-summary">Items (DOM iteration)</summary>
        <div className="form-details-body">
          <CheckboxField
            label="Enable items"
            checked={hasItems}
            onChange={handleItemsToggle}
            hint="Iterate over matching DOM elements instead of a fixed count"
          />

          {hasItems && action.items && (
            <>
              <TextField
                label="Description"
                value={action.items.description}
                onChange={(description) => handleItemsChange({ description })}
                placeholder="Each row in the results table"
                required
                error={errors['items.description']}
              />

              <TextField
                label="Selector pattern"
                value={action.items.selectorPattern ?? ''}
                onChange={(selectorPattern) =>
                  handleItemsChange({ selectorPattern: selectorPattern || undefined })
                }
                placeholder=".result-row"
                monospace
                error={errors['items.selectorPattern']}
              />

              <TextField
                label="Item variable"
                value={action.items.itemVar ?? 'item'}
                onChange={(itemVar) => handleItemsChange({ itemVar: itemVar || 'item' })}
                placeholder="item"
                monospace
                error={errors['items.itemVar']}
              />

              <SelectField
                label="Order"
                value={action.items.order ?? 'natural'}
                onChange={(order) =>
                  handleItemsChange({ order: order as NonNullable<LoopItems['order']> })
                }
                options={ORDER_OPTIONS}
                error={errors['items.order']}
              />
            </>
          )}
        </div>
      </details>

      {/* Exit when section */}
      <details className="form-details">
        <summary className="form-details-summary">Exit when</summary>
        <div className="form-details-body">
          <CheckboxField
            label="Enable exit condition"
            checked={hasExitWhen}
            onChange={handleExitWhenToggle}
            hint="Stop the loop early when a condition is met"
          />

          {hasExitWhen && action.exitWhen && (
            <>
              <SelectField
                label="Check"
                value={action.exitWhen.check}
                onChange={(check) =>
                  handleExitWhenChange({ check: check as LoopExitWhen['check'] })
                }
                options={EXIT_CHECK_OPTIONS}
                required
                error={errors['exitWhen.check']}
              />

              <TextField
                label="Value"
                value={action.exitWhen.value}
                onChange={(value) => handleExitWhenChange({ value })}
                placeholder="Condition value"
                required
                error={errors['exitWhen.value']}
              />
            </>
          )}
        </div>
      </details>

      <p className="muted">
        Substeps appear in the outline on the left — select any substep to edit it.
      </p>
    </div>
  );
}
