import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** The button's name, in the page's language ("Show password"); pressed, it shows. */
  showLabel: string;
};

/**
 * A password field with its own show button at the end, always there (the
 * browser's own one, Edge's, comes and goes and is hidden), only lighter
 * while the field is empty. It never takes the focus from the field on a
 * click, so the keyboard stays up on a phone.
 */
export function PasswordInput({ showLabel, className, ...input }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <span className={className ? `password-input ${className}` : "password-input"}>
      {/* A placeholder, if only a space, lets CSS tell an empty field (:placeholder-shown). */}
      <input placeholder=" " {...input} type={shown ? "text" : "password"} />
      <button
        type="button"
        className="password-toggle"
        aria-label={showLabel}
        aria-pressed={shown}
        title={showLabel}
        onPointerDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          setShown((value) => !value);
        }}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}
