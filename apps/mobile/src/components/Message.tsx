import { useState, type ReactNode } from 'react';
import { Linking, Pressable, Text as RNText, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { chatApi } from '@glazion/api-client/main';
import type { ChatMessage } from '@glazion/types';
import { colors, font, radius, space, textSize } from '../theme';
import { Icon, IconButton, Text } from './ui';

const NUMBERED = /^\s*(\d+)[.)]\s+/;
const BULLET = /^\s*[-*•]\s+/;
const HEADING = /^#{1,6}\s+/;

type Block = { kind: 'p' | 'h'; text: string } | { kind: 'ol'; start: number; items: string[] } | { kind: 'ul'; items: string[] };

/**
 * Answers are plain text with a little markdown: blank lines between paragraphs, "1." and "-" lists,
 * "#" headings. A numbered list split by blank lines stays one list. Mirrors apps/main's chat Message.
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
    const url = match[3];
    out.push(
      match[1] !== undefined ? (
        <RNText key={match.index} style={{ fontFamily: font.bold }}>
          {match[1]}
        </RNText>
      ) : (
        <RNText key={match.index} accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={{ textDecorationLine: 'underline' }}>
          {match[2]}
        </RNText>
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Body({ content, color }: { content: string; color: string }) {
  const text = { color, fontSize: textSize.md, lineHeight: 24 };
  return (
    <View style={{ gap: 10 }}>
      {toBlocks(content).map((block, i) =>
        block.kind === 'ol' || block.kind === 'ul' ? (
          <View key={i} style={{ gap: 6 }}>
            {block.items.map((item, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={[text, { fontFamily: font.semibold }]}>{block.kind === 'ol' ? `${block.start + j}.` : '•'}</Text>
                <Text style={[text, { flex: 1 }]}>
                  <Inline text={item} />
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text key={i} accessibilityRole={block.kind === 'h' ? 'header' : undefined} style={[text, block.kind === 'h' && { fontFamily: font.bold }]}>
            <Inline text={block.text} />
          </Text>
        ),
      )}
    </View>
  );
}

export function UserBubble({ content }: { content: string }) {
  return (
    <View style={styles.bubble}>
      <Body content={content} color="#fff" />
    </View>
  );
}

export function Typing() {
  return (
    <Text variant="muted" accessibilityLabel="Glazion is writing">
      Glazion is writing…
    </Text>
  );
}

export default function Message({ message }: { message: ChatMessage }) {
  const router = useRouter();
  const [showSources, setShowSources] = useState(false);
  const feedback = useMutation({
    mutationFn: (value: 'helpful' | 'not_helpful') => chatApi.sendFeedback({ messageId: message.id, feedback: value }),
  });

  if (message.role === 'user') return <UserBubble content={message.content} />;

  return (
    <View style={{ gap: 10 }}>
      {message.toolCalls?.map((tool) => (
        <Pressable
          key={tool.name + tool.summary}
          disabled={!tool.searchId}
          onPress={() => tool.searchId && router.push(`/results/${tool.searchId}`)}
          style={styles.tool}
          accessibilityRole={tool.searchId ? 'button' : undefined}
        >
          <Icon name={tool.name === 'search_recipe_images' ? 'image' : 'book-open'} size={16} color={colors.ink2} />
          <Text variant="small" style={{ flexShrink: 1 }}>
            {tool.summary}
          </Text>
          {tool.searchId && (
            <Text variant="small" style={{ fontFamily: font.semibold, color: colors.brand }}>
              View
            </Text>
          )}
        </Pressable>
      ))}

      <Body content={message.content} color={colors.ink} />

      {message.confidence === 'low' && (
        <View style={styles.caveat}>
          <Icon name="info" size={16} color={colors.warn} />
          <Text variant="small" style={{ color: colors.warn, flex: 1 }}>
            Glazion isn’t sure about this one. Treat it as a starting point.
          </Text>
        </View>
      )}

      {message.sources && message.sources.length > 0 && (
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSources }} onPress={() => setShowSources((shown) => !shown)} style={styles.sourcesToggle}>
            <Text variant="small" style={{ fontFamily: font.semibold }}>
              {message.sources.length} {message.sources.length === 1 ? 'source' : 'sources'}
            </Text>
            <Icon name={showSources ? 'chevron-up' : 'chevron-down'} size={14} color={colors.ink2} />
          </Pressable>
          {showSources && (
            <View style={styles.sources}>
              {message.sources.map((source, index) => (
                <View key={source.id}>
                  <Text variant="label">
                    {index + 1}. {source.title}
                  </Text>
                  <Text variant="small">{source.snippet}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <IconButton name="thumbs-up" label="Helpful" onPress={() => feedback.mutate('helpful')} color={feedback.variables === 'helpful' ? colors.brand : colors.ink3} />
        <IconButton name="thumbs-down" label="Not helpful" onPress={() => feedback.mutate('not_helpful')} color={feedback.variables === 'not_helpful' ? colors.brand : colors.ink3} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 4, backgroundColor: colors.ink },
  tool: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, maxWidth: '100%' },
  caveat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourcesToggle: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 },
  sources: { gap: 10, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  actions: { flexDirection: 'row', marginLeft: -10 },
});
