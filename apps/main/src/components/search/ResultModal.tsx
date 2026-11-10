import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { searchApi } from '@glazion/api-client/main';
import type { ScoreBreakdown, SearchFeedbackValue, SearchResultItem } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, toneClass } from '@glazion/ui';
import { BAND, firingLabel, humanise, percent, recipeNameUnderCode, resultName, tileAlt, tileQuestion } from '../../lib/glaze';
import TilePhoto from './TilePhoto';

/** Image is left out while it's empty (the ranker doesn't compare photos yet). */
const BREAKDOWN: { key: keyof ScoreBreakdown; label: string; always?: boolean }[] = [
  { key: 'chemistrySimilarity', label: 'Chemistry', always: true },
  { key: 'firingCompatibility', label: 'Firing', always: true },
  { key: 'colourantSimilarity', label: 'Colorants' },
  { key: 'labelOrTextSimilarity', label: 'Surface and colour', always: true },
  { key: 'imageSimilarity', label: 'Image' },
];

interface Props {
  searchId: string;
  item: SearchResultItem;
  onClose: () => void;
  onImageError: () => void;
  onFindRecipe: (item: SearchResultItem) => void;
}

export default function ResultModal({ searchId, item, onClose, onImageError, onFindRecipe }: Props) {
  const navigate = useNavigate();
  const band = BAND[item.confidenceBand];
  const synthetic = item.resultType === 'synthetic_preview';
  const hasBreakdown = BREAKDOWN.some(({ key }) => item.scoreBreakdown[key] != null);

  const feedback = useMutation({
    mutationFn: (value: SearchFeedbackValue) => searchApi.sendFeedback({ searchId, imageId: item.imageId, feedback: value }),
  });

  function askAboutTile() {
    navigate('/chat/new', { state: { ask: tileQuestion(searchId, item) } });
  }

  return (
    <Modal title={resultName(item)} onClose={onClose} size="lg">
      <div className="result-detail">
        <div className="result-image">
          {item.displayUrl ? <TilePhoto src={item.displayUrl} alt={tileAlt(item)} onError={onImageError} flagLowRes /> : <Icon name="image" size={36} />}
          {synthetic && <span className="result-flag">Generated preview, not a real tile</span>}
        </div>

        <div className="result-side">
          <div className="score-head">
            <span className="score-big">{percent(item.score)}</span>
            <span className={toneClass(band.tone)}>{band.label}</span>
          </div>

          {/* The breakdown is for admins only: for a regular user the API sends none, so the match shows without its why. */}
          {hasBreakdown && (
            <div className="bars">
              {BREAKDOWN.filter(({ key, always }) => always || item.scoreBreakdown[key] != null).map(({ key, label }) => {
                const value = item.scoreBreakdown[key] ?? null;
                return (
                  <div key={key} className="bar-row">
                    <span>{label}</span>
                    <div className="bar-track">{value !== null && <div className="bar-fill" style={{ width: percent(value) }} />}</div>
                    <span className="bar-value">{value === null ? 'Not compared' : percent(value)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* The next step comes first: more tiles like this one, or a question about it. */}
          <div className="result-actions">
            {item.source.recipeId && (
              <button className="btn btn-primary" onClick={() => onFindRecipe(item)}>
                <Icon name="search" size={18} />
                Find tiles like this recipe
              </button>
            )}
            <button className={`btn ${item.source.recipeId ? 'btn-ghost ask-link' : 'btn-secondary'}`} onClick={askAboutTile}>
              <Icon name="message" size={18} />
              Ask Glazion about this tile
            </button>
          </div>

          {item.matchedFields.length > 0 && (
            <div>
              <h3 className="note-label">Matched on</h3>
              <div className="chips-row">
                {item.matchedFields.map((field) => (
                  <span key={field} className="chip is-static">
                    {humanise(field)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <dl className="facts">
            {item.source.recipeCode && (
              <div>
                <dt>Lab code</dt>
                <dd>
                  <span className="tile-code">{item.source.recipeCode}</span>
                </dd>
              </div>
            )}
            {/* Titled by its code, the recipe's name goes here; without a code, the name is the title. */}
            {recipeNameUnderCode(item) && (
              <div>
                <dt>Recipe</dt>
                <dd>{recipeNameUnderCode(item)}</dd>
              </div>
            )}
            <div>
              <dt>Clay body</dt>
              <dd>{clayBodyLabel(item.tile.clayBody) ?? '—'}</dd>
            </div>
            <div>
              <dt>Firing</dt>
              <dd>{firingLabel(item.firing)}</dd>
            </div>
            <div>
              <dt>Body colour</dt>
              <dd>{humanise(item.tile.variant)}</dd>
            </div>
            <div>
              <dt>Surface</dt>
              <dd>{humanise(item.tile.surface)}</dd>
            </div>
            <div>
              <dt>Colour</dt>
              <dd>{humanise(item.tile.colourFamily)}</dd>
            </div>
            <div>
              <dt>Opacity</dt>
              <dd>{humanise(item.tile.opacity)}</dd>
            </div>
          </dl>

          {item.limitations.length > 0 && (
            <div className="note">
              <h3 className="note-label">Keep in mind</h3>
              <ul className="plain-list">
                {item.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="feedback">
            <h3 className="sr-only">Feedback</h3>
            {/* Thanks straight away; the buttons come back with the reason if it didn't go through. */}
            {feedback.isPending || feedback.isSuccess ? (
              <span className="muted">Thanks, that’s recorded.</span>
            ) : (
              <>
                <span>Is this a useful match?</span>
                <button className="btn btn-secondary btn-sm" onClick={() => feedback.mutate('relevant')}>
                  <Icon name="thumbs-up" size={16} />
                  Useful
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => feedback.mutate('not_relevant')}>
                  <Icon name="thumbs-down" size={16} />
                  Not useful
                </button>
              </>
            )}
            {feedback.isError && <span className="hint hint-bad">Not sent. {errorMessage(feedback.error)}</span>}
          </div>

        </div>
      </div>
    </Modal>
  );
}
