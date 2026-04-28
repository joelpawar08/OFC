import { useEffect, useState } from 'react';
import { Redirect, Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';

export default function Index() {
  const [isReady, setIsReady] = useState(false);
  const [shouldGoToChat, setShouldGoToChat] = useState(false);

  useEffect(() => {
    checkModelStatus();
  }, []);

  const checkModelStatus = async () => {
    try {
      // Check if model exists on device
      const FS: any = FileSystem as any;
      const baseDir = FS.documentDirectory ?? FS.cacheDirectory ?? '';
      
      // Get list of models from backend
      const modelsRes = await api.listModels();
      if (modelsRes.models.length === 0) {
        console.log('🔍 No models found on backend');
        setIsReady(true);
        setShouldGoToChat(false);
        return;
      }

      const model = modelsRes.models[0];
      const fileUri = baseDir + model.id + '.gguf';
      
      console.log('🔍 Checking for model at:', fileUri);
      
      // Check if file exists on device
      const fileExists = await FileSystem.getInfoAsync(fileUri);
      
      console.log('📁 File exists check:', fileExists);
      const fileSize = (fileExists as any).size || 0;
      
      // Model should be at least 500MB
      if (fileExists.exists && fileSize > 500_000_000) {
        console.log('✅ Model found on device! Size:', fileSize, 'bytes. Going to chat...');
        setShouldGoToChat(true);
      } else {
        console.log('❌ Model not found on device. Going to download...');
        setShouldGoToChat(false);
      }
    } catch (error) {
      console.log('⚠️ Error checking model status:', error);
      setShouldGoToChat(false);
    } finally {
      setIsReady(true);
    }
  };

  if (!isReady) return null;

  if (shouldGoToChat) {
    return <Redirect href="/chat" />;
  }

  return <Redirect href="/download" />;
}
