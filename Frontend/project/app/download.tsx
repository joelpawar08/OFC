import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import nativeLlm from '@/lib/nativeLlm';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Colors } from '@/constants/colors';
import { api, DownloadProgress, ModelInfo } from '@/lib/api';
import { Download, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Cpu, HardDrive, Zap } from 'lucide-react-native';

type ScreenState = 'connecting' | 'ready' | 'downloading' | 'done' | 'error';

export default function DownloadScreen() {
  const [fontsLoaded] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  const [screenState, setScreenState] = useState<ScreenState>('connecting');
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
    checkStatus();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const checkStatus = async () => {
    try {
      const [status, modelsRes] = await Promise.all([api.status(), api.listModels()]);
      const m = modelsRes.models[0];
      setModel(m);

      if (status.model_downloaded) {
        if (!status.model_loaded) {
          await api.loadModel();
        }
        router.replace('/chat');
        return;
      }

      if (status.download.status === 'downloading') {
        setScreenState('downloading');
        startPolling();
      } else {
        setScreenState('ready');
      }
    } catch {
      setError('Cannot reach the local server.\nMake sure the Python server is running on port 8000.');
      setScreenState('error');
    }
  };

  const startPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const p = await api.downloadProgress();
        setProgress(p);
        Animated.timing(progressAnim, {
          toValue: p.percent / 100,
          duration: 400,
          useNativeDriver: false,
        }).start();

        if (p.status === 'done') {
          clearInterval(pollingRef.current!);
          setScreenState('done');
          await api.loadModel();
          setTimeout(() => router.replace('/chat'), 1200);
        } else if (p.status === 'error') {
          clearInterval(pollingRef.current!);
          setError(p.error ?? 'Download failed');
          setScreenState('error');
        }
      } catch {
        // keep polling even on transient network hiccups
      }
    }, 1000);
  };

  const handleDownload = async () => {
    try {
      setError(null);
      await api.startDownload();
      setScreenState('downloading');
      startPolling();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start download');
    }
  };

  const handleRetry = () => {
    setError(null);
    setScreenState('connecting');
    checkStatus();
  };

  const saveModelToDevice = async () => {
    if (!model) return;
    try {
      setError(null);
      const url = api.modelFileUrl(model.id);
  const FS: any = FileSystem as any;
  const baseDir = FS.documentDirectory ?? FS.cacheDirectory ?? '';
  const fileUri = baseDir + model.id + '.gguf';

      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {},
        (progress) => {
          const written = progress.totalBytesWritten ?? 0;
          const total = progress.totalBytesExpectedToWrite ?? (model.size_mb * 1_000_000);
          const pct = total > 0 ? (written / total) * 100 : 0;
          setProgress(() => ({
            status: 'downloading',
            model_id: model.id,
            percent: pct,
            downloaded_mb: Number((written / 1e6).toFixed(2)),
            total_mb: Number((total / 1e6).toFixed(2)),
            speed_mbps: 0,
            error: null,
          }));
        }
      );

      const { uri } = await downloadResumable.downloadAsync();
      console.log('Model saved to', uri);
      setSavedFileUri(uri);
      alert('Model file saved to device storage.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save model');
    }
  };

  const [savedFileUri, setSavedFileUri] = useState<string | null>(null);
  const [nativeLoadStatus, setNativeLoadStatus] = useState<string | null>(null);

  const loadModelIntoRuntime = async () => {
    if (!savedFileUri) return alert('No saved model: download the model to device first');
    if (!nativeLlm.isNativeAvailable()) return alert('Native runtime not available in this build');
    try {
      setNativeLoadStatus('loading');
      const res = await nativeLlm.loadModelOnDevice(savedFileUri);
      setNativeLoadStatus(JSON.stringify(res));
      alert('Native load result: ' + JSON.stringify(res));
    } catch (e: unknown) {
      setNativeLoadStatus(e instanceof Error ? e.message : String(e));
      alert('Native load failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  if (!fontsLoaded) return null;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        {/* Header */}
        <View style={styles.header}>
          <Image source={require('../assets/images/logo.png')} style={styles.logoImage} />
          <Text style={styles.appTitle}>OffChat</Text>
          <Text style={styles.appSubtitle}>
            Chat with a local AI — runs on your device, no internet required.
          </Text>
        </View>

        {/* Model Card */}
        {model && (
          <View style={styles.modelCard}>
            <View style={styles.modelCardHeader}>
              <View style={styles.modelBadge}>
                <Text style={styles.modelBadgeText}>Recommended</Text>
              </View>
            </View>
            <Text style={styles.modelName}>{model.name}</Text>
            <Text style={styles.modelDesc}>{model.description}</Text>

            <View style={styles.modelStats}>
              <View style={styles.stat}>
                <HardDrive size={14} color={Colors.textTertiary} />
                <Text style={styles.statText}>{(model.size_mb / 1000).toFixed(1)} GB</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Cpu size={14} color={Colors.textTertiary} />
                <Text style={styles.statText}>{model.ram_required_gb} GB RAM</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Zap size={14} color={Colors.textTertiary} />
                <Text style={styles.statText}>CPU inference</Text>
              </View>
            </View>
          </View>
        )}

        {/* Download / Progress area */}
        {screenState === 'connecting' && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>Connecting to local server...</Text>
          </View>
        )}

        {screenState === 'ready' && (
          <View style={styles.actionArea}>
            <Text style={styles.actionHint}>
              The model file will be saved to your device. This only needs to be done once.
            </Text>
            <TouchableOpacity style={styles.downloadButton} onPress={handleDownload} activeOpacity={0.85}>
              <Download size={18} color={Colors.textInverse} />
              <Text style={styles.downloadButtonText}>Download Model (server)</Text>
            </TouchableOpacity>

            <View style={{ height: 12 }} />

            <TouchableOpacity style={[styles.downloadButton, { backgroundColor: Colors.bgTertiary }]} onPress={saveModelToDevice} activeOpacity={0.85}>
              <HardDrive size={18} color={Colors.textPrimary} />
              <Text style={[styles.downloadButtonText, { color: Colors.textPrimary }]}>Save Model to Device</Text>
            </TouchableOpacity>

            <View style={{ height: 12 }} />

            <TouchableOpacity style={[styles.downloadButton, { backgroundColor: Colors.bgTertiary }]} onPress={loadModelIntoRuntime} activeOpacity={0.85}>
              <Cpu size={18} color={Colors.textPrimary} />
              <Text style={[styles.downloadButtonText, { color: Colors.textPrimary }]}>Load into Device Runtime</Text>
            </TouchableOpacity>
          </View>
        )}

        {screenState === 'downloading' && progress && (
          <View style={styles.progressArea}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Downloading</Text>
              <Text style={styles.progressPercent}>{progress.percent.toFixed(1)}%</Text>
            </View>

            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>

            <View style={styles.progressMeta}>
              <Text style={styles.progressMetaText}>
                {progress.downloaded_mb.toFixed(0)} MB / {progress.total_mb.toFixed(0)} MB
              </Text>
              {progress.speed_mbps > 0 && (
                <Text style={styles.progressMetaText}>
                  {progress.speed_mbps.toFixed(1)} MB/s
                </Text>
              )}
            </View>

            <Text style={styles.progressNote}>
              Keep the app open. This may take several minutes depending on your connection.
            </Text>
          </View>
        )}

        {screenState === 'done' && (
          <View style={styles.doneArea}>
            <CheckCircle size={40} color={Colors.success} />
            <Text style={styles.doneTitle}>Model Ready</Text>
            <Text style={styles.doneSubtitle}>Loading into memory, opening chat...</Text>
          </View>
        )}

        {screenState === 'error' && (
          <View style={styles.errorArea}>
            <AlertCircle size={32} color={Colors.error} />
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Footer note */}
        <Text style={styles.footerNote}>
          All processing happens locally. No data leaves your device.
        </Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'web' ? 64 : 72,
    paddingBottom: 40,
  },
  inner: {
    flex: 1,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 16,
    resizeMode: 'contain',
  },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontFamily: 'Inter-Bold',
    fontSize: 28,
    color: Colors.textInverse,
  },
  appTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 28,
    color: Colors.textPrimary,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Model card
  modelCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 28,
  },
  modelCardHeader: {
    marginBottom: 10,
  },
  modelBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.accentLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  modelBadgeText: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: Colors.accent,
    letterSpacing: 0.3,
  },
  modelName: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 17,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  modelDesc: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  modelStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statText: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: Colors.textTertiary,
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 10,
  },

  // Action area
  actionArea: {
    marginBottom: 28,
  },
  actionHint: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  downloadButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  downloadButtonText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    color: Colors.textInverse,
  },

  // Progress
  progressArea: {
    marginBottom: 28,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: Colors.textPrimary,
  },
  progressPercent: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: Colors.accent,
  },
  progressTrack: {
    height: 8,
    backgroundColor: Colors.progressBg,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.progressFill,
    borderRadius: 8,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressMetaText: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: Colors.textTertiary,
  },
  progressNote: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: Colors.textTertiary,
    lineHeight: 18,
    textAlign: 'center',
  },

  // Done
  doneArea: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  doneTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 20,
    color: Colors.textPrimary,
  },
  doneSubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textSecondary,
  },

  // Error
  errorArea: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  errorTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    color: Colors.textPrimary,
  },
  errorMessage: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: Colors.bgTertiary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  retryButtonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: Colors.textPrimary,
  },

  // Status
  statusBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  statusText: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: Colors.textTertiary,
  },

  // Footer
  footerNote: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: Colors.textDisabled,
    textAlign: 'center',
    marginTop: 'auto',
    paddingTop: 32,
  },
});
