Steps to build a custom Android dev client (APK) with EAS and include the native mock module

1) Install EAS CLI and login
   npm install -g eas-cli
   eas login

2) Prebuild the native project
   cd Frontend/project
   expo prebuild --platform android

3) Copy native module files into generated android project
   # Java files
   cp -r android-native/java/com/offchat android/app/src/main/java/com/

   # C++ files
   mkdir -p android/app/src/main/cpp
   cp android-native/cpp/native_llm.cpp android/app/src/main/cpp/
   cp android-native/CMakeLists.txt android/app/src/main/cpp/

   # You may need to add the cpp dir to CMake settings in android/app/build.gradle.

4) Configure gradle/CMake
   # If build fails, add CMakeLists reference in android/app/build.gradle under externalNativeBuild

5) Build with EAS (development profile creates an installable APK)
   eas build --profile development --platform android

6) Download/install the generated APK on your device (from EAS dashboard or CLI)

Notes
- You need an EAS account (free) and to configure credentials for Android signing.
- Alternatively you can open the generated project in Android Studio and build locally.

If you want, I can automatically copy the native files into the generated android/ after you run prebuild; tell me when you've run prebuild and I will apply those file copies for you.
