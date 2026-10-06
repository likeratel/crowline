import type { ReactNode } from "react";
export function Switch({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch-control">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span />
      </span>
      <span>{children}</span>
    </label>
  );
}
