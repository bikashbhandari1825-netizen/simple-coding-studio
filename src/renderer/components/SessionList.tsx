import { tr } from '../i18n';

export interface GuruSession {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * 🗂️ Guru का छुट्टाछुट्टै कुराकानी (Claude को sidebar जस्तै): हरेक आदेशको आफ्नै कुराकानी र आफ्नै कोड।
 * Separate Guru sessions, like Claude's sidebar: every command keeps its own chat and its own code.
 */
export function SessionList({
  sessions,
  activeId,
  onOpen,
  onNew,
  onDelete,
}: {
  sessions: GuruSession[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      data-testid="session-list"
      className="flex max-h-[45%] min-h-24 shrink-0 flex-col border-t border-slate-700"
    >
      <div className="flex items-center gap-1 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-slate-300 uppercase">
          {tr('🧑‍🏫 Guru कुराकानी · Sessions')}
        </span>
        <button
          className="icon-btn"
          data-testid="session-new"
          title={tr('नयाँ कुराकानी · New session')}
          onClick={onNew}
        >
          ＋
        </button>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
        {sessions.map((s) => (
          <li key={s.id}>
            <div
              data-testid="session-item"
              data-active={s.id === activeId ? 'yes' : 'no'}
              className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[13px] ${
                s.id === activeId
                  ? 'bg-sky-900/60 font-semibold text-sky-100'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
              title={s.title}
              onClick={() => onOpen(s.id)}
            >
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <button
                className="hidden text-xs text-slate-500 group-hover:block hover:text-rose-400"
                title={tr('यो कुराकानी मेट्ने · Delete this session')}
                aria-label="Delete session"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
