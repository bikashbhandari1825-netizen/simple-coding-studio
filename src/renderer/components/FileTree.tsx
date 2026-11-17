import { useCallback, useEffect, useState } from 'react';
import type { FileEntry, ProjectInfo } from '../../shared/types';
import { errorText, fileIcon } from '../lib/helpers';
import { tr } from '../i18n';

interface Props {
  project: ProjectInfo;
  /** यो बदलिँदा tree फेरि पढ्छ — Bump to reload the tree. */
  version: number;
  activePath: string | null;
  selectedDir: string;
  onOpenFile: (entry: FileEntry) => void;
  onSelectDir: (dirPath: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onTrash: (entry: FileEntry) => void;
  onError: (message: string) => void;
}

export function FileTree(props: Props) {
  const { project, version, selectedDir, onNewFile, onNewFolder, onSelectDir } =
    props;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-slate-700 px-3 py-2">
        <button
          className="min-w-0 flex-1 truncate text-left text-xs font-semibold tracking-wide text-slate-300 uppercase"
          title={project.rootPath}
          onClick={() => onSelectDir(project.rootPath)}
        >
          {project.name}
        </button>
        <button
          className="icon-btn"
          title={tr('नयाँ फाइल · New file')}
          onClick={onNewFile}
        >
          ＋📄
        </button>
        <button
          className="icon-btn"
          title={tr('नयाँ फोल्डर · New folder')}
          onClick={onNewFolder}
        >
          ＋📁
        </button>
      </div>
      <p
        className="truncate px-3 pt-1 text-[11px] text-slate-500"
        title={selectedDir}
      >
        {tr('नयाँ फाइल यहाँ बन्छ · New items go in:')}{' '}
        {selectedDir === project.rootPath
          ? '/'
          : selectedDir.slice(project.rootPath.length)}
      </p>
      <div className="flex-1 overflow-auto py-1 text-sm">
        <DirChildren
          {...props}
          dirPath={project.rootPath}
          depth={0}
          version={version}
        />
      </div>
    </div>
  );
}

function DirChildren(props: Props & { dirPath: string; depth: number }) {
  const { dirPath, depth, version, onError } = props;
  const [entries, setEntries] = useState<FileEntry[] | null>(null);

  const load = useCallback(() => {
    window.studio
      .readDir(dirPath)
      .then(setEntries)
      .catch((err) => onError(errorText(err)));
  }, [dirPath, onError]);

  useEffect(() => {
    load();
  }, [load, version]);

  if (!entries)
    return <div className="px-3 py-1 text-xs text-slate-500">…</div>;
  if (entries.length === 0 && depth === 0) {
    return (
      <div className="px-3 py-2 text-xs text-slate-500">
        {tr('खाली फोल्डर · Empty folder')}
      </div>
    );
  }
  return (
    <ul>
      {entries.map((entry) => (
        <TreeRow key={entry.path} {...props} entry={entry} />
      ))}
    </ul>
  );
}

function TreeRow(props: Props & { entry: FileEntry; depth: number }) {
  const {
    entry,
    depth,
    activePath,
    selectedDir,
    onOpenFile,
    onSelectDir,
    onTrash,
  } = props;
  const [open, setOpen] = useState(false);
  const isActive =
    entry.path === activePath ||
    (entry.isDirectory && entry.path === selectedDir);

  const click = () => {
    if (entry.isDirectory) {
      setOpen((o) => !o);
      onSelectDir(entry.path);
    } else {
      onOpenFile(entry);
    }
  };

  return (
    <li>
      <div
        className={`group flex cursor-pointer items-center gap-1.5 py-[3px] pr-2 hover:bg-slate-700/60 ${
          isActive ? 'bg-sky-900/50 text-sky-100' : 'text-slate-300'
        }`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={click}
        title={entry.path}
      >
        <span className="w-3 text-[10px] text-slate-500">
          {entry.isDirectory ? (open ? '▼' : '▶') : ''}
        </span>
        <span>{fileIcon(entry.name, entry.isDirectory, open)}</span>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        <button
          className="hidden text-xs text-slate-500 group-hover:block hover:text-rose-400"
          title={tr('Recycle Bin मा पठाऊ · Move to Recycle Bin')}
          onClick={(e) => {
            e.stopPropagation();
            onTrash(entry);
          }}
        >
          🗑
        </button>
      </div>
      {entry.isDirectory && open && (
        <DirChildren {...props} dirPath={entry.path} depth={depth + 1} />
      )}
    </li>
  );
}
