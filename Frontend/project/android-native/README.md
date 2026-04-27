Android native LLM module (skeleton)
====================================

Purpose
-------
This folder contains a minimal React Native native-module skeleton for Android
(`OffChatLLM`) you can use to implement an on-device GGUF/ggml runtime.

Important: your Expo-managed project must be converted to a custom dev client
or the bare Android project (prebuild) to compile native code. See "Build"
below for steps.

What is included
- Java bridge: `OffChatLLMModule` and `OffChatLLMPackage` (registers the module)
- C++ placeholder: `native_llm.cpp` (where you'll add ggml/runner code)
- `CMakeLists.txt` to build the native library

Exposed JS API (expected)
- loadModel(path: string): Promise<{ status: string }>
- unloadModel(): Promise<{ status: string }>
- streamChat(messagesJson: string, callback): void

High-level tasks to make this work
----------------------------------
1. Install Android Studio + Android NDK (r21+ recommended) on your machine.
2. Prebuild your Expo project to generate the native Android project:

   expo prebuild --platform android

   or use EAS to create a custom dev client build.

3. Copy the Java/C++ files from this folder into the generated Android project
   under `android/app/src/main/java/...` and `android/app/src/main/cpp`.

4. Hook the package into `MainApplication.java` (add new package) or register
   using the new autolinking mechanism if you produce an AAR.

5. Implement the native ggml/llama runtime in `native_llm.cpp` and create JNI
   wrappers called from the Java module.

6. Build a custom dev client with EAS:

   eas build --profile development --platform android

   Install that dev client on your test device (replaces Expo Go) so your
   custom native module is available to the JS bundle.

7. In the JS side use the `lib/nativeLlm.ts` bridge to call the native APIs.

Notes & resources
- Consider using a known mobile runtime (e.g. llama.cpp forks or community
  ports) and wrap it instead of writing everything from scratch.
- Building and optimizing for mobile is non-trivial (memory, threading,
  CPU/GPU acceleration). Expect iterative work.

If you want I can:
- Copy these files into a prebuilt Android project and demonstrate a minimal
  build (requires EAS credentials or a local Android build environment).
- Start implementing the JNI glue and a tiny example that returns "hello"
  tokens from native to JS.
