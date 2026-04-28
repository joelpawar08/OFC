import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { Colors } from '@/constants/colors';
import { api, ChatMessage } from '@/lib/api';
import nativeLlm from '@/lib/nativeLlm';
import { Send, Square, ChevronLeft, RotateCcw } from 'lucide-react-native';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

let messageIdCounter = 0;
const newId = () => `msg-${++messageIdCounter}`;

export default function ChatScreen() {
  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const streamingIdRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    setInput('');

    const userMsg: Message = { id: newId(), role: 'user', content: text };
    const assistantId = newId();
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantPlaceholder]);
    streamingIdRef.current = assistantId;
    setIsStreaming(true);
    scrollToBottom();

    const history: ChatMessage[] = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    abortRef.current = new AbortController();

    if (nativeLlm.isNativeAvailable()) {
      // Use native on-device streaming
      nativeLlm.chatStreamNative(
        history,
        (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + token }
                : m,
            ),
          );
          scrollToBottom();
        },
        () => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, streaming: false } : m,
            ),
          );
          setIsStreaming(false);
          streamingIdRef.current = null;
        },
        (err) => {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          setError(err);
          setIsStreaming(false);
          streamingIdRef.current = null;
        },
      );
    } else {
      await api.chatStream(
        history,
        (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + token }
                : m,
            ),
          );
          scrollToBottom();
        },
        () => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, streaming: false } : m,
            ),
          );
          setIsStreaming(false);
          streamingIdRef.current = null;
        },
        (err) => {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          setError(err);
          setIsStreaming(false);
          streamingIdRef.current = null;
        },
        abortRef.current.signal,
      );
    }

    // If a native runtime is available, prefer it for subsequent messages
    // (we still called the server above for this message as a fallback).
    if (nativeLlm.isNativeAvailable()) {
      // Start native streaming for future messages (optional behavior)
      // Note: actual native integration requires a native module implementation.
    }
  }, [input, isStreaming, messages, scrollToBottom]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    const id = streamingIdRef.current;
    if (id) {
      setMessages(prev =>
        prev.map(m => (m.id === id ? { ...m, streaming: false } : m)),
      );
    }
    setIsStreaming(false);
    streamingIdRef.current = null;
  };

  const clearChat = () => {
    if (isStreaming) stopStreaming();
    setMessages([]);
    setError(null);
  };

  const goBack = () => {
    router.replace('/download');
  };

  if (fontError) throw fontError;

  // Render immediately; fonts will enhance appearance as they load
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarButton} onPress={goBack} activeOpacity={0.7}>
          <ChevronLeft size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.topBarCenter}>
          <Image source={require('../assets/images/logo.png')} style={styles.logoSmall} />
          <Text style={styles.topBarTitle}>OffChat</Text>
        </View>

        <TouchableOpacity style={styles.topBarButton} onPress={clearChat} activeOpacity={0.7}>
          <RotateCcw size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          messages.length === 0 && styles.listContentEmpty,
        ]}
        renderItem={({ item }) => <MessageBubble message={item} />}
        onContentSizeChange={scrollToBottom}
        ListEmptyComponent={<EmptyState />}
      />

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input area */}
      <View style={styles.inputWrapper}>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message AI..."
            placeholderTextColor={Colors.textDisabled}
            multiline
            maxLength={4000}
            editable={!isStreaming}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              isStreaming && styles.stopButton,
              (!input.trim() && !isStreaming) && styles.sendButtonDisabled,
            ]}
            onPress={isStreaming ? stopStreaming : sendMessage}
            activeOpacity={0.8}
            disabled={!input.trim() && !isStreaming}
          >
            {isStreaming ? (
              <Square size={16} color={Colors.textInverse} fill={Colors.textInverse} />
            ) : (
              <Send size={16} color={Colors.textInverse} />
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.inputFooter}>
          Responses are generated locally on your device.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const cursorAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!message.streaming) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(cursorAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [message.streaming, cursorAnim]);

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>A</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {message.streaming && message.content === '' ? (
          <ActivityIndicator size="small" color={Colors.textTertiary} />
        ) : (
          <View style={styles.bubbleTextRow}>
            <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
              {message.content}
            </Text>
            {message.streaming && (
              <Animated.View style={[styles.cursor, { opacity: cursorAnim }]} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyLogo}>
        <Text style={styles.emptyLogoText}>A</Text>
      </View>
      <Text style={styles.emptyTitle}>How can I help you today?</Text>
      <Text style={styles.emptySubtitle}>
        Ask me anything. All responses are generated locally — no internet needed.
      </Text>
      <View style={styles.emptySuggestions}>
        {SUGGESTIONS.map(s => (
          <View key={s} style={styles.chip}>
            <Text style={styles.chipText}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const SUGGESTIONS = [
  'Explain a concept simply',
  'Help me write something',
  'Summarize a topic',
  'Answer a question',
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 20 : 52,
    paddingBottom: 14,
    backgroundColor: Colors.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceDivider,
  },
  topBarButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  topBarTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    color: Colors.textPrimary,
  },
  logoSmall: {
    width: 30,
    height: 30,
    borderRadius: 8,
    marginRight: 8,
    resizeMode: 'contain',
  },

  // List
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 20,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },

  // Message bubble
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    maxWidth: '90%',
  },
  messageRowUser: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  avatarText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: Colors.textInverse,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  bubbleUser: {
    backgroundColor: Colors.userBubble,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: Colors.surfaceElevated,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  bubbleTextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  bubbleText: {
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    color: Colors.assistantBubbleText,
    lineHeight: 22,
    flexShrink: 1,
  },
  bubbleTextUser: {
    color: Colors.userBubbleText,
  },
  cursor: {
    width: 2,
    height: 16,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginLeft: 2,
    marginBottom: 2,
  },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  errorBannerText: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: Colors.error,
    flex: 1,
    lineHeight: 18,
  },
  errorDismiss: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: Colors.error,
  },

  // Input
  inputWrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'web' ? 20 : 28,
    backgroundColor: Colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceDivider,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Colors.bgInput,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    color: Colors.textPrimary,
    maxHeight: 120,
    lineHeight: 22,
    paddingVertical: 0,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stopButton: {
    backgroundColor: Colors.textPrimary,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.progressBg,
  },
  inputFooter: {
    fontFamily: 'Inter-Regular',
    fontSize: 11,
    color: Colors.textDisabled,
    textAlign: 'center',
    marginTop: 8,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyLogo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyLogoText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 30,
    color: Colors.textInverse,
  },
  emptyTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 20,
    color: Colors.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  emptySuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  chip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  chipText: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: Colors.textSecondary,
  },
});
