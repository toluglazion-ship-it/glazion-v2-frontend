import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { chatApi, usesSampleData } from '@glazion/api-client/main';
import type { Conversation, ConversationSummary, SendMessageRequest } from '@glazion/types';
import { ErrorState, Icon, Modal, Skeleton, formatRelativeTime, toast } from '@glazion/ui';
import Composer from '../components/chat/Composer';
import Message from '../components/chat/Message';
import MenuButton from '../components/MenuButton';
import { drafts } from '../lib/drafts';
import { usePageTitle } from '../lib/usePageTitle';

const SUGGESTIONS = [
  'Why is my celadon crazing on porcelain?',
  'What makes a glaze matte instead of glossy?',
  'What can I use instead of Gerstley borate?',
  'Find tiles that look like a glossy cone 6 clear',
];

const DAY = 86_400_000;

/** Conversations under Today, Yesterday, Previous 7 days, Previous 30 days, then by month. Keeps their order. */
function byDate(conversations: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: { label: string; items: ConversationSummary[] }[] = [];
  for (const c of conversations) {
    const at = new Date(c.updatedAt);
    const t = at.getTime();
    const label =
      t >= today
        ? 'Today'
        : t >= today - DAY
          ? 'Yesterday'
          : t >= today - 6 * DAY
            ? 'Previous 7 days'
            : t >= today - 29 * DAY
              ? 'Previous 30 days'
              : at.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return groups;
}

function exportConversation(conversation: Conversation) {
  const lines = [`# ${conversation.title}`, ''];
  for (const m of conversation.messages) {
    lines.push(`**${m.role === 'user' ? 'You' : 'Glazion'}**`, '', m.content, '');
    if (m.sources?.length) lines.push('Sources:', ...m.sources.map((s) => `- ${s.title}`), '');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${conversation.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'conversation'}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function RenameModal({ conversation, onClose }: { conversation: ConversationSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(conversation.title);

  const rename = useMutation({
    mutationFn: () => chatApi.rename(conversation.id, title.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData<Conversation>(['conversation', conversation.id], (prev) => prev && { ...prev, ...updated });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast('Conversation renamed');
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim() && !rename.isPending) rename.mutate();
  }

  return (
    <Modal
      title="Rename conversation"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="rename-conversation" type="submit" disabled={!title.trim() || rename.isPending}>
            {rename.isPending && <span className="spinner" />}
            Save
          </button>
        </>
      }
    >
      <form id="rename-conversation" onSubmit={handleSubmit}>
        {rename.isError && <p className="hint hint-bad">{errorMessage(rename.error)}</p>}
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Conversation name" autoFocus maxLength={80} />
      </form>
    </Modal>
  );
}

function DeleteModal({ conversation, onClose, onDeleted }: { conversation: ConversationSummary; onClose: () => void; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => chatApi.remove(conversation.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['conversation', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast('Conversation deleted');
      onDeleted();
    },
  });

  return (
    <Modal
      title="Delete this conversation?"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending && <span className="spinner" />}
            Delete
          </button>
        </>
      }
    >
      {remove.isError && <p className="hint hint-bad">{errorMessage(remove.error)}</p>}
      <p className="modal-note">“{conversation.title}” and its messages will be removed for good.</p>
    </Modal>
  );
}

/** Answers take several seconds, so after a moment the dots say it's still coming. */
function Writing() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="msg msg-assistant" role="status">
      <div className="typing" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {slow ? <p className="typing-note">Still working on it. Answers can take about 10 seconds.</p> : <span className="sr-only">Glazion is writing…</span>}
    </div>
  );
}

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // "/chat" and "/chat/new" both mean a conversation that hasn't been started yet.
  const activeId = conversationId && conversationId !== 'new' ? conversationId : null;

  // A message typed but not sent is kept for this tab, one per conversation.
  const draftKey = `chat_${activeId ?? 'new'}`;
  const [draft, setDraftText] = useState(() => drafts.read<string>(draftKey) ?? '');
  const draftFor = useRef(draftKey);
  function setDraft(text: string) {
    setDraftText(text);
    drafts.write(draftKey, text.trim() ? text : null);
  }
  // A question handed over (a tile's "Ask Glazion") is sent as the page opens, so it shows as on its way from the start.
  const asked = (location.state as { ask?: SendMessageRequest } | null)?.ask;
  const askedOnce = useRef(false);
  const [sending, setSending] = useState<string | null>(asked?.content ?? null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  /**
   * A conversation started here whose first message didn't go through. Sending again reuses it, so
   * a retry doesn't leave an empty conversation behind each time.
   */
  const started = useRef<string | null>(null);

  const list = useQuery({ queryKey: ['conversations'], queryFn: chatApi.list });
  const thread = useQuery({
    queryKey: ['conversation', activeId],
    queryFn: () => chatApi.getOne(activeId!),
    enabled: !!activeId,
  });

  const send = useMutation({
    mutationFn: async (message: SendMessageRequest) => {
      const id = activeId ?? started.current ?? (await chatApi.create()).id;
      if (!activeId) started.current = id;
      return { id, result: await chatApi.send(id, message) };
    },
    onMutate: ({ content }) => {
      setSending(content);
      setDraft('');
    },
    onSuccess: ({ id, result }) => {
      // Anything typed while the first message was on its way goes with the conversation it now belongs to.
      if (!activeId) {
        drafts.write(`chat_${id}`, drafts.read<string>('chat_new'));
        drafts.write('chat_new', null);
      }
      queryClient.setQueryData<Conversation>(['conversation', id], (prev) => ({
        ...result.conversation,
        messages: [...(prev?.messages ?? []), result.userMessage, result.assistantMessage],
      }));
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      started.current = null;
      if (!activeId) navigate(`/chat/${id}`, { replace: true });
    },
    // Hand the text back so nothing typed is lost. A conversation may have been started, so the list is refreshed.
    onError: (_error, { content }) => {
      setDraft(content);
      if (started.current) queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onSettled: () => setSending(null),
  });

  const messages = thread.data?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  // Starting a different conversation shouldn't keep the last one's failed-send banner.
  useEffect(() => {
    send.reset();
    started.current = null;
  }, [activeId]);

  // Sent once: the state is cleared so going back or reloading doesn't ask again.
  useEffect(() => {
    if (!asked || askedOnce.current) return;
    askedOnce.current = true;
    navigate(location.pathname, { replace: true, state: null });
    send.mutate(asked);
  }, []);

  // Each conversation shows its own unsent message.
  useEffect(() => {
    if (draftFor.current === draftKey) return;
    draftFor.current = draftKey;
    setDraftText(drafts.read<string>(draftKey) ?? '');
  }, [draftKey]);

  const conversations = list.data?.items ?? [];
  const current: ConversationSummary | undefined = thread.data ?? conversations.find((c) => c.id === activeId);
  usePageTitle(activeId ? (current?.title ?? 'Ask Glazion') : 'Ask Glazion');
  const fresh = !activeId && sending === null;
  // Phones show the list or a conversation, not both. With nothing in the list yet, go straight to a new one.
  const noList = list.isSuccess && conversations.length === 0;

  return (
    <div className={`chat${conversationId || noList ? ' has-thread' : ''}`}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <h1 className="chat-list-title">Ask Glazion</h1>
          <Link className="btn btn-secondary btn-sm" to="/chat/new">
            <Icon name="plus" size={16} />
            New chat
          </Link>
        </div>

        {list.isPending ? (
          <Skeleton rows={5} label="Loading conversations" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : conversations.length === 0 ? (
          <p className="chat-list-empty">Your conversations will be listed here.</p>
        ) : (
          <nav className="chat-items" aria-label="Conversations">
            {byDate(conversations).map((group) => (
              <section key={group.label} className="chat-group">
                <h2 className="chat-group-title">{group.label}</h2>
                {group.items.map((c) => (
                  <NavLink key={c.id} to={`/chat/${c.id}`} className={({ isActive }) => `chat-item${isActive ? ' is-active' : ''}`}>
                    <span className="truncate">{c.title}</span>
                    <span className="muted">{formatRelativeTime(c.updatedAt)}</span>
                  </NavLink>
                ))}
              </section>
            ))}
          </nav>
        )}
      </aside>

      <section className="chat-thread">
        <header className="chat-head">
          {!noList && (
            <Link className="btn btn-ghost btn-icon btn-sm chat-back" to="/chat" aria-label="All conversations">
              <Icon name="chevron-left" size={20} />
            </Link>
          )}
          <h2 className="chat-title truncate">{current?.title ?? 'New conversation'}</h2>
          {thread.data && (
            <div className="chat-head-actions">
              {/* Delete sits in the menu, away from Rename, so it isn't hit by mistake. */}
              <MenuButton
                className="btn btn-ghost btn-icon btn-sm"
                label="Conversation options"
                align="end"
                items={[
                  { label: 'Rename', onSelect: () => setRenaming(true) },
                  { label: 'Download', hint: 'As a Markdown file', onSelect: () => exportConversation(thread.data) },
                  { label: 'Delete', danger: true, onSelect: () => setDeleting(true) },
                ]}
              >
                <Icon name="more-vertical" size={18} />
              </MenuButton>
            </div>
          )}
        </header>

        <div className="chat-scroll">
          <div className="chat-column">
            {usesSampleData('chat') && (
              <div className="alert alert-info sample-note" role="note">
                <Icon name="info" size={18} />
                <span>
                  <strong>Test data.</strong> This is the fake backend, so answers here are prepared samples.
                </span>
              </div>
            )}

            {activeId && thread.isPending && <Skeleton rows={3} label="Loading the conversation" />}
            {activeId && thread.isError && <ErrorState title="Couldn’t open this conversation" message={errorMessage(thread.error)} onRetry={() => thread.refetch()} />}

            {fresh && (
              <div className="chat-welcome">
                <h2>What are you working on?</h2>
                <p>Ask about glaze chemistry, materials or a firing problem. Glazion can also search the tile library for you.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((text) => (
                    <button key={text} className="suggestion" onClick={() => send.mutate({ content: text })}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}

            {sending !== null && (
              <>
                <div className="msg msg-user">
                  <div className="bubble">
                    <p>{sending}</p>
                  </div>
                </div>
                <Writing />
              </>
            )}

            {send.isError && (
              <div className="alert" role="alert">
                <Icon name="alert" size={18} />
                <span>Your message wasn’t sent. {errorMessage(send.error)}</span>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </div>

        <div className="chat-column">
          <Composer value={draft} onChange={setDraft} onSend={() => send.mutate({ content: draft.trim() })} busy={send.isPending} />
        </div>
      </section>

      {renaming && current && <RenameModal conversation={current} onClose={() => setRenaming(false)} />}
      {deleting && current && (
        <DeleteModal
          conversation={current}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            navigate('/chat', { replace: true });
          }}
        />
      )}
    </div>
  );
}
