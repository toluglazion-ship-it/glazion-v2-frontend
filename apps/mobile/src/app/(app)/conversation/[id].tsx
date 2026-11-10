import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { chatApi, usesSampleData } from '@glazion/api-client/main';
import type { Conversation, SendMessageRequest } from '@glazion/types';
import Message, { Typing, UserBubble } from '../../../components/Message';
import { toast } from '../../../components/Toast';
import { Button, Empty, Icon, IconButton, Input, Loading, Notice, PreviewNote, Text } from '../../../components/ui';
import { handoff } from '../../../lib/handoff';
import { useKeyboardHeight } from '../../../lib/useKeyboardHeight';
import { colors, font, radius, space, textSize } from '../../../theme';

const SUGGESTIONS = [
  'Why is my celadon crazing on porcelain?',
  'What makes a glaze matte instead of glossy?',
  'What can I use instead of Gerstley borate?',
  'Find tiles that look like a glossy cone 6 clear',
];

function asText(conversation: Conversation): string {
  const lines = [conversation.title, ''];
  for (const m of conversation.messages) lines.push(`${m.role === 'user' ? 'You' : 'Glazion'}:`, m.content, '');
  return lines.join('\n');
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);

  // "new" is a conversation that hasn't been started yet; it gets a real id on the first send.
  const [activeId, setActiveId] = useState<string | null>(id === 'new' ? null : id);
  // A question handed over (a tile's "Ask Glazion") is sent as the screen opens, so it shows as on its way from the start.
  const [handedOver] = useState(() => handoff.takeQuestion());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<string | null>(handedOver?.content ?? null);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  /**
   * A conversation started here whose first message didn't go through. Sending again reuses it, so
   * a retry doesn't leave an empty conversation behind each time.
   */
  const started = useRef<string | null>(null);

  const thread = useQuery({ queryKey: ['conversation', activeId], queryFn: () => chatApi.getOne(activeId!), enabled: !!activeId });
  const messages = thread.data?.messages ?? [];

  const send = useMutation({
    mutationFn: async (message: SendMessageRequest) => {
      const conversationId = activeId ?? started.current ?? (await chatApi.create()).id;
      if (!activeId) started.current = conversationId;
      return { conversationId, result: await chatApi.send(conversationId, message) };
    },
    onMutate: ({ content }) => {
      setSending(content);
      setDraft('');
    },
    onSuccess: ({ conversationId, result }) => {
      queryClient.setQueryData<Conversation>(['conversation', conversationId], (prev) => ({
        ...result.conversation,
        messages: [...(prev?.messages ?? []), result.userMessage, result.assistantMessage],
      }));
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      started.current = null;
      setActiveId(conversationId);
    },
    // Hand the text back so nothing typed is lost. A conversation may have been started, so the list is refreshed.
    onError: (_error, { content }) => {
      setDraft(content);
      if (started.current) queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onSettled: () => setSending(null),
  });

  useEffect(() => {
    if (handedOver) send.mutate(handedOver);
  }, []);

  const rename = useMutation({
    mutationFn: () => chatApi.rename(activeId!, newTitle.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData<Conversation>(['conversation', activeId], (prev) => prev && { ...prev, ...updated });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setRenaming(false);
      toast('Conversation renamed');
    },
  });

  const remove = useMutation({
    mutationFn: () => chatApi.remove(activeId!),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['conversation', activeId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast('Conversation deleted');
      router.back();
    },
  });

  function confirmDelete() {
    Alert.alert('Delete this conversation?', 'It and its messages will be removed for good.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  }

  const conversation = thread.data;
  // The conversation's own name is too long to share the header with three buttons.
  const title = conversation ? 'Conversation' : 'New conversation';

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: conversation
        ? () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton name="share" label="Share conversation" onPress={() => Share.share({ message: asText(conversation) })} />
              <IconButton
                name="edit-2"
                label="Rename conversation"
                onPress={() => {
                  setNewTitle(conversation.title);
                  setRenaming(true);
                }}
              />
              <IconButton name="trash-2" label="Delete conversation" onPress={confirmDelete} />
            </View>
          )
        : undefined,
    });
    // confirmDelete only closes over the mutation, which is stable.
  }, [navigation, title, conversation]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, sending, keyboard]);

  const fresh = !activeId && sending === null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled">
        {usesSampleData('chat') && <PreviewNote>This is the fake backend, so answers here are prepared samples.</PreviewNote>}

        {activeId && thread.isPending && <Loading />}
        {activeId && thread.isError && <Empty icon="alert-circle" title="Couldn’t open this conversation" text={errorMessage(thread.error)} action={<Button label="Try again" kind="secondary" onPress={() => thread.refetch()} />} />}

        {fresh && (
          <View style={{ gap: space.md, marginTop: space.md }}>
            <Text variant="title" style={{ fontSize: textSize.xl }}>
              What are you working on?
            </Text>
            <Text variant="muted" style={{ color: colors.ink2 }}>
              Ask about glaze chemistry, materials or a firing problem. Glazion can also search the tile library for you.
            </Text>
            {SUGGESTIONS.map((text) => (
              <Pressable key={text} accessibilityRole="button" onPress={() => send.mutate({ content: text })} style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.sunken }]}>
                <Text style={{ fontFamily: font.medium, flex: 1 }}>{text}</Text>
                <Icon name="arrow-up-right" size={16} color={colors.ink3} />
              </Pressable>
            ))}
          </View>
        )}

        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}

        {sending !== null && (
          <>
            <UserBubble content={sending} />
            <Typing />
          </>
        )}

        {send.isError && <Notice>Your message wasn’t sent. {errorMessage(send.error)}</Notice>}
        {remove.isError && <Notice>{errorMessage(remove.error)}</Notice>}
      </ScrollView>

      {/* On Android the composer lifts itself over the keyboard; on iOS KeyboardAvoidingView does it. */}
      <View style={[styles.composer, { paddingBottom: keyboard > 0 ? insets.bottom + keyboard + space.sm : Math.max(insets.bottom, space.md) }]}>
        <View style={styles.composerBox}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about a glaze, a material or a firing problem"
            placeholderTextColor={colors.ink3}
            multiline
            accessibilityLabel="Message"
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!draft.trim() || send.isPending}
            onPress={() => send.mutate({ content: draft.trim() })}
            style={[styles.send, (!draft.trim() || send.isPending) && { opacity: 0.4 }]}
          >
            <Icon name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
        <Text variant="small" style={styles.disclaimer}>
          Glazion can be wrong. Test before you rely on an answer, and lab-test anything meant for food.
        </Text>
      </View>

      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text variant="heading">Rename conversation</Text>
            {rename.isError && <Notice>{errorMessage(rename.error)}</Notice>}
            <Input value={newTitle} onChangeText={setNewTitle} autoFocus maxLength={80} accessibilityLabel="Conversation name" />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
              <Button label="Cancel" kind="secondary" small onPress={() => setRenaming(false)} />
              <Button label="Save" small onPress={() => rename.mutate()} loading={rename.isPending} loadingLabel="Saving…" disabled={!newTitle.trim()} />
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  thread: { padding: space.xl, gap: space.xl, flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  composer: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 6, backgroundColor: colors.canvas, width: '100%', maxWidth: 720, alignSelf: 'center' },
  composerBox: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, borderRadius: 22, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.surface },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 140, paddingVertical: 8, fontFamily: font.regular, fontSize: textSize.md, color: colors.ink },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  disclaimer: { textAlign: 'center', fontSize: textSize.xs, lineHeight: 18, color: colors.ink3 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: 'rgba(14,19,32,0.45)' },
  dialog: { width: '100%', maxWidth: 420, gap: space.md, padding: space.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
});
