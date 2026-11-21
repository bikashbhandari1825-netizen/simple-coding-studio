// 📛 जे लेखे पनि मान्य Flutter/Dart package नाम बनाउने — turn any typed text into a valid Dart package name.
// "My App Now" → my_app_now · "Mero-App!" → mero_app · "नमस्ते" / खाली → flutter_app · "123 App" → app_123_app

export const DEFAULT_PROJECT_NAME = 'flutter_app';

// Dart का आरक्षित शब्द र package नाम जसले `flutter create` लाई रिसाउँछ — reserved words `flutter create` rejects
const RESERVED = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'covariant',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'false',
  'final',
  'finally',
  'for',
  'function',
  'get',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'late',
  'library',
  'mixin',
  'new',
  'null',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'set',
  'show',
  'static',
  'super',
  'switch',
  'sync',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'dart',
  'flutter',
  'flutter_test',
  'test',
  'main',
]);

export function sanitizeProjectName(raw: string): string {
  let name = (raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) return DEFAULT_PROJECT_NAME;
  if (/^[0-9]/.test(name)) name = `app_${name}`;
  if (RESERVED.has(name)) name = `${name}_app`;
  if (name.length > 60) name = name.slice(0, 60).replace(/_+$/, '');
  return name;
}
