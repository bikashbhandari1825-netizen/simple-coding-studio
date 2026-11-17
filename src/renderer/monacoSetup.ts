// Monaco लाई internet (CDN) बाट होइन, आफ्नै computer बाट लोड गर्ने।
// Load Monaco from the local package instead of a CDN, so the editor works offline.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
