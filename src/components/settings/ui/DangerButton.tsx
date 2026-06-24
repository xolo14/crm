interface DangerButtonProps {
  onClick: () => void;
  label: string;
  confirm?: boolean;
}

export function DangerButton({ onClick, label, confirm = false }: DangerButtonProps) {
  const handleClick = () => {
    if (!confirm || window.confirm(`Are you sure you want to ${label.toLowerCase()}?`)) {
      onClick();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 transition-all duration-150 ease-in-out hover:bg-red-100"
    >
      {label}
    </button>
  );
}
