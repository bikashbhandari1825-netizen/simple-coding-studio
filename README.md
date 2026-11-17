# Simple Coding Studio 🎓

सुरुवाती विद्यार्थीहरूका लागि सजिलो code editor, जसमा नेपाली + English मा बुझाउने AI शिक्षक "Guru" छ।
A beginner-friendly code editor with "Guru", an AI tutor that explains in Nepali and English.

---

## १. एप चलाउने सबैभन्दा सजिलो तरिका (Easiest: install it)

1. यो फाइलमा double-click गर्नुहोस् — Double-click:
   `out\make\squirrel.windows\x64\SimpleCodingStudio-Setup.exe`
2. Windows ले "Windows protected your PC" देखायो भने **More info → Run anyway** थिच्नुहोस्। (Installer मा code-signing certificate नभएकाले यस्तो देखिन्छ।)
3. त्यसपछि Start Menu मा **Simple Coding Studio** खोज्नुहोस्।

## २. Install नगरी सिधै चलाउने (Run without installing)

PowerShell वा VS Code terminal मा यो project फोल्डरभित्र:

```powershell
& ".\out\Simple Coding Studio-win32-x64\SimpleCodingStudio.exe"
```

## ३. Developer mode मा चलाउने (Run from source, for changing the code)

```powershell
cd "C:\Users\bikas\OneDrive\Desktop\Mero vs code Nepali maa 1825\simple-coding-studio"
npm.cmd start
```

- **`npm` होइन `npm.cmd` किन?** यो computer को PowerShell ले `npm.ps1` script रोक्छ ("running scripts is disabled")। `npm.cmd` ले त्यो नियम नछोई काम गर्छ। — PowerShell blocks `npm.ps1` here; `npm.cmd` works without changing that security setting.
- Terminal मा: `r` = app restart, `q` = बन्द (quit)।
- कोड बदलेर save गर्दा UI आफैं अपडेट हुन्छ। Main process (`src/main.ts`, `src/main-process/`) बदलेपछि `r` थिच्नुहोस्।
- DevTools पनि चाहियो भने: `$env:STUDIO_DEVTOOLS='1'; npm.cmd start`

## ४. नयाँ installer बनाउने (Build a new installer)

```powershell
npm.cmd run make
```

नतिजा — Output: `out\make\squirrel.windows\x64\SimpleCodingStudio-Setup.exe`

---

## पहिलोपटक प्रयोग गर्दा (First use)

1. ⚙️ **Settings** → Claude API key राख्नुहोस् (https://console.anthropic.com/settings/keys)। Key Windows encryption ले सुरक्षित राखिन्छ।
2. **✨ नयाँ एप** थिचेर नयाँ Flutter project बनाउनुहोस्, वा **📁 खोल** / Drag & Drop ले पुरानो project खोल्नुहोस्।
3. माथि दायाँ कमाण्ड छानेर **▶ चलाऊ · Run** थिच्नुहोस् (जस्तै "Chrome मा चलाऊ")।
4. कोड नबुझे **🧑‍🏫 Guru** मा 📖 बुझाऊ, 🩺 गल्ती खोज, वा 🗺️ एप योजना थिच्नुहोस्।

## Flutter का लागि एकपटकको सेटअप (One-time Flutter setup)

`flutter doctor` ले यो computer मा २ कमी देखायो — found two gaps on this computer:

| कमी | असर | समाधान |
|---|---|---|
| Android license स्वीकार भएको छैन | "APK बनाऊ" चल्दैन | `flutter doctor --android-licenses` चलाएर सबैमा `y` |
| Visual Studio मा C++ workload छैन | "Windows एपको रूपमा चलाऊ" चल्दैन | Visual Studio Installer → "Desktop development with C++" थप्ने |

"Chrome मा चलाऊ" अहिले नै काम गर्छ — Running in Chrome works already.

---

## Project को बनावट (Project structure)

```
src/
├─ main.ts                 Electron window, सुरक्षा नियम
├─ preload.ts              UI र system बीचको सुरक्षित पुल (window.studio)
├─ shared/types.ts         दुवैतर्फ साझा types
├─ main-process/
│  ├─ fileSystem.ts        फाइल पढ्ने/लेख्ने (खोलिएको project भित्र मात्र)
│  ├─ runner.ts            ▶ Run presets (flutter, dart, npm, python)
│  ├─ ai.ts                Guru — Claude API (streaming)
│  └─ settings.ts          API key (encrypted) र model
└─ renderer/
   ├─ App.tsx              मुख्य layout
   ├─ components/          FileTree, EditorArea, ConsolePanel, TutorPanel, Dialogs, Welcome
   └─ lib/helpers.ts       साना सहयोगी functions
```

**Tech:** Electron Forge + Vite, React 19, TypeScript, Tailwind CSS 4, Monaco Editor, `@anthropic-ai/sdk`.
