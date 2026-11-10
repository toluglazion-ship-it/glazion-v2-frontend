import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { chatApi } from '@glazion/api-client/main';
import type { ChatMessage } from '@glazion/types';
import { Icon, toast } from '@glazion/ui';

const NUMBERED = /^\s*(\d+)[.)]\s+/;
const BULLET = /^\s*[-*•]\s+/;
const HEADING = /^#{1,6}\s+/;

type Block = { kind: 'p' | 'h'; text: string } | { kind: 'ol'; start: number; items: string[] } | { kind: 'ul'; items: string[] };

/**
 * Answers are plain text with a little markdown: blank lines between paragraphs, "1." and "-" lists,
 * "#" headings. A numbered list split by blank lines stays one list.
 */
function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of content.split(/\n{2,}/)) {
    let current: Block | null = null;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const numbered = line.match(NUMBERED);
      const last = blocks[blocks.length - 1];
      if (HEADING.test(line)) {
        blocks.push({ kind: 'h', text: line.replace(HEADING, '') });
        current = null;
      } else if (numbered || BULLET.test(line)) {
        const kind = numbered ? 'ol' : 'ul';
        // After a blank line, a list carries on when its next item does (the same bullets, or the next number).
        const carriesOn = current === null && last?.kind === kind && (last.kind === 'ul' || Number(numbered![1]) === last.start + last.items.length);
        if (current?.kind !== kind && !carriesOn) {
          blocks.push(kind === 'ol' ? { kind, start: Number(numbered![1]), items: [] } : { kind, items: [] });
        }
        current = blocks[blocks.length - 1];
        (current as { items: string[] }).items.push(line.replace(numbered ? NUMBERED : BULLET, ''));
      } else if (current?.kind === 'ol' || current?.kind === 'ul') {
        // A wrapped line carries on the item above it.
        current.items[current.items.length - 1] += ` ${line.trim()}`;
      } else if (current?.kind === 'p') {
        current.text += ` ${line}`;
      } else {
        blocks.push((current = { kind: 'p', text: line }));
      }
    }
  }
  return blocks;
}

/** **Bold** and links to real web pages; everything else stays as written. */
const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      match[1] !== undefined ? (
        <strong key={match.index}>{match[1]}</strong>
      ) : (
        <a key={match.index} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
        </a>
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Body({ content }: { content: string }) {
  return (
    <>
      {toBlocks(content).map((block, i) =>
        block.kind === 'ol' || block.kind === 'ul' ? (
          <List key={i} block={block} />
        ) : block.kind === 'h' ? (
          <h3 key={i} className="answer-heading">
            <Inline text={block.text} />
          </h3>
        ) : (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        ),
      )}
    </>
  );
}

function List({ block }: { block: Extract<Block, { items: string[] }> }) {
  const items = block.items.map((item, j) => (
    <li key={j}>
      <Inline text={item} />
    </li>
  ));
  return block.kind === 'ol' ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
}

export default function Message({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const feedback = useMutation({
    mutationFn: (value: 'helpful' | 'not_helpful') => chatApi.sendFeedback({ messageId: message.id, feedback: value }),
    onError: () => toast.error('Your feedback wasn’t sent. Try again.'),
  });
  // Lit as soon as it's pressed, and unlit again if it didn't go through.
  const chosen = feedback.isError ? undefined : feedback.variables;

  if (message.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble">
          <Body content={message.content} />
        </div>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the text can still be selected by hand.
      toast.error('Couldn’t copy. Select the text and copy it instead.');
    }
  }

  return (
    <div className="msg msg-assistant">
      {message.toolCalls?.map((tool) => (
        <div key={tool.name + tool.summary} className="tool">
          <Icon name={tool.name === 'search_recipe_images' ? 'image' : tool.name === 'calculate_umf' ? 'calculator' : 'flask'} size={16} />
          <span>{tool.summary}</span>
          {tool.searchId && (
            <Link to={`/search/${tool.searchId}`}>
              View results
              <Icon name="chevron-right" size={14} />
            </Link>
          )}
        </div>
      ))}

      <div className="answer">
        <Body content={message.content} />
      </div>

      {message.confidence === 'low' && (
        <p className="caveat">
          <Icon name="info" size={16} />
          Glazion isn’t sure about this one. Treat it as a starting point.
        </p>
      )}

      {message.sources && message.sources.length > 0 && (
        <details className="sources">
          <summary>
            {message.sources.length} {message.sources.length === 1 ? 'source' : 'sources'}
            <Icon name="chevron-down" size={14} />
          </summary>
          <ol>
            {message.sources.map((source) => (
              <li key={source.id}>
                <strong>{source.title}</strong>
                <span>{source.snippet}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="msg-actions">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={copy} aria-label="Copy answer" title="Copy">
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
        <button
          className={`btn btn-ghost btn-icon btn-sm${chosen === 'helpful' ? ' is-chosen' : ''}`}
          onClick={() => feedback.mutate('helpful')}
          aria-label="Helpful"
          title="Helpful"
          aria-pressed={chosen === 'helpful'}
        >
          <Icon name="thumbs-up" size={16} />
        </button>
        <button
          className={`btn btn-ghost btn-icon btn-sm${chosen === 'not_helpful' ? ' is-chosen' : ''}`}
          onClick={() => feedback.mutate('not_helpful')}
          aria-label="Not helpful"
          title="Not helpful"
          aria-pressed={chosen === 'not_helpful'}
        >
          <Icon name="thumbs-down" size={16} />
        </button>
      </div>
    </div>
  );
}
