// ✏️ Dart import को टाइपो जाँच: `packages:flutter/matterial.dart` → `package:flutter/material.dart`।
// Guru (AI) नबोलाई editor मा आफैं रातो रेखा र एक क्लिकको सुझाव दिन्छ।
// Dart import typo check: finds mistyped import lines and suggests the right one, with no AI involved.

export interface DartImport {
  /** १-आधारित लाइन र URI (कोटेसनभित्र) को स्तम्भ — 1-based line and the URI's columns (inside the quotes) */
  line: number;
  startColumn: number;
  endColumn: number;
  uri: string;
}

export interface ImportTypo extends DartImport {
  suggestion: string;
}

/** सबैभन्दा प्रचलित Flutter/Dart import हरू — the most common Flutter/Dart imports. */
export const KNOWN_IMPORTS = [
  'dart:async',
  'dart:collection',
  'dart:convert',
  'dart:core',
  'dart:developer',
  'dart:html',
  'dart:io',
  'dart:isolate',
  'dart:math',
  'dart:typed_data',
  'dart:ui',
  'package:flutter/animation.dart',
  'package:flutter/cupertino.dart',
  'package:flutter/foundation.dart',
  'package:flutter/gestures.dart',
  'package:flutter/material.dart',
  'package:flutter/painting.dart',
  'package:flutter/physics.dart',
  'package:flutter/rendering.dart',
  'package:flutter/scheduler.dart',
  'package:flutter/semantics.dart',
  'package:flutter/services.dart',
  'package:flutter/widgets.dart',
  'package:flutter_test/flutter_test.dart',
  'package:http/http.dart',
  'package:provider/provider.dart',
  'package:intl/intl.dart',
  'package:path/path.dart',
  'package:shared_preferences/shared_preferences.dart',
  'package:firebase_core/firebase_core.dart',
  'package:firebase_auth/firebase_auth.dart',
  'package:cloud_firestore/cloud_firestore.dart',
  'package:google_maps_flutter/google_maps_flutter.dart',
  'package:flutter_bloc/flutter_bloc.dart',
  'package:get/get.dart',
];

const SCHEMES = ['package', 'dart', 'file', 'http', 'https'];

/** दुई शब्दबीचको फरक (अक्षर थप्ने/हटाउने/बदल्ने गन्ती) — Levenshtein distance. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = up;
    }
  }
  return prev[b.length];
}

// import 'x'; / export "x"; / part 'x'; — URI कोटेसनभित्र
const IMPORT_LINE = /^(\s*(?:import|export|part)\s+)(['"])([^'"\n]*)\2/;

/** फाइलका सबै import/export/part लाइन — every import, export and part line of a Dart file. */
export function parseDartImports(text: string): DartImport[] {
  const out: DartImport[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = IMPORT_LINE.exec(lines[i]);
    if (!m) continue;
    const startColumn = m[1].length + 2; // कोटेसनपछि — just after the opening quote
    out.push({
      line: i + 1,
      startColumn,
      endColumn: startColumn + m[3].length,
      uri: m[3],
    });
  }
  return out;
}

/** एउटा import URI गलत टाइप भएको हो भने सही सुझाव, होइन भने null — the corrected URI, or null when it looks fine. */
export function suggestImport(uri: string): string | null {
  const colon = uri.indexOf(':');
  // सापेक्ष बाटो (`../a.dart`) हामी जाँच्दैनौं — relative paths are left to the analyzer
  if (colon < 0) return null;
  let scheme = uri.slice(0, colon);
  const rest = uri.slice(colon + 1);
  let fixedScheme = false;
  if (!SCHEMES.includes(scheme)) {
    // `packages:` `pakage:` `dat:` जस्ता — near-misses of a real scheme
    const best = SCHEMES.map((s) => ({ s, d: distance(scheme, s) })).sort(
      (a, b) => a.d - b.d,
    )[0];
    if (best.d > Math.max(1, Math.floor(best.s.length / 4))) return null;
    scheme = best.s;
    fixedScheme = true;
  }
  const candidate = `${scheme}:${rest}`;
  if (KNOWN_IMPORTS.includes(candidate)) return fixedScheme ? candidate : null;
  if (scheme !== 'package' && scheme !== 'dart')
    return fixedScheme ? candidate : null;
  // नजिकको चिनिएको import खोज्ने — the closest known import (at most two letters off)
  const best = KNOWN_IMPORTS.filter((k) => k.startsWith(`${scheme}:`))
    .map((k) => ({ k, d: distance(candidate, k) }))
    .sort((a, b) => a.d - b.d)[0];
  if (best && best.d <= 2 && best.d < candidate.length / 4) return best.k;
  // चिनिएन तर scheme मात्र बिग्रेको थियो — unknown package, but the scheme itself was mistyped
  return fixedScheme ? candidate : null;
}

/** टाइपो भएका import हरू र सुझाव — the mistyped imports with a suggestion for each. */
export function findImportTypos(text: string): ImportTypo[] {
  const out: ImportTypo[] = [];
  for (const imp of parseDartImports(text)) {
    const suggestion = suggestImport(imp.uri);
    if (suggestion && suggestion !== imp.uri) out.push({ ...imp, suggestion });
  }
  return out;
}
