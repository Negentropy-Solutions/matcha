import { useAppStore } from '../store';

export default function Toasts() {
  const { toasts } = useAppStore();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.msg}
        </div>
      ))}
    </div>
  );
}
