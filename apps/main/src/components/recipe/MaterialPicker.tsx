import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { materialsApi } from '@glazion/api-client';
import type { MaterialCategoryOption, MaterialListResponse, MaterialSummary } from '@glazion/types';
import { Icon } from '@glazion/ui';
import { useDebounced } from '../../lib/useDebounced';

interface Props {
  /** The text in the box: the chosen material's name once one is picked. */
  value: string;
  /** Whether `value` is a material from the list (or from a saved recipe) rather than free text. */
  picked: boolean;
  onChange: (name: string, materialId: string | null, picked: boolean) => void;
  label: string;
  placeholder?: string;
  /** Flagged by a form check; its message is in the element `describedBy` names. */
  invalid?: boolean;
  describedBy?: string;
}

const SHOWN = 20;

type Named = MaterialSummary & { name: string };

/** Names typed in full that are still being looked up, so a form can wait for them to be picked. */
const lookups = new Set<Promise<unknown>>();
export const lookingUp = () => lookups.size > 0;
export const lookupsDone = () => Promise.allSettled([...lookups]);

/** The one material with exactly that name, in any capitals, or failing that the one known by it. */
function exactMatch(items: MaterialSummary[], text: string): Named | undefined {
  const lower = text.toLowerCase();
  const named = items.filter((m): m is Named => !!m.name);
  const byName = named.filter((m) => m.name.toLowerCase() === lower);
  if (byName.length > 0) return byName.length === 1 ? byName[0] : undefined;
  const byAlias = named.filter((m) => m.matchedAlias?.toLowerCase() === lower);
  return byAlias.length === 1 ? byAlias[0] : undefined;
}

/** The material with exactly this name (or short name, like EPK), looked up the way the picker does. */
export async function lookUpMaterial(queryClient: QueryClient, name: string): Promise<Named | undefined> {
  const found = await queryClient.fetchQuery({ queryKey: ['materials', 'search', name], queryFn: () => materialsApi.search(name, SHOWN), staleTime: 5 * 60_000 });
  return exactMatch(found.items ?? [], name);
}

function categoryLabel(categories: MaterialCategoryOption[] | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  return categories?.find((c) => c.key === id)?.label ?? id[0].toUpperCase() + id.slice(1);
}

/**
 * A material has to be picked from the backend's list, the one recipes are calculated against;
 * free text never counts. Before anything is typed it shows the studio short list by category.
 * Names potters type (EPK, Whiting, RIO) find the real material. The row keeps the material's id.
 */
export default function MaterialPicker({ value, picked, onChange, label, placeholder = 'Search materials, e.g. EPK', invalid: flagged = false, describedBy }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [chosen, setChosen] = useState<Named | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const queryClient = useQueryClient();
  // For a match found after the field was left: the box may have changed, and so may the other rows.
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  const text = value.trim();
  const term = useDebounced(text, 250);
  const searching = !picked && term.length > 0;

  const common = useQuery({
    queryKey: ['materials', 'common'],
    queryFn: () => materialsApi.list({ common: true, pageSize: 200 }),
    // Loaded with the page rather than on first opening, so the list is there straight away.
    enabled: !searching,
    staleTime: 10 * 60_000,
  });
  const found = useQuery({
    queryKey: ['materials', 'search', term],
    queryFn: () => materialsApi.search(term, SHOWN),
    enabled: searching,
    staleTime: 5 * 60_000,
  });

  const response = searching ? found.data : common.data;
  const options = (response?.items ?? []).filter((m): m is Named => !!m.name);
  const categories = response?.categories ?? common.data?.categories;
  const loading = searching ? found.isFetching || term !== text : common.isPending;

  useEffect(() => setHighlighted(0), [term, open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setChosen(null);
    setOpen(true);
    onChange(e.target.value, null, false);
  }

  function select(material: Named) {
    setChosen(material);
    setOpen(false);
    onChange(material.name, material.id, true);
  }

  /** A name typed in full is that material, so it's picked as the field is left rather than turned down. */
  async function pickTyped() {
    if (picked || !text) return;
    const key = ['materials', 'search', text];
    const cached = queryClient.getQueryData<MaterialListResponse>(key);
    if (cached) {
      const match = exactMatch(cached.items ?? [], text);
      if (match) select(match);
      return;
    }
    const lookup = queryClient.fetchQuery({ queryKey: key, queryFn: () => materialsApi.search(text, SHOWN), staleTime: 5 * 60_000 });
    lookups.add(lookup);
    try {
      const found = await lookup;
      const match = exactMatch(found.items ?? [], text);
      if (!match || latest.current.value.trim() !== text) return;
      setChosen(match);
      latest.current.onChange(match.name, match.id, true);
    } catch {
      // Left as typed: the row still asks for a material from the list.
    } finally {
      lookups.delete(lookup);
    }
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
      setOpen(false);
    }
  }

  // The same name typed by hand, perhaps in other capitals: it still has to be chosen, so the row gets its id.
  const typedMatch = !picked && options.find((m) => m.name.toLowerCase() === text.toLowerCase());
  const invalid = text !== '' && !picked;

  return (
    <div className="picker">
      <input
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[highlighted] ? `${listId}-${highlighted}` : undefined}
        aria-invalid={flagged || (invalid && !open)}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Tabbing or clicking away closes the list; a name typed in full is picked on the way out.
          setOpen(false);
          void pickTyped();
        }}
        onKeyDown={handleKeyDown}
      />
      {picked && <Icon name="check" size={16} className="picker-ok" />}

      {!open && !flagged && typedMatch && <p className="picker-hint">Choose “{typedMatch.name}” from the list.</p>}
      {!open && !flagged && invalid && !typedMatch && <p className="picker-hint">Choose a material from the list.</p>}
      {!open && picked && chosen && !chosen.hasAnalysis && (
        <p className="picker-hint">
          {chosen.category === 'stain'
            ? 'A stain colorant: it doesn’t show in the UMF, but tile search compares stains by name and amount.'
            : 'No oxide analysis on file, so it won’t count in the chemistry. Pick another entry if there is one.'}
        </p>
      )}

      {open && (
        // Keeps focus in the input, so using the list (its scrollbar too) doesn't close it.
        <div className="picker-menu" onMouseDown={(e) => e.preventDefault()}>
          {loading && options.length === 0 ? (
            <p className="picker-empty">
              <span className="spinner" /> Looking…
            </p>
          ) : (searching ? found.isError : common.isError) ? (
            <p className="picker-empty">The materials list couldn’t be loaded. Check your connection and try again.</p>
          ) : options.length === 0 ? (
            <p className="picker-empty">{searching ? 'No material with that name.' : 'Start typing to search every material.'}</p>
          ) : (
            // Out of the Tab order: browsers can tab into a scrolling list, and Tab should go on to the amount.
            <ul id={listId} role="listbox" ref={listRef} tabIndex={-1}>
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
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={picked && m.name === value}
                    className={`picker-option${index === highlighted ? ' is-active' : ''}${picked && m.name === value ? ' is-chosen' : ''}`}
                    onClick={() => select(m)}
                    onMouseEnter={() => setHighlighted(index)}
                  >
                    <span className="picker-name">
                      {m.name}
                      {m.matchedAlias && <span className="muted"> ({m.matchedAlias})</span>}
                    </span>
                    <span className="picker-meta">
                      {!m.hasAnalysis && <span className="badge badge-warn">No analysis</span>}
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
