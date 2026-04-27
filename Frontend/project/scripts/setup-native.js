#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return false;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return true;
}

const projectRoot = path.resolve(__dirname, '..');
const androidNativeDir = path.join(projectRoot, 'android-native');
const androidDir = path.join(projectRoot, 'android', 'app', 'src', 'main');

console.log('Project root:', projectRoot);

if (!fs.existsSync(path.join(projectRoot, 'android'))) {
  console.error('android/ not found. Run `expo prebuild --platform android` first.');
  process.exit(1);
}

// Copy Java files
const javaSrc = path.join(androidNativeDir, 'java');
const javaDest = path.join(androidDir, 'java');
if (copyRecursive(javaSrc, javaDest)) console.log('Copied Java files to', javaDest);
else console.log('No Java files to copy from', javaSrc);

// Copy cpp files
const cppSrc = path.join(androidNativeDir, 'cpp');
const cppDest = path.join(androidDir, 'cpp');
if (copyRecursive(cppSrc, cppDest)) console.log('Copied C++ files to', cppDest);
else console.log('No C++ files to copy from', cppSrc);

// Patch android/app/build.gradle to include externalNativeBuild cmake if not present
const buildGradle = path.join(projectRoot, 'android', 'app', 'build.gradle');
if (fs.existsSync(buildGradle)) {
  let content = fs.readFileSync(buildGradle, 'utf8');
  if (!/externalNativeBuild\s*\{/.test(content)) {
    // Insert externalNativeBuild block before the last closing brace of android {}
    const insert = `    externalNativeBuild {
        cmake {
            path "src/main/cpp/CMakeLists.txt"
        }
    }
`;
    // naive insertion: find the last occurrence of '\n}' which ends android block
    const lastIndex = content.lastIndexOf('\n}');
    if (lastIndex !== -1) {
      content = content.slice(0, lastIndex) + '\n' + insert + content.slice(lastIndex);
      fs.writeFileSync(buildGradle, content, 'utf8');
      console.log('Patched build.gradle to include externalNativeBuild cmake.');
    } else {
      console.warn('Could not locate insertion point in build.gradle; please add the externalNativeBuild block manually.');
    }
  } else {
    console.log('build.gradle already contains externalNativeBuild; skipping patch.');
  }
} else {
  console.error('android/app/build.gradle not found; cannot patch CMake configuration.');
}

console.log('Done. You can now run `eas build --profile development --platform android`.');
