import { NativeModules, Platform } from 'react-native';
import { ChatMessage } from './api';

const Impl: any = (NativeModules as any).OffChatLLM ?? null;

export function isNativeAvailable(): boolean {
  return !!Impl;
}

export async function loadModelOnDevice(localPath: string): Promise<{ status: string }> {
  if (!Impl) throw new Error('Native LLM module not available');
  // native method should accept a filesystem path and return a status
  return Impl.loadModel(localPath);
}

export async function unloadModelOnDevice(): Promise<{ status: string }> {
  if (!Impl) throw new Error('Native LLM module not available');
  return Impl.unloadModel();
}

export function chatStreamNative(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
) {
  if (!Impl) {
    onError('Native LLM module not available');
    return;
  }

  // The native module should implement a streaming API that invokes a JS callback
  // for each token. We expect a method `streamChat` that takes the messages JSON
  // and two callback ids or functions. Many RN native modules allow passing a
  // callback directly; adapt on native implementation.

  try {
    Impl.streamChat(JSON.stringify(messages), (event: any) => {
      // event: { type: 'token'|'done'|'error', token?: string, error?: string }
      if (event?.type === 'token' && event.token) onToken(event.token);
      else if (event?.type === 'done') onDone();
      else if (event?.type === 'error') onError(event.error || 'Unknown');
    });
  } catch (e: unknown) {
    onError(e instanceof Error ? e.message : String(e));
  }
}

export default {
  isNativeAvailable,
  loadModelOnDevice,
  unloadModelOnDevice,
  chatStreamNative,
};
