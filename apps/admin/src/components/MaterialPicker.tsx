import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { materialsApi } from '@glazion/api-client';
import type { MaterialCategoryOption, MaterialSummary } from '@glazion/types';
import { Icon } from '@glazion/ui';
import { useDebounced } from '../hooks/useDebounced';

interface Props {
  /** The text in the box: the chosen material's exact name once one is picked. */
  value: string;
  /** Whether `value` is a name from the list rather than free text. */
  picked: boolean;
  onChange: (name: string, picked: boolean) => void;
  label: string;
  placeholder?: string;
  /** Before anything is typed, the short list shows only these categories, in this order (colorants for the Colorants section). */
  only?: string[];
}

const SHOWN = 20;

/** Looked up once and shared: the studio short list shown before anything is typed. */
export function useCommonMaterials(enabled = true) {
  return useQuery({
    queryKey: ['materials', 'common'],
    queryFn: () => materialsApi.list({ common: true, pageSize: 200 }),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function categoryLabel(categories: MaterialCategoryOption[] | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  return categories?.find((c) => c.key === id)?.label ?? id[0].toUpperCase() + id.slice(1);
}

/**
 * A material has to be picked from the backend's list, the one recipes are calculated against;
 * free text never counts. Before anything is typed it shows the studio short list by category.
 * Names potters type (EPK, Whiting, RIO) find the real material.
 */
export default function MaterialPicker({ value, picked, onChange, label, placeholder = 'Search materials, e.g. EPK', only }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [chosen, setChosen] = useState<MaterialSummary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const text = value.trim();
  const term = useDebounced(text, 250);
  const searching = !picked && term.length > 0;

  const common = useCommonMaterials(open && !searching);
  const found = useQuery({
    queryKey: ['materials', 'search', term],
    queryFn: () => materialsApi.search(term, SHOWN),
    enabled: searching,
    staleTime: 5 * 60_000,
  });

  // A name that came from a saved recipe: check it is still a name on the list, not an old alias.
  const check = useQuery({
    queryKey: ['materials', 'check', value],
    queryFn: () => materialsApi.search(value, 5),
    enabled: picked && !chosen && text.length > 0,
    staleTime: 5 * 60_000,
  });
  const exact = check.data?.items?.find((m) => m.name === value);
  const realName = !exact ? check.data?.items?.find((m) => m.matchedAlias?.toLowerCase() === value.toLowerCase())?.name : null;
  const shownMaterial = chosen ?? exact ?? null;

  const response = searching ? found.data : common.data;
  const named = (response?.items ?? []).filter((m): m is MaterialSummary & { name: string } => !!m.name);
  const rank = (m: MaterialSummary) => only!.indexOf(m.category ?? '');
  const options = searching || !only ? named : named.filter((m) => rank(m) >= 0).sort((a, b) => rank(a) - rank(b));
  const categories = response?.categories ?? common.data?.categories;
  const loading = searching ? found.isFetching || term !== text : common.isPending;

  useEffect(() => setHighlighted(0), [term, open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setChosen(null);
    setOpen(true);
    onChange(e.target.value, false);
  }

  function select(material: MaterialSummary & { name: string }) {
    setChosen(material);
    setOpen(false);
    onChange(material.name, true);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[highlighted]) select(options[highlighted]);
    } else if (e.key === 'Escape') {
      // Closes the list, not the dialog it sits in.
      e.stopPropagation();
      setOpen(false);
    }
  }

  // The same name typed by hand, perhaps in other capitals: it still has to be chosen, so the stored name is exact.
  const typedMatch = !picked && options.find((m) => m.name.toLowerCase() === text.toLowerCase());
  const invalid = text !== '' && !picked;

  return (
    <div className="picker" ref={rootRef}>
      <input
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid && !open}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {picked && !realName && <Icon name="check" size={16} className="picker-ok" />}

      {!open && typedMatch && <p className="picker-hint">Choose “{typedMatch.name}” from the list.</p>}
      {!open && invalid && !typedMatch && <p className="picker-hint">Choose a material from the list.</p>}
      {!open && picked && realName && (
        <p className="picker-hint">
          “{value}” is another name for {realName}.{' '}
          <button type="button" className="link-btn" onClick={() => onChange(realName, true)}>
            Use {realName}
          </button>
        </p>
      )}
      {!open && picked && shownMaterial && !shownMaterial.hasAnalysis && <p className="picker-hint">No oxide analysis yet, so it adds nothing to the UMF.</p>}

      {open && (
        <div className="picker-menu">
          {loading && options.length === 0 ? (
            <p className="picker-empty">
              <span className="spinner" /> Looking…
            </p>
          ) : (searching ? found.isError : common.isError) ? (
            <p className="picker-empty">The materials list couldn’t be loaded. Try again shortly.</p>
          ) : options.length === 0 ? (
            <p className="picker-empty">{searching ? 'No material with that name.' : 'Start typing to search every material.'}</p>
          ) : (
            <ul id={listId} role="listbox" ref={listRef}>
              {options.map((m, index) => {
                const group = !searching && (index === 0 || options[index - 1].category !== m.category) ? categoryLabel(categories, m.category) : null;
                return [
                  group && (
                    <li key={`group-${m.category}`} role="presentation" className="picker-group">
                      {group}
                    </li>
                  ),
                  <li
                    key={m.id ?? m.name}
                    data-index={index}
                    role="option"
                    aria-selected={picked && m.name === value}
                    className={`picker-option${index === highlighted ? ' is-active' : ''}${picked && m.name === value ? ' is-chosen' : ''}`}
                    // Keeps focus in the input so the click isn't swallowed by a blur.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(m)}
                    onMouseEnter={() => setHighlighted(index)}
                  >
                    <span className="picker-name">
                      {m.name}
                      {m.matchedAlias && <span className="muted"> · “{m.matchedAlias}”</span>}
                    </span>
                    <span className="picker-meta">
                      {!m.hasAnalysis && <span className="badge badge-warn">No analysis</span>}
                      {m.source && m.source !== 'file' && <span className="badge badge-info">{m.source === 'custom' ? 'Added' : 'Corrected'}</span>}
                      {searching && m.category && <span className="muted">{categoryLabel(categories, m.category)}</span>}
                    </span>
                  </li>,
                ];
              })}
            </ul>
          )}
          {searching && (found.data?.total ?? 0) > options.length && (
            <p className="picker-more">{(found.data?.total ?? 0) - options.length} more. Keep typing to narrow it down.</p>
          )}
          {!searching && options.length > 0 && <p className="picker-more">The studio short list. Type to search every material.</p>}
        </div>
      )}
    </div>
  );
}
