#include <jni.h>
#include <string>
#include <thread>
#include <chrono>
#include <vector>

// Helper to create a JSON array of mock events
std::string make_mock_events() {
    std::vector<std::string> tokens = {"Hello", " ", "from", " ", "native", " ", "LLM", "!"};
    std::string res = "[";
    for (size_t i = 0; i < tokens.size(); ++i) {
        res += "{\"type\":\"token\",\"token\":\"" + tokens[i] + "\"}";
        if (i + 1 < tokens.size()) res += ",";
    }
    res += ",{\"type\":\"done\"}";
    res += "]";
    return res;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_offchat_OffChatLLMModule_nativeHello(JNIEnv* env, jobject /* this */) {
    std::string s = "{\"type\":\"token\",\"token\":\"hello\"}";
    return env->NewStringUTF(s.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_offchat_OffChatLLMModule_nativeLoadModel(JNIEnv* env, jobject /* this */, jstring path) {
    // Mock implementation: just return a JSON string
    const char* p = env->GetStringUTFChars(path, NULL);
    std::string out = std::string("{\"status\":\"loaded\",\"path\":\"") + p + "\"}";
    env->ReleaseStringUTFChars(path, p);
    return env->NewStringUTF(out.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_offchat_OffChatLLMModule_nativeUnloadModel(JNIEnv* env, jobject /* this */) {
    std::string out = "{\"status\":\"unloaded\"}";
    return env->NewStringUTF(out.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_offchat_OffChatLLMModule_nativeMockStream(JNIEnv* env, jobject /* this */, jstring messagesJson) {
    // ignore messagesJson for the mock and return the mock events JSON array
    std::string events = make_mock_events();
    return env->NewStringUTF(events.c_str());
}
