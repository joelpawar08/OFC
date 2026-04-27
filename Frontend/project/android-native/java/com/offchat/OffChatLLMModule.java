package com.offchat;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Callback;

public class OffChatLLMModule extends ReactContextBaseJavaModule {
    public OffChatLLMModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "OffChatLLM";
    }

    @ReactMethod
    public void loadModel(String path, Promise promise) {
        try {
            String res = nativeLoadModel(path);
            // return raw JSON string
            promise.resolve(res);
        } catch (Exception e) {
            promise.reject("load_error", e);
        }
    }

    @ReactMethod
    public void unloadModel(Promise promise) {
        try {
            String res = nativeUnloadModel();
            promise.resolve(res);
        } catch (Exception e) {
            promise.reject("unload_error", e);
        }
    }

    @ReactMethod
    public void streamChat(String messagesJson, Callback eventCallback) {
        // Run streaming in a background thread to avoid blocking the JS thread.
        new Thread(() -> {
            try {
                // Call native mock streamer which returns a JSON array string of events
                String arrJson = nativeMockStream(messagesJson);
                // Parse array and invoke callback per event with a short delay to simulate streaming
                org.json.JSONArray arr = new org.json.JSONArray(arrJson);
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject ev = arr.getJSONObject(i);
                    eventCallback.invoke(ev.toString());
                    try { Thread.sleep(120); } catch (InterruptedException ie) { /* ignore */ }
                }
            } catch (Exception e) {
                try { eventCallback.invoke(new org.json.JSONObject().put("type","error").put("error", e.getMessage()).toString()); } catch (Exception _e) {}
            }
        }).start();
    }

    static {
        try {
            System.loadLibrary("native_llm");
        } catch (Throwable t) {
            // ignore - library may not be present in JS-only environment
        }
    }

    // Native method declarations
    private native String nativeLoadModel(String path);
    private native String nativeUnloadModel();
    private native String nativeMockStream(String messagesJson);
}
