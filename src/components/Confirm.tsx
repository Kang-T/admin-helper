import { useEffect } from "react";

export default function Confirm({
  message,
  confirmLabel = "실행",
  danger = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  danger?: boolean; // 정지·초기화처럼 되돌리기 어려운 일이면 빨간 버튼
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">실행 전에 확인하세요</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn text" onClick={onCancel} autoFocus>
            취소
          </button>
          <button type="button" className={danger ? "btn danger" : "btn filled"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
